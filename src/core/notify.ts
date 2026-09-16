// 通知(仕様 10)。トレイ常駐中に JS のタイマーから呼ぶ。朝・夜・最終通知の 3 種類

import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Paper, Settings } from "@/core/types";
import { boundaryEnd, isRestDay } from "@/core/schedule/logicalDay";
import { getMeta, setMeta } from "@/core/store/db";

export interface NotifyInput {
  settings: Settings;
  today: string;
  todaysPaper: Paper | null;
  readToday: boolean;
  now: Date;
}

/** 今送るべき通知を返す(純粋)。key は 1 日 1 回のガードに使う */
export function dueNotifications(input: NotifyInput): { key: string; title: string; body: string }[] {
  const { settings, today, now } = input;
  if (isRestDay(today, settings)) return [];
  const out: { key: string; title: string; body: string }[] = [];
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const title = input.todaysPaper?.title ?? null;
  if (now >= at(settings.notifications.morning)) {
    out.push({
      key: `morning:${today}`,
      title: "今日の論文",
      body: title ?? "キューが空です。論文を追加してください",
    });
  }
  if (!input.readToday && title) {
    if (now >= at(settings.notifications.evening)) {
      out.push({ key: `evening:${today}`, title: "まだ読んでいません", body: title });
    }
    const end = boundaryEnd(today, settings.day_boundary_hour);
    const lastCall = new Date(end.getTime() - settings.notifications.last_call_minutes_before * 60_000);
    if (now >= lastCall && now < end) {
      const mins = Math.max(1, Math.round((end.getTime() - now.getTime()) / 60_000));
      out.push({ key: `lastcall:${today}`, title: `締切まで ${mins} 分`, body: title });
    }
  }
  return out;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    return granted;
  } catch {
    return false;
  }
}

/** 未送信のものだけ送り、meta に記録する */
export async function runNotifications(input: NotifyInput): Promise<void> {
  if (!input.settings.notifications.channels.includes("os")) return;
  const due = dueNotifications(input);
  if (!due.length) return;
  if (!(await ensureNotificationPermission())) return;
  for (const n of due) {
    const k = `notified:${n.key}`;
    if (await getMeta(k)) continue;
    sendNotification({ title: n.title, body: n.body });
    await setMeta(k, input.now.toISOString());
  }
}
