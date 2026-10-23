// API を通さずに要約と採点をもらう道(仕様 7.4)。
// プロンプトをクリップボードに置き、(a) Apple のショートカットに Apple Intelligence で処理させるか、
// (b) ユーザーが好きなチャット AI に貼る。どちらも結果はクリップボード経由で貼り戻してもらう。
// URL に本文を載せないのは、長さの上限(行きはショートカットの URL、帰りは配信サーバー)に当たるため

import type { GradeOutput, Paper, SummaryOutput } from "@/core/types";
import { articleInput } from "@/core/papers/article";
import { ARXIV_ID_RE, arxivIdFromDoi } from "@/core/scholar/arxiv";
import { extractDois } from "@/core/scholar/openalex";
import { titleKey } from "@/core/scholar/verify";
import { LlmError, parseJsonLoose } from "./provider";
import { EVIDENCE_RULES, FEEDBACK_RULES, GRADE_ITEMS, GRADE_RULES, buildRankRequest, buildRecommendRequest, normalizeGrade, paperHeader, parseRank, parseRecommend, verifyEvidence, type PaperContext, type RankCandidate, type RankItem, type RecommendOutput } from "./tasks";

/** 戻り先の URL に付けるパラメータ。値は論文 ID */
export const RETURN_PARAM = "ai_return";

/** プロンプトの書き出し。貼り戻されたものがプロンプトのままかを見分けるのにも使う */
const PROMPT_HEAD = "論文の情報と、それを読んだ人のメモを渡します。次の 2 つをしてください。";

/** 要約と採点を 1 往復で済ませるプロンプト。行き先はスキーマ指定ができないので、形は文面で伝える */
export function buildHandoffPrompt(ctx: PaperContext, memoBody: string, language: string): string {
  const lang = language === "en" ? "English" : "日本語";
  const kind = ctx.inputKind === "abstract" ? "アブストラクト" : ctx.inputKind === "fulltext" ? "本文" : "ユーザー提供テキスト";
  return [
    PROMPT_HEAD,
    "1. summary: 論文を事実に基づいて要約する。各項目 2〜4 文。情報が足りない項目は推測せず「不明」と書く。",
    `2. grade: ${GRADE_RULES}`,
    `出力は${lang}で、下の形の JSON だけを返してください。前置き・説明・コードフェンスは不要です。`,
    "",
    paperHeader(ctx.paper),
    "",
    `[${kind}]`,
    ctx.text,
    "",
    "[メモ]",
    memoBody,
    "",
    "[返す JSON の形]",
    JSON.stringify(
      {
        summary: { problem: "何を解いた / 論じた問題か", method: "手法の要点", results: "結果・主張", limitations: "限界・注意点", evidence: [{ field: "problem", quote: "原文そのまま" }] },
        grade: { items: GRADE_ITEMS.map((name) => ({ name, score: 3, comment: "…" })), overall_comment: "2〜3 文", good_points: [], missing_points: [], misreadings: [], next_step: "1 文" },
      },
      null,
      1,
    ),
    `summary.${EVIDENCE_RULES}`,
    "grade.items はこの 4 項目を、この順・この name で。grade の残りは次のとおり:",
    FEEDBACK_RULES,
  ].join("\n");
}

export interface HandoffResult {
  summary: SummaryOutput;
  /** 小さいモデルは採点を落とすことがある。要約だけでも受け取る */
  grade: GradeOutput | null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "不明");

