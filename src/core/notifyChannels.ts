// 通知の配信先(仕様 10、v2 の Slack / LINE)。OS 通知以外はここに置く
//
// - Slack: Incoming Webhook に JSON を POST する
// - LINE: Messaging API の push(https://api.line.me/v2/bot/message/push)。
//   チャネルアクセストークンと送信先ユーザー ID が要る(LINE Notify は 2025 年に終了したため使わない)
// トークン類は secret 層(キーチェーン / localStorage)に置き、設定ファイルには書かない

export const SLACK_WEBHOOK_SECRET = "slack_webhook_url";
export const LINE_TOKEN_SECRET = "line_channel_access_token";

export const SLACK_WEBHOOK_HOST = "hooks.slack.com";
export const LINE_API_HOST = "api.line.me";
export const LINE_PUSH_URL = `https://${LINE_API_HOST}/v2/bot/message/push`;

/** 1 行目にタイトル、2 行目に本文。どちらの配信先でも同じ文面にする */
export function messageText(title: string, body: string): string {
  return body ? `${title}\n${body}` : title;
}

export function slackPayload(title: string, body: string): { text: string } {
  return { text: messageText(title, body) };
}

export function linePayload(to: string, title: string, body: string): { to: string; messages: { type: "text"; text: string }[] } {
  return { to, messages: [{ type: "text", text: messageText(title, body) }] };
}

export function isSlackWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === SLACK_WEBHOOK_HOST && u.pathname.startsWith("/services/");
  } catch {
    return false;
  }
}

async function failure(res: Response): Promise<string> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 200);
  } catch {
    /* 本文なし */
  }
  return `HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
}

export async function sendSlack(fetchFn: typeof globalThis.fetch, webhookUrl: string, title: string, body: string): Promise<void> {
  if (!isSlackWebhookUrl(webhookUrl)) throw new Error("Slack の Webhook URL の形式が違います(https://hooks.slack.com/services/... のはず)");
  const res = await fetchFn(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(slackPayload(title, body)),
  });
  // ブラウザ版で中継なしのときは no-cors で送るので、応答は見えない(opaque)。送れたものとみなす
  if (res.type === "opaque") return;
  if (!res.ok) throw new Error(`Slack への送信に失敗: ${await failure(res)}`);
}

export async function sendLine(fetchFn: typeof globalThis.fetch, token: string, to: string, title: string, body: string): Promise<void> {
  if (!token.trim()) throw new Error("LINE のチャネルアクセストークンがありません");
  if (!to.trim()) throw new Error("LINE の送信先(ユーザー ID)がありません");
  const res = await fetchFn(LINE_PUSH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token.trim()}` },
    body: JSON.stringify(linePayload(to.trim(), title, body)),
  });
  if (!res.ok) throw new Error(`LINE への送信に失敗: ${await failure(res)}`);
}
