// 理解の見える化(仕様 7.5)
// 1. わかったつもりの見える化: AI に見せる前に、採点と同じ 4 項目を自分で 1〜5 で付ける。採点と並べて「つもり」との差を出す
// 2. ゼミの予行演習: 指導教員役の AI が 3 問だけ聞く。答えを採点し、聞いた項目の点を答えの点で置き換える(理解の更新)

import type { GradeOutput, Paper, SummaryOutput } from "@/core/types";
import { GRADE_ITEMS, paperHeader } from "@/core/llm/tasks";
import { LlmError, parseJsonLoose } from "@/core/llm/provider";

/** 採点の 4 項目(GRADE_ITEMS)の短い名前。図の行の見出しに使う */
export const AXIS_LABELS = ["問題設定", "手法", "結果", "自分の視点"] as const;
export type Axis = 0 | 1 | 2 | 3;
export const AXES: Axis[] = [0, 1, 2, 3];

export type Verdict = "ok" | "partial" | "miss";

export interface SeminarQuestion {
  axis: Axis;
  question: string;
  /** よい答えに入っているべきこと。答えるまで見せない */
  look_for: string;
}

export interface AnswerAttempt {
  answer: string;
  score: number; // 1-5
  verdict: Verdict;
  feedback: string;
  at: string;
}

export interface UnderstandingRecord {
  paper_id: string;
  /** 自己評価(項目ごとに 1〜5)。飛ばしたら null */
  self: number[] | null;
  self_at: string | null;
  /** 自己評価を飛ばしたか。飛ばした人にもう一度は聞かない */
  self_skipped: boolean;
  questions: { q: SeminarQuestion; attempts: AnswerAttempt[] }[];
}

export function emptyRecord(paperId: string): UnderstandingRecord {
  return { paper_id: paperId, self: null, self_at: null, self_skipped: false, questions: [] };
}

const clampScore = (n: unknown) => Math.max(1, Math.min(5, Math.round(Number(n) || 1)));

/** 点数から判定。LLM の申告より点を信じる */
export function verdictOf(score: number): Verdict {
  return score >= 4 ? "ok" : score >= 3 ? "partial" : "miss";
}

export const VERDICT_LABELS: Record<Verdict, string> = { ok: "答えられた", partial: "半分", miss: "答えられなかった" };

// ---- 段階ごとの点 ----

export interface Stages {
  /** 自分で付けた点。無ければ null */
  self: number[] | null;
  /** メモの採点 */
  memo: number[];
  /** 質問に答えたあと。聞かれた項目は最後の答えの点(同じ項目に 2 問あれば平均)、聞かれていない項目はメモの点のまま */
  after: number[];
  /** 質問で確かめた項目 */
  asked: boolean[];
}