/** sourceText は頼んだときに渡した論文情報。根拠の引用が本当にそこにあるかを確かめるのに使う */
export function parseHandoffResult(text: string, sourceText: string): HandoffResult {
  if (!text.trim()) throw new LlmError("貼り付けた内容が空です", "bad_output");
  if (text.trim().startsWith(PROMPT_HEAD)) {
    throw new LlmError("貼り付けたのはこちらのプロンプトのままです。AI の回答をコピーしてから、もう一度押してください", "bad_output");
  }
  let raw: Record<string, unknown>;
  try {
    raw = parseJsonLoose<Record<string, unknown>>(text);
  } catch (e) {
    const cut = e instanceof Error && e.message.includes("途中で切れて");
    throw new LlmError(
      cut
        ? "AI の回答が途中で切れているようです。AI に「続けて」と頼むか、渡す論文情報を短くして頼み直してください"
        : "AI の回答を JSON として読めませんでした。回答の最初の { から最後の } までをまるごとコピーしてください",
      "bad_output",
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new LlmError("要約が見つかりません。AI の回答の JSON 全体をコピーしてください", "bad_output");
  }
  // summary を包まずに 4 項目を直に返すモデルもある
  const s = (raw.summary && typeof raw.summary === "object" ? raw.summary : raw) as Record<string, unknown>;
  if (!["problem", "method", "results", "limitations"].some((k) => typeof s[k] === "string")) {
    throw new LlmError("要約が見つかりません。AI の回答の JSON 全体をコピーしてください", "bad_output");
  }
  const summary = verifyEvidence({ problem: str(s.problem), method: str(s.method), results: str(s.results), limitations: str(s.limitations), evidence: s.evidence as SummaryOutput["evidence"] }, sourceText);

  const g = raw.grade as Partial<GradeOutput> | undefined;
  let grade: GradeOutput | null = null;
  if (g && Array.isArray(g.items) && g.items.length) {
    grade = normalizeGrade({
      items: g.items.map((it, i) => ({ name: str(it?.name) === "不明" ? (GRADE_ITEMS[i] ?? "") : str(it?.name), score: Number(it?.score), comment: typeof it?.comment === "string" ? it.comment : "" })),
      total: 0,
      overall_comment: typeof g.overall_comment === "string" ? g.overall_comment : "",
      missing_points: g.missing_points,
      good_points: g.good_points,
      misreadings: g.misreadings,
      next_step: g.next_step,
    });
  }
  return { summary, grade };
}

/** このページに戻ってくるための URL。ショートカットの x-success に渡す */
export function handoffReturnUrl(pageUrl: string, paperId: string): string {
  const u = new URL(pageUrl);
  u.search = "";
  u.hash = "";
  u.searchParams.set(RETURN_PARAM, paperId);
  return u.toString();
}

/** 戻ってきた URL から論文 ID を取り出す。戻りでなければ null */
export function handoffReturnPaperId(pageUrl: string): string | null {
  try {
    return new URL(pageUrl).searchParams.get(RETURN_PARAM);
  } catch {
    return null;
  }
}

/** ショートカットを起動する URL。入力はクリップボードに置いてあるので、ここには名前と戻り先だけ */
export function shortcutRunUrl(shortcutName: string, returnUrl: string): string {
  const q = [`name=${encodeURIComponent(shortcutName)}`, `x-success=${encodeURIComponent(returnUrl)}`, `x-cancel=${encodeURIComponent(returnUrl)}`, `x-error=${encodeURIComponent(returnUrl)}`];
  return `shortcuts://x-callback-url/run-shortcut?${q.join("&")}`;
}

// ---- 論文を探す: クエリ生成と順位付け(仕様 7.4 / 8) ----
// API と同じ指示を 1 つの文面にまとめる。スキーマ指定ができないので、返す形は例で示す

export function chatPrompt(req: { system: string; user: string }, example: unknown): string {
  return [req.system, "", req.user, "", "下の形の JSON だけを返してください。前置き・説明・コードフェンスは不要です。", JSON.stringify(example, null, 1)].join("\n");
}

export function buildRecommendPrompt(keywords: string, context: string, language: string, japanese: boolean): string {
  return chatPrompt(buildRecommendRequest(keywords, context, language, japanese), { queries: ["…", "…"], queries_ja: japanese ? ["…"] : [] });
}

export function buildRankPrompt(cands: RankCandidate[], purpose: string, criterion: string, language: string): string {
  return chatPrompt(buildRankRequest(cands, purpose, criterion, language), { items: [{ id: cands[0]?.id ?? "…", rank: 1, reason: "…" }] });
}

/** 貼り戻されたものがプロンプトのままなら教える。読み違えのまま進むより分かりやすい */
export function checkPasted(text: string, prompt: string) {
  if (!text.trim()) throw new LlmError("貼り付けた内容が空です", "bad_output");
  if (text.trim().startsWith(prompt.slice(0, 40))) throw new LlmError("貼り付けたのはこちらのプロンプトのままです。AI の回答をコピーしてから、もう一度押してください", "bad_output");
}

function readable<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    const cut = e instanceof Error && e.message.includes("途中で切れて");
    throw new LlmError(cut ? "AI の回答が途中で切れているようです。AI に「続けて」と頼んで、続きも含めてコピーしてください" : "AI の回答を JSON として読めませんでした。回答の最初の { から最後の } までをまるごとコピーしてください", "bad_output");
  }
}

export function parseRecommendAnswer(text: string, prompt: string): RecommendOutput {
  checkPasted(text, prompt);
  const r = readable(() => parseRecommend(text));
  if (!r.queries.length && !r.queries_ja.length) throw new LlmError("回答に検索クエリが見つかりません。AI の回答の JSON 全体をコピーしてください", "bad_output");
  return r;
}

export function parseRankAnswer(text: string, prompt: string, cands: RankCandidate[]): RankItem[] {
  checkPasted(text, prompt);
  const items = readable(() => parseRank(text, cands));
  if (!items.some((it) => it.reason)) throw new LlmError("回答の id が候補と合いません。AI の回答の JSON 全体をそのままコピーしてください", "bad_output");
  return items;
}

// ---- AI チャットで話していた論文を論文リストへ(仕様 4.2) ----
// 相談していたチャットの続きに貼ってもらうので、プロンプトに論文の情報は入れない。会話がそのまま材料になる

const CHAT_PAPERS_HEAD = "ここまでの会話で話題にした論文を、論文リストに取り込むための JSON にまとめてください。";

