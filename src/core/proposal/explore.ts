// はじめの一歩(仕様 13.1)。まだ論文を読んでいない人が、気になること → 検索語 → 論文の候補 → 問いの候補、と進む。
//
// 検索語と並べ替えは「論文を探す」と同じ仕組み(recommend / rank)を使う。ここにあるのは問いの候補(task "question")。
// 問いの候補は AI が出すが、本文には入れない。選んだら自分の言葉で書き直してもらい、それを節を見るときの前提にする。
// 挙げる論文は渡した候補と論文リストからだけ。返ってきた番号はアプリが照合する

import type { Candidate } from "@/core/scholar/types";
import type { ExploreCandidate, Memo, Paper, Proposal, ResearchQuestion } from "@/core/types";
import { LlmError, parseJsonLoose } from "@/core/llm/provider";
import { compactMemoBody } from "@/core/records";
import { newId } from "./model";

/** 検索語を作るときに渡す補足。recommend の context に入る */
export function explorePurpose(curiosity: string): string {
  return `研究計画を立てる前の最初の文献調査。まだ論文を 1 本も読んでいない学部生の関心: ${curiosity.trim()}`;
}

/** 候補を並べる基準。rank の criterion に入る */
export const EXPLORE_CRITERION = "この関心から研究の問いを立てるのに役立つ順。全体像が分かるサーベイ・解説、代表的な研究、結論が分かれている・まだ答えが出ていない研究が混ざるように";

/** 計画書に残す候補の数 */
export const MAX_SAVED_CANDIDATES = 20;

