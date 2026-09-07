// LLM タスク(仕様 7.2)。MVP は summary と grade。

import type { GradeOutput, Paper, SummaryOutput } from "@/core/types";
import { parseJsonLoose, type LlmProvider, type LlmResponse } from "./provider";

export const GRADE_ITEMS = [
  "問題設定を把握しているか",
  "手法を自分の言葉で説明できているか",
  "結果を正しく捉えているか",
  "自分の視点(疑問・応用)があるか",
] as const;

export interface PaperContext {
  paper: Paper;
  /** アブストラクト or 全文 or 貼り付け */
  text: string;
  inputKind: "abstract" | "fulltext" | "pasted";
}

function paperHeader(p: Paper): string {
  const authors = p.authors.length ? p.authors.join(", ") : "(著者不明)";
  return `タイトル: ${p.title}\n著者: ${authors}\n年: ${p.year ?? "?"}${p.venue ? `\n掲載: ${p.venue}` : ""}`;
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    problem: { type: "string" },
    method: { type: "string" },
    results: { type: "string" },
    limitations: { type: "string" },
  },
  required: ["problem", "method", "results", "limitations"],
  additionalProperties: false,
};

export function buildSummaryRequest(ctx: PaperContext, language: string) {
  const lang = language === "en" ? "English" : "日本語";
  return {
    system: `あなたは研究者の論文読解を助けるアシスタントです。与えられた論文情報から、事実に基づいて簡潔に要約してください。情報が不足している項目は推測せず「不明」と書いてください。出力は${lang}で。`,
    user: `${paperHeader(ctx.paper)}\n\n[${ctx.inputKind === "abstract" ? "アブストラクト" : ctx.inputKind === "fulltext" ? "本文" : "ユーザー提供テキスト"}]\n${ctx.text}\n\n各項目 2〜4 文で: problem(何を解いた/論じた問題か), method(手法の要点), results(結果・主張), limitations(限界・注意点)`,
    schema: SUMMARY_SCHEMA,
    maxTokens: 2048,
    effort: "medium" as const,
  };
}

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          score: { type: "integer" }, // 範囲制約は API 非対応。runGrade で 1〜5 に丸める
          comment: { type: "string" },
        },
        required: ["name", "score", "comment"],
        additionalProperties: false,
      },
    },
    total: { type: "integer" },
    overall_comment: { type: "string" },
    missing_points: { type: "array", items: { type: "string" } },
  },
  required: ["items", "total", "overall_comment", "missing_points"],
  additionalProperties: false,
};

export function buildGradeRequest(ctx: PaperContext, memoBody: string, language: string) {
  const lang = language === "en" ? "English" : "日本語";
  const missing =
    ctx.inputKind === "fulltext"
      ? "missing_points には、本文にあってメモに書かれていない重要な点を最大 3 つ挙げてください。"
      : "missing_points は空配列にしてください(本文がないため判断しない)。";
  return {
    system: `あなたは論文読解メモを採点する指導教員です。採点対象は「メモに書かれていること」だけです。メモに書かれていない知識で減点したり、書かれていないことを書かれているとみなしたりしないでください。各項目 1〜5 点。コメントは具体的に、次に何を書けばよくなるかを示してください。出力は${lang}で。`,
    user: `${paperHeader(ctx.paper)}\n\n[論文情報 (${ctx.inputKind})]\n${ctx.text}\n\n[ユーザーのメモ]\n${memoBody}\n\n採点項目(この順・この名前で items に入れる):\n${GRADE_ITEMS.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\ntotal は 4 項目の合計。overall_comment は 2〜3 文。${missing}`,
    schema: GRADE_SCHEMA,
    maxTokens: 2048,
    effort: "medium" as const,
  };
}

export async function runSummary(llm: LlmProvider, ctx: PaperContext, language: string) {
  const res = await llm.complete(buildSummaryRequest(ctx, language));
  return { output: parseJsonLoose<SummaryOutput>(res.text), res };
}

export async function runGrade(llm: LlmProvider, ctx: PaperContext, memoBody: string, language: string) {
  const res = await llm.complete(buildGradeRequest(ctx, memoBody, language));
  const output = parseJsonLoose<GradeOutput>(res.text);
  // 範囲はスキーマで縛れないのでここで丸め、total もモデルの申告を信じず再計算
  output.items = output.items.map((it) => ({ ...it, score: Math.max(1, Math.min(5, Math.round(Number(it.score) || 1))) }));
  output.total = output.items.reduce((a, b) => a + b.score, 0);
  return { output, res };
}

export type TaskResult<T> = { output: T; res: LlmResponse };
