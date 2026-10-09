// 研究計画書の節を AI に見てもらう(仕様 13、task "proposal")。
//
// 方針はメモの採点と同じ: AI は本文を書かない。自分で書いた節を読んで、足りない点・聞かれそうなこと・根拠が要る文・
// 引ける論文を返すだけ。論文は「論文リストにあるもの」からしか挙げさせず、返ってきたキーと文はアプリが照合する。
// LLM の申告は信じない(要約の根拠と同じ考え方)

import type { Memo, Paper, Proposal, ProposalFeedback } from "@/core/types";
import { LlmError, parseJsonLoose } from "@/core/llm/provider";
import { squash } from "@/core/llm/tasks";
import { compactMemoBody } from "@/core/records";
import { citeKeys, citedKeys, sectionChars } from "./model";

/** 貼り付けで戻ってきたものがプロンプトのままかを見分ける */
export const COACH_PROMPT_HEAD = "研究計画書の 1 つの節を読んで、書いた本人に返すコメントをください。";

/** これより短い節は見てもらわない。AI に書かせる道にしないため */
export const MIN_COACH_CHARS = 30;

const MAX_LIBRARY = 80;

const COACH_SCHEMA = {
  type: "object",
  properties: {
    good_points: { type: "array", items: { type: "string" } },
    missing_points: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    needs_citation: {
      type: "array",
      items: {
        type: "object",
        properties: { sentence: { type: "string" }, keys: { type: "array", items: { type: "string" } } },
        required: ["sentence", "keys"],
        additionalProperties: false,
      },
    },
    suggested: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, reason: { type: "string" } },
        required: ["key", "reason"],
        additionalProperties: false,
      },
    },
    next_step: { type: "string" },
  },
  required: ["good_points", "missing_points", "questions", "needs_citation", "suggested", "next_step"],
  additionalProperties: false,
};

const RULES = [
  "あなたは研究計画書を見る指導教員です。学生が自分で書いた節を読み、良い点と足りない点を返してください。",
  "本文を代わりに書いたり、書き直した文を示したりしないでください。学生が自分で直せるように、何が足りないか・どこを詰めるかを具体的に示してください。",
  "文献は下の「手元の論文」からだけ挙げ、key をそのまま使ってください。手元に無い論文を挙げたり、作ったりしないでください。合うものが無ければ空配列にしてください。",
  "手元の論文の内容について言うときは、書かれているタイトル・メモ・アブストラクトの範囲にとどめ、推測で断定しないでください。",
].join("");

const FIELDS = [
  "good_points: この節のよく書けている点を最大 3 つ。無ければ空配列。",
  "missing_points: この節の役割に照らして足りないもの・曖昧なものを最大 3 つ。",
  "questions: 指導教員や審査する人がこの節を読んで聞きそうな質問を最大 3 つ。",
  "needs_citation: 根拠(文献)が要りそうなのに引用が無い文を最大 5 つ。sentence は節の本文から一字一句そのまま抜き出す。keys は手元の論文で根拠になりそうなものの key(無ければ空配列)。",
  "suggested: この節で引けそうな手元の論文を最大 5 つ。reason はその論文をこの節のどこで使えるかを 1 文で。すでに引用されているものは挙げない。",
  "next_step: 次にこの節で手をつけることを 1 文で。",
].join("\n");

