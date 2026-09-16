// state.sqlite(仕様 4.4)。papers.json と memos/ から再構築できるインデックス

import type { DayLog, GradeOutput, LlmUsageRow, SummaryOutput } from "@/core/types";
import { db, joinPath } from "./tauri";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS day_log (
  date TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  paper_ids TEXT NOT NULL DEFAULT '[]',
  streak INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_output (
  paper_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  input_kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (paper_id, kind)
);
CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  task TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  est_cost_usd REAL NOT NULL
);
`;

export async function openDb(dataDir: string): Promise<void> {
  await db.open(joinPath(dataDir, "state.sqlite"));
  await db.execute(SCHEMA);
}

export async function getMeta(key: string): Promise<string | null> {
  const rows = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = ?", [key]);
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.execute("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}

export async function lastDayLog(): Promise<DayLog | null> {
  const rows = await db.query<{ date: string; kind: string; paper_ids: string; streak: number }>(
    "SELECT * FROM day_log ORDER BY date DESC LIMIT 1",
  );
  return rows[0] ? rowToDayLog(rows[0]) : null;
}

export async function dayLogsBetween(from: string, to: string): Promise<DayLog[]> {
  const rows = await db.query<{ date: string; kind: string; paper_ids: string; streak: number }>(
    "SELECT * FROM day_log WHERE date >= ? AND date <= ? ORDER BY date",
    [from, to],
  );
  return rows.map(rowToDayLog);
}

export async function insertDayLogs(logs: DayLog[]): Promise<void> {
  for (const l of logs) {
    await db.execute(
      "INSERT INTO day_log(date, kind, paper_ids, streak) VALUES(?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET kind = excluded.kind, paper_ids = excluded.paper_ids, streak = excluded.streak",
      [l.date, l.kind, JSON.stringify(l.paper_ids), l.streak],
    );
  }
}

function rowToDayLog(r: { date: string; kind: string; paper_ids: string; streak: number }): DayLog {
  return { date: r.date, kind: r.kind as DayLog["kind"], paper_ids: JSON.parse(r.paper_ids || "[]"), streak: Number(r.streak) };
}

export async function saveAiOutput(paperId: string, kind: "summary" | "grade", inputKind: string, content: SummaryOutput | GradeOutput): Promise<void> {
  await db.execute(
    "INSERT INTO ai_output(paper_id, kind, input_kind, content, created_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(paper_id, kind) DO UPDATE SET input_kind = excluded.input_kind, content = excluded.content, created_at = excluded.created_at",
    [paperId, kind, inputKind, JSON.stringify(content), new Date().toISOString()],
  );
}

export async function loadAiOutputs(paperId: string): Promise<{ summary: SummaryOutput | null; grade: GradeOutput | null; inputKind: string | null }> {
  const rows = await db.query<{ kind: string; input_kind: string; content: string }>("SELECT kind, input_kind, content FROM ai_output WHERE paper_id = ?", [paperId]);
  let summary: SummaryOutput | null = null;
  let grade: GradeOutput | null = null;
  let inputKind: string | null = null;
  for (const r of rows) {
    inputKind = r.input_kind;
    if (r.kind === "summary") summary = JSON.parse(r.content);
    if (r.kind === "grade") grade = JSON.parse(r.content);
  }
  return { summary, grade, inputKind };
}

export async function insertUsage(u: LlmUsageRow): Promise<void> {
  await db.execute(
    "INSERT INTO llm_usage(at, provider, model, task, input_tokens, output_tokens, est_cost_usd) VALUES(?, ?, ?, ?, ?, ?, ?)",
    [u.at, u.provider, u.model, u.task, u.input_tokens, u.output_tokens, u.est_cost_usd],
  );
}

export interface UsageSummary {
  month: string;
  task: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

export async function usageByMonthAndTask(): Promise<UsageSummary[]> {
  const rows = await db.query<{ month: string; task: string; calls: number; input_tokens: number; output_tokens: number; cost: number }>(
    "SELECT substr(at, 1, 7) AS month, task, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(est_cost_usd) AS cost FROM llm_usage GROUP BY month, task ORDER BY month DESC, task",
  );
  return rows.map((r) => ({ ...r, calls: Number(r.calls), input_tokens: Number(r.input_tokens), output_tokens: Number(r.output_tokens), cost: Number(r.cost) }));
}
