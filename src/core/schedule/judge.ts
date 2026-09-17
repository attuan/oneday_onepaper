// 前日の判定(仕様 5.4)。日付境界を跨いだとき、または起動時に未処理の日をまとめて処理する

import type { DayKind, DayLog, Settings } from "@/core/types";
import { addDays, dateRange, isRestDay } from "./logicalDay";

export interface JudgeInput {
  /** 最後に day_log に記録された日。なければ null(初回) */
  lastLoggedDate: string | null;
  /** 最後の記録時点の streak と grace_days */
  lastStreak: number;
  graceDays: number;
  /** 今日の論理日。この日は判定しない */
  today: string;
  /** 日付 → その日に読了した論文 id */
  readsByDate: Record<string, string[]>;
  /** 初回起動日。lastLoggedDate が null のときに使う */
  firstUseDate: string;
  settings: Pick<Settings, "rest_weekdays" | "rest_periods" | "grace"> & Partial<Pick<Settings, "forgive_single_miss">>;
  /** 休みを除いた直前の日が「大目に見た未読」だったか。次も未読なら連続記録が切れる */
  missedOnce?: boolean;
}

export interface JudgeResult {
  newLogs: DayLog[];
  streak: number;
  graceDays: number;
}

/**
 * lastLoggedDate の翌日から today の前日までを順に判定する。
 * 純粋関数。副作用は呼び出し側で行う。
 */
export function judgeMissingDays(input: JudgeInput): JudgeResult {
  const start = input.lastLoggedDate ? addDays(input.lastLoggedDate, 1) : input.firstUseDate;
  const end = addDays(input.today, -1);
  const newLogs: DayLog[] = [];
  let streak = input.lastStreak;
  let grace = input.graceDays;
  let missedOnce = input.missedOnce ?? false;

  if (start > end) return { newLogs, streak, graceDays: grace };

  for (const date of dateRange(start, end)) {
    const reads = input.readsByDate[date] ?? [];
    let kind: DayKind;
    if (reads.length > 0) {
      kind = "read";
      streak += 1;
      missedOnce = false;
    } else if (isRestDay(date, input.settings)) {
      kind = "rest";
    } else if (input.settings.grace.enabled && grace > 0) {
      kind = "grace";
      grace -= 1;
      missedOnce = false;
    } else {
      kind = "missed";
      // 1 日だけの未読は大目に見る。2 日続けて(休みは数えない)休んだら切れる。罰が重いとアプリごとやめてしまうため
      if (!(input.settings.forgive_single_miss && !missedOnce)) streak = 0;
      missedOnce = true;
    }
    newLogs.push({ date, kind, paper_ids: reads, streak });
  }
  return { newLogs, streak, graceDays: grace };
}