/** 手元の論文。読んだもの(メモつき)を先に、次に引用済み、残りの未読(アブスト少し)。多すぎるときは切る */
export function libraryForCoach(p: Proposal, papers: Paper[], memos: Memo[]): string {
  const keys = citeKeys(papers);
  const cited = new Set(citedKeys(p.sections.map((s) => s.body)));
  const memoOf = new Map<string, Memo>();
  for (const m of memos) if (m.frontmatter.completed) memoOf.set(m.frontmatter.paper_id, m);
  const live = papers.filter((x) => x.status !== "removed" || cited.has(keys.get(x.id)!));
  const rank = (x: Paper) => (memoOf.has(x.id) ? 0 : cited.has(keys.get(x.id)!) ? 1 : 2);
  const sorted = [...live].sort((a, b) => rank(a) - rank(b) || ((b.read_at ?? b.added_at) < (a.read_at ?? a.added_at) ? -1 : 1)).slice(0, MAX_LIBRARY);
  if (!sorted.length) return "(論文リストは空です)";
  return sorted
    .map((x) => {
      const head = `key=${keys.get(x.id)} ${x.title}(${[x.authors[0], x.year].filter(Boolean).join(", ")})${cited.has(keys.get(x.id)!) ? " [引用済み]" : ""}`;
      const memo = memoOf.get(x.id);
      if (memo) return `${head}\n  読んだ人のメモ: ${oneLine(compactMemoBody(memo.body), 300)}`;
      return x.abstract ? `${head}\n  未読。アブスト冒頭: ${oneLine(x.abstract, 160)}` : `${head}\n  未読。`;
    })
    .join("\n");
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

function sectionContext(p: Proposal, sectionId: string): string {
  return p.sections
    .filter((s) => s.id !== sectionId)
    .map((s) => `■ ${s.heading || "(見出しなし)"}\n${s.body.trim() ? oneLine(s.body, 400) : "(未記入)"}`)
    .join("\n");
}

export function buildCoachRequest(p: Proposal, sectionId: string, papers: Paper[], memos: Memo[], language: string) {
  const s = p.sections.find((x) => x.id === sectionId);
  if (!s) throw new Error("節が見つかりません");
  const lang = language === "en" ? "English" : "日本語";
  const user = [
    `[計画書の目的・提出先] ${p.purpose.trim() || "(未記入)"}`,
    `[研究題目] ${p.title.trim() || "(未記入)"}`,
    "",
    "[ほかの節(要約)]",
    sectionContext(p, sectionId) || "(なし)",
    "",
    `[見てほしい節] ${s.heading || "(見出しなし)"}`,
    s.hint ? `この節の役割: ${s.hint}` : "",
    s.limit ? `字数の上限: ${s.limit} 字(今 ${sectionChars(s.body)} 字)` : "",
    "本文([@key] は引用):",
    s.body.trim(),
    "",
    "[手元の論文]",
    libraryForCoach(p, papers, memos),
    "",
    FIELDS,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { system: `${RULES}出力は${lang}で。`, user, schema: COACH_SCHEMA, maxTokens: 2048, effort: "medium" as const };
}

/** API を通さないときに、好きな AI に貼る文面 */
export function buildCoachPrompt(p: Proposal, sectionId: string, papers: Paper[], memos: Memo[], language: string): string {
  const r = buildCoachRequest(p, sectionId, papers, memos, language);
  const shape = { good_points: [], missing_points: [], questions: [], needs_citation: [{ sentence: "本文からそのまま", keys: ["key"] }], suggested: [{ key: "key", reason: "1 文" }], next_step: "1 文" };
  return [COACH_PROMPT_HEAD, r.system, "", r.user, "", "下の形の JSON だけを返してください。前置き・説明・コードフェンスは不要です。", JSON.stringify(shape, null, 1)].join("\n");
}

const list = (xs: unknown, max: number) => (Array.isArray(xs) ? xs.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max) : []);

/**
 * 返ってきたものを読み、照合する。手元に無いキーは落とし、本文に無い文は落とす。
 * known は論文リストの引用キー、body は見てもらった節の本文
 */
export function normalizeCoach(raw: unknown, known: Set<string>, body: string, now = new Date()): ProposalFeedback {
  const r = (raw ?? {}) as Record<string, unknown>;
  const hay = squash(body);
  const keysOf = (xs: unknown) => list(xs, 5).map((k) => k.replace(/^@/, "")).filter((k) => known.has(k));
  const needs = (Array.isArray(r.needs_citation) ? r.needs_citation : []).flatMap((x) => {
    const { sentence, keys } = (x ?? {}) as { sentence?: unknown; keys?: unknown };
    const s = typeof sentence === "string" ? sentence.trim() : "";
    const needle = squash(s.replace(/(\.\.\.|…)$/, ""));
    return s && needle.length >= 6 && hay.includes(needle) ? [{ sentence: s, keys: keysOf(keys) }] : [];
  });
  const cited = new Set(citedKeys([body]));
  const seen = new Set<string>();
  const suggested = (Array.isArray(r.suggested) ? r.suggested : []).flatMap((x) => {
    const { key, reason } = (x ?? {}) as { key?: unknown; reason?: unknown };
    const k = typeof key === "string" ? key.trim().replace(/^@/, "") : "";
    if (!known.has(k) || cited.has(k) || seen.has(k)) return [];
    seen.add(k);
    return [{ key: k, reason: typeof reason === "string" ? reason.trim() : "" }];
  });
  return {
    good_points: list(r.good_points, 3),
    missing_points: list(r.missing_points, 3),
    questions: list(r.questions, 3),
    needs_citation: needs.slice(0, 5),
    suggested: suggested.slice(0, 5),
    next_step: typeof r.next_step === "string" ? r.next_step.trim() : "",
    created_at: now.toISOString(),
    body_seen: body,
  };
}

/** 好きな AI から貼り戻された回答を読む */
export function parseCoachAnswer(text: string, known: Set<string>, body: string): ProposalFeedback {
  if (!text.trim()) throw new LlmError("貼り付けた内容が空です", "bad_output");
  if (text.trim().startsWith(COACH_PROMPT_HEAD)) throw new LlmError("貼り付けたのはこちらの頼む文面のままです。AI の回答をコピーしてから、もう一度押してください", "bad_output");
  let raw: unknown;
  try {
    raw = parseJsonLoose(text);
  } catch {
    throw new LlmError("AI の回答を JSON として読めませんでした。回答の最初の { から最後の } までをまるごとコピーしてください", "bad_output");
  }
  const fb = normalizeCoach(raw, known, body);
  if (!fb.good_points.length && !fb.missing_points.length && !fb.questions.length && !fb.next_step) {
    throw new LlmError("コメントが見つかりません。AI の回答の JSON 全体をコピーしてください", "bad_output");
  }
  return fb;
}
