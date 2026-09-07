// LLM タスク(仕様 7.2): recommend / rank / summary / grade

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


// ---- recommend: キーワード → 検索クエリ(仕様 7.2) ----

const RECOMMEND_SCHEMA = {
  type: "object",
  properties: { queries: { type: "array", items: { type: "string" } } },
  required: ["queries"],
  additionalProperties: false,
};

export function buildRecommendRequest(keywords: string, context: string, language: string) {
  return {
    system:
      "あなたは研究者の文献調査を助ける司書です。ユーザーの興味に基づき、学術検索エンジン(OpenAlex)に投げる英語の検索クエリを 4〜6 個作ってください。基礎となる古典・サーベイ・最近の代表的手法が混ざるように、観点を変えたクエリにしてください。各クエリは 2〜6 語。",
    user: `興味のあるキーワード: ${keywords}${context ? `\n補足: ${context}` : ""}\n\n出力言語(クエリ以外の説明は不要): ${language}`,
    schema: RECOMMEND_SCHEMA,
    maxTokens: 512,
    effort: "low" as const,
  };
}

export async function runRecommend(llm: LlmProvider, keywords: string, context: string, language: string): Promise<TaskResult<{ queries: string[] }>> {
  const res = await llm.complete(buildRecommendRequest(keywords, context, language));
  return { output: parseJsonLoose<{ queries: string[] }>(res.text), res };
}

// ---- rank: 候補を順位付けし「読むべき理由」を付ける ----

export interface RankCandidate {
  id: string;
  title: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  abstract?: string | null;
  cited_by?: number;
}

export interface RankItem {
  id: string;
  rank: number;
  reason: string;
}

const RANK_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, rank: { type: "integer" }, reason: { type: "string" } },
        required: ["id", "rank", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

export function buildRankRequest(cands: RankCandidate[], purpose: string, criterion: string, language: string) {
  const lang = language === "en" ? "English" : "日本語";
  const list = cands
    .map((c, i) => {
      const abs = c.abstract ? c.abstract.slice(0, 600) : "(アブストなし)";
      return `[${i + 1}] id=${c.id}\n${c.title}\n${(c.authors ?? []).slice(0, 3).join(", ")} (${c.year ?? "?"}) ${c.venue ?? ""} 被引用 ${c.cited_by ?? "?"}\n${abs}`;
    })
    .join("\n\n");
  return {
    system: `あなたは研究者の読書計画を助けるメンターです。候補論文を「${criterion}」の基準で並べ、各論文に 1〜2 文の「読むべき理由」を付けてください。理由は${lang}で、その論文固有の内容に触れること。候補にない論文を足さないこと。id は与えられたものをそのまま使うこと。`,
    user: `目的: ${purpose}\n\n候補:\n${list}\n\n全候補を rank 1 から順に並べて items に入れてください。`,
    schema: RANK_SCHEMA,
    maxTokens: 4096,
    effort: "medium" as const,
  };
}

export async function runRank(llm: LlmProvider, cands: RankCandidate[], purpose: string, criterion: string, language: string): Promise<TaskResult<RankItem[]>> {
  const res = await llm.complete(buildRankRequest(cands, purpose, criterion, language));
  const out = parseJsonLoose<{ items: RankItem[] }>(res.text);
  const known = new Set(cands.map((c) => c.id));
  const items = out.items.filter((it) => known.has(it.id)).sort((a, b) => a.rank - b.rank);
  // 抜けた候補は末尾に
  const seen = new Set(items.map((i) => i.id));
  let r = items.length;
  for (const c of cands) if (!seen.has(c.id)) items.push({ id: c.id, rank: ++r, reason: "" });
  return { output: items, res };
}
