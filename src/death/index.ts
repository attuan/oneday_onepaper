// 死刑機能の入口。本体(core)の day_log を購読して状態を更新する(仕様 10)

import type { DayLog } from "@/core/types";
import { dayLogsBetween, lastDayLog } from "@/core/store/db";
import { addDays } from "@/core/schedule/logicalDay";
import { applyDayLogs, meatForRead, type Prisoner } from "./logic";
import * as store from "./store";

export interface DeathState {
  prisoner: Prisoner;
  avatar: store.AvatarParts;
  enabledOn: string;
}

/** 有効化。以降の日から判定する(オフ期間の未読は遡らない、仕様 10.1) */
export async function enableDeath(today: string): Promise<void> {
  if (!(await store.getEnabledOn())) await store.setEnabledOn(today);
  await store.ensurePrisoner(today);
  await store.setLastProcessed(addDays(today, -1));
}

/** 再有効化のとき、オフ期間を飛ばすために enabled_on を今日に更新する */
export async function reenableDeath(today: string): Promise<void> {
  await store.setEnabledOn(today);
  await store.ensurePrisoner(today);
  await store.setLastProcessed(addDays(today, -1));
}

export async function loadDeathState(dataDir: string, today: string): Promise<DeathState> {
  const enabledOn = (await store.getEnabledOn()) ?? today;
  const prisoner = await store.ensurePrisoner(today);
  const avatar = await store.loadAvatar(dataDir);
  return { prisoner, avatar, enabledOn };
}

/** 未処理の day_log を囚人に適用する。runJudgement の後に呼ぶ */
export async function processDeath(today: string): Promise<Prisoner> {
  const enabledOn = (await store.getEnabledOn()) ?? today;
  const prisoner = await store.ensurePrisoner(today);
  const lastProcessed = (await store.getLastProcessed()) ?? addDays(enabledOn, -1);
  const from = addDays(lastProcessed, 1);
  const to = addDays(today, -1);
  if (from > to) return prisoner;
  const logs: DayLog[] = await dayLogsBetween(from, to);
  if (!logs.length) return prisoner;
  const before = await dayLogsBetween(addDays(from, -1), addDays(from, -1));
  const r = applyDayLogs({ prisoner, logs, streakBefore: before[0]?.streak ?? 0, enabledOn });
  if (r.graves.length) await store.addGraves(r.graves);
  await store.savePrisoner(r.prisoner);
  await store.setLastProcessed(logs[logs.length - 1].date);
  return r.prisoner;
}

export async function addMeat(amount: number): Promise<Prisoner | null> {
  const p = await store.loadPrisoner();
  if (!p) return null;
  const np = { ...p, meat: p.meat + amount };
  await store.savePrisoner(np);
  return np;
}

export async function meatOnCompletion(chars: number): Promise<Prisoner | null> {
  return addMeat(meatForRead(chars));
}

export { listGraves, loadAvatar, saveAvatar, type AvatarParts, DEFAULT_AVATAR } from "./store";
export { meatStage, MEAT_STAGES, type Prisoner, type Grave } from "./logic";
export function newPrisonerPreview(): Prisoner {
  return { state: "alive", meat: 0, born_at: "" };
}
export { lastDayLog };
