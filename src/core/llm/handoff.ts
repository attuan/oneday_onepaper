// API を通さずに要約と採点をもらう道(仕様 7.4)。
// プロンプトをクリップボードに置き、(a) Apple のショートカットに Apple Intelligence で処理させるか、
// (b) ユーザーが好きなチャット AI に貼る。どちらも結果はクリップボード経由で貼り戻してもらう。
// URL に本文を載せないのは、長さの上限(行きはショートカットの URL、帰りは配信サーバー)に当たるため

import type { GradeOutput, SummaryOutput } from "@/core/types";
import { LlmError, parseJsonLoose } from "./provider";
import { EVIDENCE_RULES, FEEDBACK_RULES, GRADE_ITEMS, GRADE_RULES, normalizeGrade, paperHeader, verifyEvidence, type PaperContext } from "./tasks";

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
