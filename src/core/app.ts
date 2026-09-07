// アプリの操作をまとめる層。UI はここだけを呼ぶ

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { DayLog, GradeOutput, Memo, Paper, Settings, SummaryOutput } from "@/core/types";
import { logicalDate } from "@/core/schedule/logicalDay";
import { judgeMissingDays } from "@/core/schedule/judge";
import { markRead, newPaper, removePaper, reorderQueue, skipPaper, todaysPaper } from "@/core/papers/queue";
import { csvToPapers } from "@/core/papers/csv";
import { countMemoChars, memoTemplate } from "@/core/memo/format";
import { judgeCompletion } from "@/core/memo/completion";
import { AnthropicProvider } from "@/core/llm/anthropic";
import { OllamaProvider } from "@/core/llm/ollama";
import type { LlmProvider } from "@/core/llm/provider";
import { buildGradeRequest, buildSummaryRequest, runGrade, runSummary, type PaperContext } from "@/core/llm/tasks";
import { estimateCostUsd, roughTokenCount } from "@/core/usage/cost";
import { fs, secret } from "@/core/store/tauri";
import { loadSettings, resolveDataDir, saveSettings } from "@/core/store/settings";
import { loadPapers, savePapers } from "@/core/store/papers";
import { findMemoForPaper, listMemos, readsByDate, saveMemo } from "@/core/store/memos";
import * as sql from "@/core/store/db";

export interface AppState {
  settings: Settings;
  papers: Paper[];
  memos: Memo[];
  today: string;
  /** 前日までの連続記録 */
  baseStreak: number;
  graceDays: number;
}

export const API_KEY_SECRET = "anthropic_api_key";

export async function bootstrap(): Promise<AppState> {
  const dataDir = await resolveDataDir();
  await fs.mkdirAll(dataDir);
  await fs.mkdirAll(`${dataDir}/memos`);
  const settings = await loadSettings(dataDir);
  await saveSettings(settings); // 初回はファイルを作る
  await sql.openDb(dataDir);
  const [papers, memos] = await Promise.all([loadPapers(dataDir), listMemos(dataDir)]);
  const today = logicalDate(new Date(), settings.day_boundary_hour);

  let firstUse = await sql.getMeta("first_use_date");
  if (!firstUse) {
    firstUse = today;
    await sql.setMeta("first_use_date", firstUse);
  }
  const { baseStreak, graceDays } = await runJudgement({ settings, memos, today, firstUse });
  return { settings, papers, memos, today, baseStreak, graceDays };
}

/** 未処理の日を判定して day_log に書く(仕様 5.4)。起動時と日付跨ぎで呼ぶ */
export async function runJudgement(args: { settings: Settings; memos: Memo[]; today: string; firstUse: string }) {
  const last = await sql.lastDayLog();
  const graceDays = Number((await sql.getMeta("grace_days")) ?? "0");
  const r = judgeMissingDays({
    lastLoggedDate: last?.date ?? null,
    lastStreak: last?.streak ?? 0,
    graceDays,
    today: args.today,
    readsByDate: readsByDate(args.memos),
    firstUseDate: args.firstUse,
    settings: args.settings,
  });
  if (r.newLogs.length) await sql.insertDayLogs(r.newLogs);
  if (r.graceDays !== graceDays) await sql.setMeta("grace_days", String(r.graceDays));
  return { baseStreak: r.streak, graceDays: r.graceDays };
}

export function currentStreak(state: AppState): number {
  const readToday = state.memos.some((m) => m.frontmatter.completed && m.frontmatter.date === state.today);
  return state.baseStreak + (readToday ? 1 : 0);
}

export function todaysReads(state: AppState): Memo[] {
  return state.memos.filter((m) => m.frontmatter.completed && m.frontmatter.date === state.today);
}

export function today(state: AppState): Paper | null {
  return todaysPaper(state.papers);
}

// ---- 論文リスト ----

export async function addPaper(state: AppState, input: Partial<Paper> & { title: string }): Promise<AppState> {
  const p = newPaper(input, state.papers, new Date().toISOString());
  const papers = [...state.papers, p];
  await savePapers(state.settings.data_dir, papers);
  return { ...state, papers };
}

export async function importCsv(state: AppState, text: string): Promise<{ state: AppState; added: number; errors: string[] }> {
  const { papers: inputs, errors } = csvToPapers(text);
  let papers = state.papers;
  const now = new Date().toISOString();
  const existing = new Set(papers.map((p) => p.id));
  let added = 0;
  for (const inp of inputs) {
    const p = newPaper(inp, papers, now);
    if (existing.has(p.id)) {
      errors.push(`重複のためスキップ: ${p.title}`);
      continue;
    }
    papers = [...papers, p];
    existing.add(p.id);
    added++;
  }
  await savePapers(state.settings.data_dir, papers);
  return { state: { ...state, papers }, added, errors };
}

export async function skipToday(state: AppState, id: string): Promise<AppState> {
  const papers = skipPaper(state.papers, id);
  await savePapers(state.settings.data_dir, papers);
  return { ...state, papers };
}