export function buildChatPapersPrompt(language: string): string {
  const lang = language === "en" ? "English" : "日本語";
  return [
    CHAT_PAPERS_HEAD,
    "- 会話に出てきた論文を、出てきた順にすべて挙げる。同じ論文は 1 回だけ。ブログや解説記事も挙げてよい(kind を \"article\" にし、url を必ず入れる)。",
    "- title は原題のまま(英語の論文なら英語で)。訳さない。",
    "- 書誌情報(authors, year, venue, doi, arxiv_id, url)は、会話に出たものか、確かに分かるものだけ。自信が無い項目は null にする。DOI や arXiv ID を推測で作らない。",
    "- arxiv_id は「2301.00001」の形(版の v は付けない)。doi は「10.」で始まる部分だけ。",
    `- reason は、会話の流れから「なぜこの論文を読むのか・読んで何を確かめたいか」を${lang}で 1〜2 文。`,
    "下の形の JSON だけを返してください。前置き・説明・コードフェンスは不要です。",
    JSON.stringify({ papers: [{ title: "…", authors: ["…"], year: 2017, venue: null, doi: null, arxiv_id: null, url: null, reason: "…", kind: "paper" }] }, null, 1),
  ].join("\n");
}

export type ChatPaperInput = Partial<Paper> & { title: string };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() && !/^(null|none|不明|n\/a|unknown)$/i.test(v.trim()) ? v.trim() : null);

function chatPaper(o: Record<string, unknown>): ChatPaperInput | null {
  const title = text(o.title);
  if (!title) return null;
  const authors = Array.isArray(o.authors) ? o.authors.map(text).filter((a): a is string => !!a) : (text(o.authors)?.split(/\s*[;;、]\s*/).filter(Boolean) ?? []);
  const y = typeof o.year === "number" ? o.year : Number.parseInt(String(o.year ?? ""), 10);
  const year = Number.isInteger(y) && y >= 1000 && y <= 2100 ? y : null;
  const arxiv = ARXIV_ID_RE.exec(text(o.arxiv_id) ?? "")?.[1] ?? null;
  const doiText = text(o.doi);
  const doi = doiText ? (extractDois(doiText)[0] ?? null) : arxiv ? `10.48550/arxiv.${arxiv}` : null;
  const arxivOfDoi = arxiv ?? (doi ? arxivIdFromDoi(doi) : null);
  const url = text(o.url);
  if (o.kind === "article" && url && !doi) {
    const a = articleInput(url, title);
    if (a) return { ...a, reason: text(o.reason), source: "import" };
  }
  return {
    title,
    authors,
    year,
    venue: text(o.venue),
    doi,
    url: url ?? (arxivOfDoi ? `https://arxiv.org/abs/${arxivOfDoi}` : doi ? `https://doi.org/${doi}` : null),
    pdf_url: arxivOfDoi ? `https://arxiv.org/pdf/${arxivOfDoi}` : null,
    reason: text(o.reason),
    source: "import",
  };
}

/** 貼り戻された JSON から論文の候補を取り出す。{ papers: [...] } でも配列だけでもよい */
export function parseChatPapersAnswer(answer: string): ChatPaperInput[] {
  if (!answer.trim()) throw new LlmError("貼り付けた内容が空です", "bad_output");
  if (answer.trim().startsWith(CHAT_PAPERS_HEAD)) throw new LlmError("貼り付けたのはこちらのプロンプトのままです。AI の回答をコピーしてから、もう一度押してください", "bad_output");
  return parsePapersJson(answer);
}

/** JSON から論文の候補を取り出す中身。API の出力(recall)にも貼り戻しにも使う */
export function parsePapersJson(answer: string): ChatPaperInput[] {
  const raw = readable(() => {
    const t = answer.trim();
    // 配列だけで返すモデルもある。parseJsonLoose は { から読むので先に試す
    if (t.startsWith("[")) {
      try {
        return JSON.parse(t) as unknown;
      } catch {
        /* 下で緩く読む */
      }
    }
    return parseJsonLoose<unknown>(t);
  });
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? ((raw as Record<string, unknown>).papers ?? [raw]) : [];
  const out: ChatPaperInput[] = [];
  const seen = new Set<string>();
  for (const o of Array.isArray(list) ? list : []) {
    if (!o || typeof o !== "object") continue;
    const p = chatPaper(o as Record<string, unknown>);
    if (!p) continue;
    const key = p.doi ?? titleKey(p.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  if (!out.length) throw new LlmError("回答に論文が見つかりません。AI の回答の JSON 全体をコピーしてください", "bad_output");
  return out;
}

/** すでにリストにある(外したものは除く)か。DOI か、記号と大小を無視したタイトルで見る */
export function alreadyListed(p: ChatPaperInput, papers: Paper[]): boolean {
  return papers.some((q) => q.status !== "removed" && ((p.doi && q.doi === p.doi) || (p.id && q.id === p.id) || titleKey(q.title) === titleKey(p.title)));
}
