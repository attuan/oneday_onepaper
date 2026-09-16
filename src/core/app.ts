// アプリの操作をまとめる層。UI はここだけを呼ぶ

import type { DayLog, GradeOutput, Memo, Paper, Settings, SourceId, SummaryOutput } from "@/core/types";
import { logicalDate } from "@/core/schedule/logicalDay";
import { judgeMissingDays } from "@/core/schedule/judge";
import { markRead, newPaper, queue, removePaper, reorderQueue, skipPaper, todaysPaper } from "@/core/papers/queue";
import { csvToPapers } from "@/core/papers/csv";
import { countMemoChars, memoTemplate } from "@/core/memo/format";
import { judgeCompletion } from "@/core/memo/completion";
import { AnthropicProvider } from "@/core/llm/anthropic";
import { OllamaProvider } from "@/core/llm/ollama";
import type { LlmProvider } from "@/core/llm/provider";
import { buildGradeRequest, buildSummaryRequest, runGrade, runRank, runRecommend, runSummary, type PaperContext, type RankItem } from "@/core/llm/tasks";
import { estimateCostUsd, roughTokenCount } from "@/core/usage/cost";
import { appFetch, backendName, fs, joinPath, pdf, saveFile, secret } from "@/core/store/backend";
import { exportArchive, importArchive, type ImportReport } from "@/core/archive";
export { PartialImportError, type ImportReport } from "@/core/archive";
import { loadSettings, resolveDataDir, saveSettings } from "@/core/store/settings";
import { loadPapers, savePapers } from "@/core/store/papers";
import { findMemoForPaper, listMemos, readsByDate, saveMemo } from "@/core/store/memos";
import * as sql from "@/core/store/db";
import { extractIdentifiers, lookupDoi } from "@/core/scholar/openalex";
import { DEFAULT_SOURCES, dedupe, interleave, searchSource, sourceInfo } from "@/core/scholar/sources";
import type { Candidate } from "@/core/scholar/types";

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
export const S2_KEY_SECRET = "semanticscholar_api_key";

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

/** 日付が変わったときに App から呼ぶ */
export async function rollover(state: AppState): Promise<AppState> {
  const today = logicalDate(new Date(), state.settings.day_boundary_hour);
  if (today === state.today) return state;
  const memos = await listMemos(state.settings.data_dir);
  const firstUse = (await sql.getMeta("first_use_date")) ?? today;
  const r = await runJudgement({ settings: state.settings, memos, today, firstUse });
  return { ...state, memos, today, ...r };
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
  void tryDownloadPdf(state.settings.data_dir, p);
  return { ...state, papers };
}

export async function addMany(state: AppState, inputs: (Partial<Paper> & { title: string })[]): Promise<{ state: AppState; added: number; errors: string[] }> {
  let papers = state.papers;
  const now = new Date().toISOString();
  const existing = new Set(papers.map((p) => p.id));
  const errors: string[] = [];
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
    void tryDownloadPdf(state.settings.data_dir, p);
  }
  await savePapers(state.settings.data_dir, papers);
  return { state: { ...state, papers }, added, errors };
}

export async function importCsv(state: AppState, text: string): Promise<{ state: AppState; added: number; errors: string[] }> {
  const { papers: inputs, errors } = csvToPapers(text);
  const r = await addMany(state, inputs);
  return { ...r, errors: [...errors, ...r.errors] };
}