export function toExploreCandidate(c: Candidate & { reason?: string }): ExploreCandidate {
  return {
    id: c.id,
    title: c.title,
    authors: (c.authors ?? []).slice(0, 6),
    year: c.year ?? null,
    venue: c.venue ?? null,
    doi: c.doi ?? null,
    url: c.url ?? null,
    pdf_url: c.pdf_url ?? null,
    abstract: c.abstract ? c.abstract.slice(0, 1500) : null,
    cited_by: c.cited_by ?? 0,
    reason: c.reason ?? "",
  };
}

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          why: { type: "string" },
          unknown: { type: "string" },
          approach: { type: "string" },
          refs: { type: "array", items: { type: "string" } },
          first_read: { type: "string" },
        },
        required: ["question", "why", "unknown", "approach", "refs", "first_read"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const RULES = [
  "あなたは研究を始めたばかりの学部生を指導する教員です。学生の関心と、見つけた論文の候補から、研究の問いの候補を 3〜5 個出してください。",
  "問いは学部生が 1 年ほどで取り組める大きさにし、互いに違う方向にしてください(対象を変える・方法を変える・評価のしかたを変える、など)。",
  "論文は下の一覧から [P番号] でだけ挙げてください。一覧に無い論文を挙げたり作ったりしないでください。",
  "論文の内容について言うときは、タイトル・アブストラクト・メモに書かれた範囲にとどめ、推測で断定しないでください。「まだ分かっていないこと」が一覧から言えなければ、「候補の論文からは分からない。読んで確かめる」と書いてください。",
  "これは候補です。学生が自分で選んで、自分の言葉で書き直します。",
].join("");

const FIELDS = [
  "questions の各項目:",
  "question: 問い(疑問文で 1 文)",
  "why: なぜ大事か(1〜2 文)",
  "unknown: 一覧の論文から見て、まだ分かっていないこと(1〜2 文)",
  "approach: どう確かめるか(1 文。データ・実験・調査のどれをするか)",
  "refs: この問いに関係する論文の P 番号(1〜4 個)",
  "first_read: 最初に読むとよい 1 本の P 番号",
].join("\n");

export interface QuestionMaterial {
  /** P1, P2, … → 論文 ID */
  refs: Map<string, string>;
  text: string;
}

/**
 * 渡す論文。印を付けた候補(無ければ並びの上から 10 本)と、論文リストで読んだもの(メモつき、20 本まで)。
 * ID は長いので P 番号に置き換えて渡し、戻すときに照合する
 */
export function questionMaterial(p: Proposal, papers: Paper[], memos: Memo[]): QuestionMaterial {
  const ex = p.exploration;
  const picked = ex.candidates.filter((c) => ex.picked.includes(c.id));
  const cands = picked.length ? picked : ex.candidates.slice(0, 10);
  const memoOf = new Map<string, Memo>();
  for (const m of memos) if (m.frontmatter.completed) memoOf.set(m.frontmatter.paper_id, m);
  const read = papers.filter((x) => x.status !== "removed" && memoOf.has(x.id) && !cands.some((c) => c.id === x.id)).slice(0, 20);
  const refs = new Map<string, string>();
  const lines: string[] = [];
  const add = (id: string, head: string, body: string) => {
    const ref = `P${refs.size + 1}`;
    refs.set(ref, id);
    lines.push(`[${ref}] ${head}\n  ${body}`);
  };
  const who = (authors: string[], year: number | null) => [authors[0], year].filter(Boolean).join(", ");
  for (const c of cands) add(c.id, `${c.title}(${who(c.authors, c.year)})`, c.abstract ? `アブスト: ${oneLine(c.abstract, 700)}` : "アブストなし(タイトルだけ)");
  for (const x of read) add(x.id, `${x.title}(${who(x.authors, x.year)}) 読んだ論文`, `本人のメモ: ${oneLine(compactMemoBody(memoOf.get(x.id)!.body), 300)}`);
  return { refs, text: lines.join("\n") || "(論文はまだありません)" };
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

export function buildQuestionRequest(p: Proposal, papers: Paper[], memos: Memo[], language: string) {
  const lang = language === "en" ? "English" : "日本語";
  const m = questionMaterial(p, papers, memos);
  const user = [
    `[学生の関心] ${p.exploration.curiosity.trim()}`,
    p.purpose.trim() ? `[計画書の目的・提出先] ${p.purpose.trim()}` : "",
    "",
    "[論文の一覧]",
    m.text,
    "",
    FIELDS,
  ]
    .filter((l, i, xs) => l !== "" || xs[i - 1] !== "")
    .join("\n");
  return { request: { system: `${RULES}出力は${lang}で。`, user, schema: QUESTION_SCHEMA, maxTokens: 3000, effort: "medium" as const }, refs: m.refs };
}

export const QUESTION_PROMPT_HEAD = "研究の問いの候補を出してください。";

export function buildQuestionPrompt(p: Proposal, papers: Paper[], memos: Memo[], language: string): { prompt: string; refs: Map<string, string> } {
  const { request, refs } = buildQuestionRequest(p, papers, memos, language);
  const shape = { questions: [{ question: "…?", why: "…", unknown: "…", approach: "…", refs: ["P1"], first_read: "P1" }] };
  return { prompt: [QUESTION_PROMPT_HEAD, request.system, "", request.user, "", "下の形の JSON だけを返してください。前置き・説明・コードフェンスは不要です。", JSON.stringify(shape, null, 1)].join("\n"), refs };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** P 番号を論文 ID に戻す。一覧に無い番号は捨てる */
export function normalizeQuestions(raw: unknown, refs: Map<string, string>): ResearchQuestion[] {
  const r = (raw ?? {}) as { questions?: unknown };
  const toId = (v: unknown) => {
    const m = /P\s*(\d+)/i.exec(String(v ?? ""));
    return m ? (refs.get(`P${Number(m[1])}`) ?? null) : null;
  };
  return (Array.isArray(r.questions) ? r.questions : [])
    .flatMap((x) => {
      const q = (x ?? {}) as Record<string, unknown>;
      const question = str(q.question);
      if (!question) return [];
      const ids = [...new Set((Array.isArray(q.refs) ? q.refs : []).map(toId).filter((id): id is string => !!id))].slice(0, 4);
      const first = toId(q.first_read);
      return [{ id: newId("q"), question, why: str(q.why), unknown: str(q.unknown), approach: str(q.approach), paper_ids: ids, first_read: first }];
    })
    .slice(0, 5);
}

export function parseQuestionAnswer(text: string, refs: Map<string, string>): ResearchQuestion[] {
  if (!text.trim()) throw new LlmError("貼り付けた内容が空です", "bad_output");
  if (text.trim().startsWith(QUESTION_PROMPT_HEAD)) throw new LlmError("貼り付けたのはこちらのプロンプトのままです。AI の回答をコピーしてから、もう一度押してください", "bad_output");
  let raw: unknown;
  try {
    raw = parseJsonLoose(text);
  } catch {
    throw new LlmError("AI の回答を JSON として読めませんでした。回答の最初の { から最後の } までをまるごとコピーしてください", "bad_output");
  }
  const qs = normalizeQuestions(raw, refs);
  if (!qs.length) throw new LlmError("回答に問いの候補が見つかりません。AI の回答の JSON 全体をコピーしてください", "bad_output");
  return qs;
}

/** 節を AI に見せるときに添える「本人の問い」。自分の言葉で書いたものを優先する */
export function questionForCoach(p: Proposal): string {
  const ex = p.exploration;
  if (ex.my_question.trim()) return ex.my_question.trim();
  const q = ex.questions.find((x) => x.id === ex.chosen);
  return q ? `${q.question}(AI が出した候補から本人が選んだもの。まだ自分の言葉では書いていない)` : "";
}
