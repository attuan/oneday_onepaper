// 死刑機能の状態遷移(仕様 10.1)。本体の day_log を読んで導出するだけで、本体には書き戻さない

import type { DayLog } from "@/core/types";

export type PrisonerState = "alive" | "warning" | "dead";

export interface Prisoner {
  state: PrisonerState;
  meat: number;
  born_at: string;
}

export interface Grave {
  died_on: string;
  streak: number;
  meat: number;
}

export const MEAT_STAGES = [0, 50, 200, 500, 1000];

export function meatStage(meat: number): number {
  let s = 0;
  for (let i = 0; i < MEAT_STAGES.length; i++) if (meat >= MEAT_STAGES[i]) s = i;
  return s;
}

/** 読了 1 本で増える肉(仕様 10.2)。採点は後から足す */
export function meatForRead(chars: number): number {
  return 10 + Math.floor(chars / 100);
}

export function newPrisoner(bornAt: string, meat = 0): Prisoner {
  return { state: "alive", meat, born_at: bornAt };
}

export interface ApplyInput {
  prisoner: Prisoner;
  logs: DayLog[]; // 日付順
  /** logs[0] の前日時点の連続記録 */
  streakBefore: number;
  /** 死刑機能を有効にした日。これより前は判定しない */
  enabledOn: string;
}

export function applyDayLogs(input: ApplyInput): { prisoner: Prisoner; graves: Grave[] } {
  let p = { ...input.prisoner };
  const graves: Grave[] = [];
  let prevStreak = input.streakBefore;
  for (const log of input.logs) {
    if (log.date >= input.enabledOn) {
      switch (log.kind) {
        case "read":
          if (p.state === "dead") p = newPrisoner(log.date, p.meat);
          else p.state = "alive";
          break;
        case "rest":
          break;
        case "grace":
          if (p.state !== "dead") p.state = "warning";
          break;
        case "missed":
          if (p.state !== "dead") {
            graves.push({ died_on: log.date, streak: prevStreak, meat: p.meat });
            p = { state: "dead", meat: Math.floor(p.meat / 2), born_at: log.date };
          }
          break;
      }
    }
    prevStreak = log.streak;
  }
  return { prisoner: p, graves };
}