export async function reorder(state: AppState, orderedIds: string[]): Promise<AppState> {
  const papers = reorderQueue(state.papers, orderedIds);
  await savePapers(state.settings.data_dir, papers);
  return { ...state, papers };
}

export async function remove(state: AppState, id: string): Promise<AppState> {
  const papers = removePaper(state.papers, id);
  await savePapers(state.settings.data_dir, papers);
  return { ...state, papers };
}

// ---- メモ ----

export async function openMemo(state: AppState, paper: Paper): Promise<Memo> {
  const existing = await findMemoForPaper(state.settings.data_dir, paper.id);
  if (existing) return existing;
  return {
    path: "",
    frontmatter: { paper_id: paper.id, date: state.today, chars: 0, completed: false, summary_input: "none", score_total: null },
    body: memoTemplate(paper),
  };
}

export async function persistMemo(state: AppState, memo: Memo, body: string): Promise<{ state: AppState; memo: Memo; newlyCompleted: boolean }> {
  const chars = countMemoChars(body);
  const c = judgeCompletion(chars, state.settings.min_memo_chars, memo.frontmatter.completed);
  const newlyCompleted = c.completed && !memo.frontmatter.completed;
  const fm = { ...memo.frontmatter, chars, completed: c.completed };
  if (newlyCompleted) fm.date = state.today; // 読了日は成立した日
  const saved = await saveMemo(state.settings.data_dir, fm, body, memo.path || undefined);
  let papers = state.papers;
  if (newlyCompleted) {
    papers = markRead(papers, memo.frontmatter.paper_id, new Date().toISOString());
    await savePapers(state.settings.data_dir, papers);
  }
  const memos = await listMemos(state.settings.data_dir);
  return { state: { ...state, papers, memos }, memo: saved, newlyCompleted };
}

// ---- 設定 ----

export async function updateSettings(state: AppState, settings: Settings): Promise<AppState> {
  await saveSettings(settings);
  return { ...state, settings };
}

export async function getApiKey(): Promise<string | null> {
  return secret.get(API_KEY_SECRET);
}

export async function setApiKey(key: string): Promise<void> {
  if (key.trim()) await secret.set(API_KEY_SECRET, key.trim());
  else await secret.delete(API_KEY_SECRET);
}

// ---- LLM ----

export async function makeProvider(settings: Settings): Promise<LlmProvider> {
  if (settings.llm.provider === "ollama") {
    return new OllamaProvider({ model: settings.llm.model, baseUrl: settings.llm.base_url ?? undefined, fetch: tauriFetch });
  }
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Anthropic の API キーが設定されていません。設定画面で入力してください");
  return new AnthropicProvider({ apiKey, model: settings.llm.model, fetch: tauriFetch });
}

export interface AiCostEstimate {
  inputTokens: number;
  outputTokensGuess: number;
  costUsd: number;
}

/** 要約 + 採点をまとめて実行する前のコスト見積もり(仕様 7.3) */
export function estimateAiCost(settings: Settings, ctx: PaperContext, memoBody: string): AiCostEstimate {
  const s = buildSummaryRequest(ctx, settings.language);
  const g = buildGradeRequest(ctx, memoBody, settings.language);
  const inputTokens = roughTokenCount(s.system + s.user) + roughTokenCount(g.system + g.user);
  const outputTokensGuess = 1200;
  return { inputTokens, outputTokensGuess, costUsd: estimateCostUsd(settings.llm.provider, settings.llm.model, inputTokens, outputTokensGuess) };
}

export async function runAi(state: AppState, ctx: PaperContext, memo: Memo): Promise<{ state: AppState; summary: SummaryOutput; grade: GradeOutput }> {
  const llm = await makeProvider(state.settings);
  const lang = state.settings.language;
  const s = await runSummary(llm, ctx, lang);
  await recordUsage(state.settings, "summary", s.res);
  const g = await runGrade(llm, ctx, memo.body, lang);
  await recordUsage(state.settings, "grade", g.res);
  await sql.saveAiOutput(ctx.paper.id, "summary", ctx.inputKind, s.output);
  await sql.saveAiOutput(ctx.paper.id, "grade", ctx.inputKind, g.output);
  const fm = { ...memo.frontmatter, summary_input: ctx.inputKind, score_total: g.output.total };
  await saveMemo(state.settings.data_dir, fm, memo.body, memo.path || undefined);
  const memos = await listMemos(state.settings.data_dir);
  return { state: { ...state, memos }, summary: s.output, grade: g.output };
}

async function recordUsage(settings: Settings, task: "summary" | "grade", res: { inputTokens: number; outputTokens: number; model: string }) {
  await sql.insertUsage({
    at: new Date().toISOString(),
    provider: settings.llm.provider,
    model: res.model,
    task,
    input_tokens: res.inputTokens,
    output_tokens: res.outputTokens,
    est_cost_usd: estimateCostUsd(settings.llm.provider, res.model, res.inputTokens, res.outputTokens),
  });
}

export const loadAiOutputs = sql.loadAiOutputs;
export const usageByMonthAndTask = sql.usageByMonthAndTask;

export async function calendarLogs(from: string, to: string): Promise<DayLog[]> {
  return sql.dayLogsBetween(from, to);
}