export function stages(rec: UnderstandingRecord | null, grade: GradeOutput): Stages {
  const memo = AXES.map((a) => grade.items[a]?.score ?? 1);
  const latest: number[][] = AXES.map(() => []);
  for (const { q, attempts } of rec?.questions ?? []) {
    const last = attempts[attempts.length - 1];
    if (last) latest[q.axis].push(last.score);
  }
  const after = AXES.map((a) => (latest[a].length ? Math.round((latest[a].reduce((x, y) => x + y, 0) / latest[a].length) * 10) / 10 : memo[a]));
  return { self: rec?.self ?? null, memo, after, asked: latest.map((xs) => xs.length > 0) };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** つもりの差。正なら「わかったつもり」(自己評価が採点より高い)。満点 20 の点差 */
export function calibrationGap(self: number[], grade: GradeOutput): number {
  return sum(self) - sum(AXES.map((a) => grade.items[a]?.score ?? 1));
}

export interface CalibrationPoint {
  paper_id: string;
  title: string;
  at: string;
  self: number;
  actual: number;
  gap: number;
}

/** 古い順 */
export function calibrationSeries(rows: { rec: UnderstandingRecord; grade: GradeOutput }[], papers: Paper[]): CalibrationPoint[] {
  const titles = new Map(papers.map((p) => [p.id, p.title]));
  return rows
    .filter((r): r is { rec: UnderstandingRecord & { self: number[]; self_at: string }; grade: GradeOutput } => !!r.rec.self && !!r.rec.self_at)
    .map(({ rec, grade }) => {
      const actual = sum(AXES.map((a) => grade.items[a]?.score ?? 1));
      return { paper_id: rec.paper_id, title: titles.get(rec.paper_id) ?? "(削除した論文)", at: rec.self_at, self: sum(rec.self), actual, gap: sum(rec.self) - actual };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

// ---- LLM への頼み方 ----

/** 質問の材料。全文を毎回抜き直さないよう、アブストと保存済みの AI 要約(全文から作ったものもある)を渡す */
export function questionMaterial(paper: Paper, summary: SummaryOutput | null): string {
  const parts = [paper.abstract ? `[アブストラクト]\n${paper.abstract}` : ""];
  if (summary) parts.push(`[AI 要約]\n問題: ${summary.problem}\n手法: ${summary.method}\n結果: ${summary.results}\n限界: ${summary.limitations}`);
  return parts.filter(Boolean).join("\n\n") || "(タイトルと書誌情報のみ)";
}

const QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { axis: { type: "integer" }, question: { type: "string" }, look_for: { type: "string" } },
        required: ["axis", "question", "look_for"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const QUESTIONS_SHAPE = { questions: [{ axis: 1, question: "質問(1〜2 文)", look_for: "よい答えに入っているべきこと(1〜2 文)" }] };

export function buildQuestionsRequest(paper: Paper, material: string, memoBody: string, grade: GradeOutput, language: string) {
  const lang = language === "en" ? "English" : "日本語";
  const weak = AXES.map((a) => `${a}. ${GRADE_ITEMS[a]}(メモの点 ${grade.items[a]?.score ?? "?"}/5)`).join("\n");
  const gaps = [...(grade.missing_points ?? []), ...(grade.misreadings ?? [])];
  return {
    system: `あなたは研究室のゼミで、学生の論文紹介を聞いている指導教員です。学生がこの論文を本当に理解しているかを確かめる質問を、ちょうど 3 問してください。ゼミで実際に聞かれそうな、短く具体的な質問にすること(「なぜこのベースラインと比べたのか」「この手法が効かない場面は」「君の研究ならどう使う」など)。用語の定義を聞くだけの質問や、渡した論文情報から答えが出せない細部の質問はしないこと。メモの点が低い項目を優先し、3 問で少なくとも 2 つの項目に触れること。出力は${lang}で。`,
    user: `${paperHeader(paper)}\n\n${material}\n\n[学生のメモ]\n${memoBody}\n\n[項目(axis はこの番号)]\n${weak}${gaps.length ? `\n\n[メモで抜けていた・食い違っていた点]\n${gaps.map((g) => `- ${g}`).join("\n")}` : ""}\n\nquestions に 3 問。axis は上の番号(0〜3)、question は質問、look_for はよい答えに入っているべきこと(学生には答えたあとで見せる)。`,
    schema: QUESTIONS_SCHEMA,
    maxTokens: 1024,
    effort: "medium" as const,
  };
}

export function parseQuestions(text: string): SeminarQuestion[] {
  const raw = parseJsonLoose<{ questions?: unknown }>(text);
  const list = Array.isArray(raw?.questions) ? raw.questions : [];
  const qs = list.flatMap((x) => {
    const { axis, question, look_for } = (x ?? {}) as Record<string, unknown>;
    const a = Math.round(Number(axis));
    if (typeof question !== "string" || !question.trim() || !(a >= 0 && a <= 3)) return [];
    return [{ axis: a as Axis, question: question.trim(), look_for: typeof look_for === "string" ? look_for.trim() : "" }];
  });
  if (!qs.length) throw new LlmError("質問を読み取れませんでした。AI の回答の JSON 全体をコピーしてください", "bad_output");
  return qs.slice(0, 3);
}

const ANSWER_SCHEMA = {
  type: "object",
  properties: { score: { type: "integer" }, feedback: { type: "string" } },
  required: ["score", "feedback"],
  additionalProperties: false,
};

const ANSWER_SHAPE = { score: 3, feedback: "1〜2 文" };

export function buildAnswerRequest(paper: Paper, material: string, q: SeminarQuestion, answer: string, language: string) {
  const lang = language === "en" ? "English" : "日本語";
  return {
    system: `あなたは研究室のゼミの指導教員です。自分がした質問への学生の答えを 1〜5 点で採点します。5 = 論文に即して正確で、自分の言葉で説明できている。4 = おおむね正しい。3 = 方向は合っているが曖昧・不足がある。2 = 一部しか答えていない、または誤りを含む。1 = 答えになっていない。見る対象は答えに書かれていることだけです。短さ自体は責めないでください。feedback は 1〜2 文で、足りない点を具体的に。出力は${lang}で。`,
    user: `${paperHeader(paper)}\n\n${material}\n\n[質問(${GRADE_ITEMS[q.axis]})]\n${q.question}\n\n[よい答えに入っているべきこと]\n${q.look_for || "(指定なし)"}\n\n[学生の答え]\n${answer}`,
    schema: ANSWER_SCHEMA,
    maxTokens: 512,
    effort: "low" as const,
  };
}

export function parseAnswer(text: string, answer: string): AnswerAttempt {
  const raw = parseJsonLoose<{ score?: unknown; feedback?: unknown }>(text);
  if (raw?.score === undefined) throw new LlmError("採点を読み取れませんでした。AI の回答の JSON 全体をコピーしてください", "bad_output");
  const score = clampScore(raw.score);
  return { answer, score, verdict: verdictOf(score), feedback: typeof raw.feedback === "string" ? raw.feedback.trim() : "", at: new Date().toISOString() };
}

/** API を通さない道(貼り付け)用。スキーマを渡せないので、形は文面で伝える */
export function asHandoffPrompt(req: { system: string; user: string }, kind: "questions" | "answer"): string {
  return [req.system, "", req.user, "", "下の形の JSON だけを返してください。前置き・説明・コードフェンスは不要です。", JSON.stringify(kind === "questions" ? QUESTIONS_SHAPE : ANSWER_SHAPE)].join("\n");
}
