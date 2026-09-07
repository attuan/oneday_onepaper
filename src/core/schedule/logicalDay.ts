// 論理日: day_boundary_hour で日付を切る(仕様 5.1)

import type { Settings } from "@/core/types";

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0); // 正午にしてDST問題を避ける
}

/** 現在時刻から論理日を返す。境界時刻より前なら前日扱い */
export function logicalDate(now: Date, boundaryHour: number): string {
  const shifted = new Date(now.getTime() - boundaryHour * 3600 * 1000);
  return formatDate(shifted);
}

export function addDays(date: string, n: number): string {
  const d = parseDate(date);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

/** from 〜 to(両端含む)の日付列 */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** 論理日の終了時刻(次の境界)を実時刻で返す */
export function boundaryEnd(date: string, boundaryHour: number): Date {
  const d = parseDate(addDays(date, 1));
  d.setHours(boundaryHour, 0, 0, 0);
  return d;
}

export function isRestDay(date: string, settings: Pick<Settings, "rest_weekdays" | "rest_periods">): boolean {
  const wd = parseDate(date).getDay();
  if (settings.rest_weekdays.includes(wd)) return true;
  return settings.rest_periods.some((p) => p.from <= date && date <= p.to);
}
