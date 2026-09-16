// 通知(仕様 10)。トレイ常駐中に JS のタイマーから呼ぶ。朝・夜・最終通知の 3 種類。
// 配信先は OS 通知のほかに Slack と LINE(v2)。文面は共通で、配信先ごとの送り方は notifyChannels.ts

import { appFetch, notifier, secret } from "@/core/store/backend";
import type { NotifyChannel, Paper, Settings } from "@/core/types";
import { boundaryEnd, isRestDay } from "@/core/schedule/logicalDay";
import { getMeta, setMeta } from "@/core/store/db";
import { LINE_TOKEN_SECRET, SLACK_WEBHOOK_SECRET, sendLine, sendSlack } from "@/core/notifyChannels";

export interface NotifyInput {
  settings: Settings;
  today: string;
  todaysPaper: Paper | null;
  readToday: boolean;
  now: Date;
}

export interface Notification {
  key: string;
  title: string;
  body: string;
}

/** 今送るべき通知を返す(純粋)。key は 1 日 1 回のガードに使う */
export function dueNotifications(input: NotifyInput): Notification[] {
  const { settings, today, now } = input;
  if (isRestDay(today, settings)) return [];
  const out: Notification[] = [];
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
    let granted = await notifier.isPermissionGranted();
    if (!granted) granted = await notifier.requestPermission();
    return granted;
  } catch {
    return false;
  }
}

/** 1 つの配信先に 1 通送る。設定が足りないときはエラー */
export async function sendVia(channel: NotifyChannel, settings: Settings, title: string, body: string): Promise<void> {
  switch (channel) {
    case "os": {
      if (!(await ensureNotificationPermission())) throw new Error("通知が許可されていません");
      await notifier.send(title, body);
      return;
    }
    case "slack": {
      const url = await secret.get(SLACK_WEBHOOK_SECRET);
      if (!url) throw new Error("Slack の Webhook URL が設定されていません");
      await sendSlack(appFetch, url, title, body);
      return;
    }
    case "line": {
      const token = await secret.get(LINE_TOKEN_SECRET);
      if (!token) throw new Error("LINE のチャネルアクセストークンが設定されていません");
      await sendLine(appFetch, token, settings.notifications.line_to, title, body);
      return;
    }
  }
}

/**
 * 未送信のものだけ、有効な配信先すべてに送り、meta に記録する。
 * どの配信先にも送れなかった通知は記録せず、次の tick でもう一度試す(通知の許可待ちなど)
 */
export async function runNotifications(input: NotifyInput): Promise<void> {
  const channels = input.settings.notifications.channels;
  if (!channels.length) return;
  const due = dueNotifications(input);
  if (!due.length) return;
  for (const n of due) {
    const k = `notified:${n.key}`;
    if (await getMeta(k)) continue;
    const results = await Promise.allSettled(channels.map((c) => sendVia(c, input.settings, n.title, n.body)));
    if (results.some((r) => r.status === "fulfilled")) await setMeta(k, input.now.toISOString());
  }
}