/** DOI の羅列から書誌情報を引いて追加(仕様 4.2) */
export async function importDois(state: AppState, text: string): Promise<{ state: AppState; added: number; errors: string[] }> {
  const dois = extractIdentifiers(text);
  if (!dois.length) return { state, added: 0, errors: ["DOI や arXiv ID が見つかりませんでした"] };
  const inputs: (Partial<Paper> & { title: string })[] = [];
  const errors: string[] = [];
  for (const doi of dois) {
    try {
      const c = await lookupDoi(doi, appFetch);
      if (c) inputs.push({ ...c, source: "import" });
      else errors.push(`見つかりません: ${doi}`);
    } catch (e) {
      errors.push(`${doi}: ${e}`);
    }
  }
  const r = await addMany(state, inputs);
  return { ...r, errors: [...errors, ...r.errors] };
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

export async function updatePaper(state: AppState, id: string, patch: Partial<Paper>): Promise<AppState> {
  const papers = state.papers.map((p) => (p.id === id ? { ...p, ...patch } : p));
  await savePapers(state.settings.data_dir, papers);
  return { ...state, papers };
}

// ---- 論文を探す(仕様 8) ----

export interface SearchResult {
  candidates: (Candidate & { reason: string; rank: number })[];
  /** 英語ソースに投げたクエリ */
  queries: string[];
  /** 日本語ソースに投げたクエリ */
  queriesJa: string[];
  /** ソースごとの取得件数(重複統合前) */
  perSource: { id: SourceId; count: number }[];
  usedLlm: boolean;
  warnings: string[];
}

/** 候補の上限。rank のプロンプトに全部入れるので増やしすぎない */
const MAX_CANDIDATES = 40;

export async function searchPapers(state: AppState, keywords: string, purpose: string, useLlm: boolean, sourceIds?: SourceId[]): Promise<SearchResult> {
  const warnings: string[] = [];
  const sources = (sourceIds?.length ? sourceIds : state.settings.search.sources.length ? state.settings.search.sources : DEFAULT_SOURCES).map(sourceInfo);
  const needJa = sources.some((s) => s.lang === "ja");
  let queries = [keywords];
  let queriesJa = needJa ? [keywords] : [];
  let llm: LlmProvider | null = null;
  if (useLlm) {
    try {
      llm = await makeProvider(state.settings);
      const r = await runRecommend(llm, keywords, purpose, state.settings.language, needJa);
      await recordUsage(state.settings, "recommend", r.res);
      if (r.output.queries.length) queries = r.output.queries.slice(0, 6);
      if (needJa && r.output.queries_ja.length) queriesJa = [...new Set([keywords, ...r.output.queries_ja])].slice(0, 4);
    } catch (e) {
      warnings.push(`LLM でのクエリ生成に失敗したためキーワードで直接検索します: ${e instanceof Error ? e.message : e}`);
      llm = null;
    }
  }

  // ソースは並列、同じソースへのクエリは順番に(レート制限に当たらないように)
  const s2Key = sources.some((s) => s.id === "semanticscholar") ? await secret.get(S2_KEY_SECRET) : null;
  const perSource: SearchResult["perSource"] = [];
  const lists = await Promise.all(
    sources.map(async (src) => {
      const qs = src.lang === "ja" ? queriesJa : queries;
      const perPage = qs.length > 1 ? 10 : 25;
      const got: Candidate[] = [];
      for (const q of qs) {
        try {
          got.push(...(await searchSource(src.id, q, appFetch, { perPage, semanticScholarKey: s2Key })));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const hint = /\b429\b/.test(msg) ? (src.id === "semanticscholar" ? "。レート制限です。設定画面で API キーを入れるか、少し待ってから再検索してください" : "。レート制限です。少し待ってから再検索してください") : "";
          warnings.push(`${src.label} の検索に失敗 (${q}): ${msg}${hint}`);
          break; // 同じソースで続けても同じ失敗になりやすい
        }
      }
      perSource.push({ id: src.id, count: got.length });
      return dedupe(got);
    }),
  );
  const known = new Set(state.papers.filter((p) => p.status !== "removed").map((p) => p.id));
  const cands = dedupe(interleave(lists))
    .filter((c) => !known.has(c.id))
    .slice(0, MAX_CANDIDATES);
  const base = { queries, queriesJa, perSource: sources.map((s) => perSource.find((p) => p.id === s.id) ?? { id: s.id, count: 0 }) };
  if (!cands.length) return { ...base, candidates: [], usedLlm: false, warnings: [...warnings, "候補が見つかりませんでした"] };

  let ranked: RankItem[] | null = null;
  if (llm) {
    try {
      const r = await runRank(llm, cands, purpose || keywords, "目的への関連度と、基礎から応用への読む順", state.settings.language);
      await recordUsage(state.settings, "rank", r.res);
      ranked = r.output;
    } catch (e) {
      warnings.push(`順位付けに失敗したため被引用数順で表示します: ${e instanceof Error ? e.message : e}`);
    }
  }
  let candidates: SearchResult["candidates"];
  if (ranked) {
    const byId = new Map(cands.map((c) => [c.id, c]));
    // LLM が id を落としたり捏造したりしても、候補にあるものだけを並べる
    const seen = new Set<string>();
    candidates = ranked.flatMap((it) => {
      const c = byId.get(it.id);
      if (!c || seen.has(it.id)) return [];
      seen.add(it.id);
      return [{ ...c, reason: it.reason, rank: it.rank }];
    });
    const rest = cands.filter((c) => !seen.has(c.id)).map((c, i) => ({ ...c, reason: "", rank: candidates.length + i + 1 }));
    candidates = [...candidates, ...rest];
  } else {
    candidates = [...cands].sort((a, b) => b.cited_by - a.cited_by).map((c, i) => ({ ...c, reason: "", rank: i + 1 }));
  }
  return { ...base, candidates, usedLlm: !!ranked, warnings };
}

/** キューを LLM に並べ替えさせる(Q8) */
export async function llmReorderQueue(state: AppState, criterion: string): Promise<{ state: AppState; reasons: Map<string, string> }> {
  const q = queue(state.papers);
  if (q.length < 2) return { state, reasons: new Map() };
  const llm = await makeProvider(state.settings);
  const r = await runRank(llm, q, "読書キューの並べ替え", criterion, state.settings.language);
  await recordUsage(state.settings, "rank", r.res);
  const reasons = new Map(r.output.map((it) => [it.id, it.reason]));
  const st = await reorder(state, r.output.map((it) => it.id));
  return { state: st, reasons };
}

// ---- PDF(仕様 6 / 7.3) ----

export function pdfPath(dataDir: string, paper: Paper): string {
  return joinPath(dataDir, "pdfs", `${paper.id.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf`);
}

export async function hasPdf(state: AppState, paper: Paper): Promise<boolean> {
  return fs.exists(pdfPath(state.settings.data_dir, paper));
}

async function tryDownloadPdf(dataDir: string, paper: Paper): Promise<void> {
  if (!paper.pdf_url) return;
  try {
    const dest = pdfPath(dataDir, paper);
    if (await fs.exists(dest)) return;
    await pdf.download(paper.pdf_url, dest);
  } catch {
    /* OA でないなど。失敗は無視(仕様 6) */
  }
}

export async function downloadPdf(state: AppState, paper: Paper): Promise<string> {
  if (!paper.pdf_url) throw new Error("PDF の URL がありません");
  const dest = pdfPath(state.settings.data_dir, paper);
  await pdf.download(paper.pdf_url, dest);
  return dest;
}

export async function extractFulltext(state: AppState, paper: Paper): Promise<{ state: AppState; text: string; tokens: number }> {
  const path = pdfPath(state.settings.data_dir, paper);
  if (!(await fs.exists(path))) await downloadPdf(state, paper);
  const text = await pdf.extractText(path);
  if (text.trim().length < 200) throw new Error("本文が抽出できませんでした(スキャン PDF など)");
  const tokens = roughTokenCount(text);
  const st = await updatePaper(state, paper.id, { fulltext_tokens: tokens });
  return { state: st, text, tokens };
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

export async function getSemanticScholarKey(): Promise<string | null> {
  return secret.get(S2_KEY_SECRET);
}

export async function setSemanticScholarKey(key: string): Promise<void> {
  if (key.trim()) await secret.set(S2_KEY_SECRET, key.trim());
  else await secret.delete(S2_KEY_SECRET);
}

// ---- データの書き出し・取り込み ----

/** デスクトップ版かブラウザ版か。画面の文言を変えるのに使う */
export function platform(): "tauri" | "web" {
  return backendName() ?? "web";
}

export async function exportData(state: AppState, includePdfs: boolean): Promise<string> {
  const r = await exportArchive(state.settings.data_dir, { includePdfs });
  const where = await saveFile(r.fileName, r.data);
  return `${where}(メモ ${r.counts.memos} 件${includePdfs ? `、PDF ${r.counts.pdfs} 件` : ""})`;
}

/**
 * 現在のデータを置き換える。成功したら画面を読み込み直すこと。
 * PartialImportError のときも DB が閉じているので同じ。それ以外のエラーでは何も変わっていない
 */
export async function importData(state: AppState, file: Blob): Promise<ImportReport> {
  return importArchive(state.settings.data_dir, new Uint8Array(await file.arrayBuffer()));
}

// ---- LLM ----

export async function makeProvider(settings: Settings): Promise<LlmProvider> {
  if (settings.llm.provider === "ollama") {
    return new OllamaProvider({ model: settings.llm.model, baseUrl: settings.llm.base_url ?? undefined, fetch: appFetch });
  }
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Anthropic の API キーが設定されていません。設定画面で入力してください");
  return new AnthropicProvider({ apiKey, model: settings.llm.model, fetch: appFetch });
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

async function recordUsage(settings: Settings, task: "summary" | "grade" | "recommend" | "rank", res: { inputTokens: number; outputTokens: number; model: string }) {
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
