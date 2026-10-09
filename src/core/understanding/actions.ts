// 理解の見える化の保存と LLM 呼び出し。画面からはここを呼ぶ

import type { AppState } from "@/core/app";
import { makeProvider } from "@/core/app";
import * as sql from "@/core/store/db";
import type { GradeOutput, Paper } from "@/core/types";
import type { LlmResponse } from "@/core/llm/provider";
import { estimateCostUsd } from "@/core/usage/cost";
import { buildAnswerRequest, buildQuestionsRequest, calibrationSeries, emptyRecord, parseAnswer, parseQuestions, type AnswerAttempt, type CalibrationPoint, type SeminarQuestion, type UnderstandingRecord } from "./index";

export async function loadRecord(paperId: string): Promise<UnderstandingRecord> {
  return (await sql.loadUnderstanding(paperId)) ?? emptyRecord(paperId);
}

export async function saveSelfRating(rec: UnderstandingRecord, self: number[] | null): Promise<UnderstandingRecord> {
  const next = self ? { ...rec, self, self_at: new Date().toISOString(), self_skipped: false } : { ...rec, self_skipped: true };
  await sql.saveUnderstanding(next);
  return next;
}

export async function setQuestions(rec: UnderstandingRecord, qs: SeminarQuestion[]): Promise<UnderstandingRecord> {
  const next = { ...rec, questions: qs.map((q) => ({ q, attempts: [] })) };
  await sql.saveUnderstanding(next);
  return next;
}

export async function addAttempt(rec: UnderstandingRecord, index: number, attempt: AnswerAttempt): Promise<UnderstandingRecord> {
  const next = { ...rec, questions: rec.questions.map((x, i) => (i === index ? { ...x, attempts: [...x.attempts, attempt] } : x)) };
  await sql.saveUnderstanding(next);
  return next;
}

async function recordUsage(state: AppState, res: LlmResponse) {
  const { provider } = state.settings.llm;
  await sql.insertUsage({
    at: new Date().toISOString(),
    provider,
    model: res.model,
    task: "quiz",
    input_tokens: res.inputTokens,
    output_tokens: res.outputTokens,
    est_cost_usd: estimateCostUsd(provider, res.model, res.inputTokens, res.outputTokens),
  });
}

export async function askQuestions(state: AppState, paper: Paper, material: string, memoBody: string, grade: GradeOutput): Promise<SeminarQuestion[]> {
  const llm = await makeProvider(state.settings);
  const res = await llm.complete(buildQuestionsRequest(paper, material, memoBody, grade, state.settings.language));
  await recordUsage(state, res);
  return parseQuestions(res.text);
}

export async function judgeAnswer(state: AppState, paper: Paper, material: string, q: SeminarQuestion, answer: string): Promise<AnswerAttempt> {
  const llm = await makeProvider(state.settings);
  const res = await llm.complete(buildAnswerRequest(paper, material, q, answer, state.settings.language));
  await recordUsage(state, res);
  return parseAnswer(res.text, answer);
}

export async function loadCalibration(state: AppState): Promise<CalibrationPoint[]> {
  return calibrationSeries(await sql.understandingWithGrades(), state.papers);
}
