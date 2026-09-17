// 読了判定(仕様 6)。読了は 3 段階で、Lv1 に届けば成立する

import type { ReadLevel, Settings } from "@/core/types";

export const LEVEL_LABELS: Record<ReadLevel, string> = { 0: "未読了", 1: "ひとこと", 2: "要点", 3: "しっかり" };

/** [Lv1, Lv2, Lv3] に必要な文字数 */
export type LevelThresholds = [number, number, number];

/** 設定から閾値を作る。Lv3 を下げた人でも Lv1 <= Lv2 <= Lv3 になるように揃える */
export function levelThresholds(s: Pick<Settings, "quick_memo_chars" | "standard_memo_chars" | "min_memo_chars">): LevelThresholds {
  const full = Math.max(0, s.min_memo_chars);
  const standard = Math.min(Math.max(0, s.standard_memo_chars), full);
  const quick = Math.min(Math.max(0, s.quick_memo_chars), standard);
  return [quick, standard, full];
}

export function levelForChars(chars: number, t: LevelThresholds): ReadLevel {
  if (chars >= t[2]) return 3;
  if (chars >= t[1]) return 2;
  if (chars >= t[0]) return 1;
  return 0;
}

export interface CompletionState {
  chars: number;
  level: ReadLevel;
  completed: boolean;
  /** 次の段階。Lv3 に届いていれば null */
  next: { level: ReadLevel; required: number; remaining: number } | null;
}

export function judgeCompletion(chars: number, thresholds: LevelThresholds, currentLevel: ReadLevel): CompletionState {
  // 一度届いた段階は取り消さない
  const level = Math.max(currentLevel, levelForChars(chars, thresholds)) as ReadLevel;
  const nextLevel = level < 3 ? ((level + 1) as ReadLevel) : null;
  const next = nextLevel === null ? null : { level: nextLevel, required: thresholds[nextLevel - 1], remaining: Math.max(0, thresholds[nextLevel - 1] - chars) };
  return { chars, level, completed: level >= 1, next };
}
