// 読了を研究室などの Slack に投稿する(仕様 10.1)。
// 通知(notify.ts)とは別の Webhook を使う。「まだ読んでいません」を人のいるチャンネルに流さないため

import type { Paper } from "@/core/types";

export const SHARE_SLACK_WEBHOOK_SECRET = "share_slack_webhook_url";

const ONE_LINER_MAX = 140;

/** メモの最初の 1 行(見出し・空行・中身のない箇条書きを除く)。投稿に出すのはここだけ */
export function firstMemoLine(body: string): string {
  for (const raw of body.split("\n")) {
    if (/^\s*#/.test(raw)) continue;
    const line = raw.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();
    if (!line) continue;
    return line.length > ONE_LINER_MAX ? `${line.slice(0, ONE_LINER_MAX)}…` : line;
  }
  return "";
}

/** Slack の mrkdwn で特別な意味を持つ 3 文字だけ逃がす */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function byline(paper: Paper): string {
  const first = paper.authors[0];
  const authors = first ? (paper.authors.length > 1 ? `${first} ほか` : first) : "";
  return [authors, paper.year ? String(paper.year) : ""].filter(Boolean).join(", ");
}

export interface CompletionShare {
  paper: Paper;
  memoBody: string;
  streak: number;
  displayName: string;
}

export function completionShareText({ paper, memoBody, streak, displayName }: CompletionShare): string {
  const who = displayName.trim() ? `${escapeSlack(displayName.trim())} が` : "";
  const by = byline(paper);
  const link = paper.url ?? (paper.doi ? `https://doi.org/${paper.doi}` : null);
  const oneLiner = firstMemoLine(memoBody);
  return [
    `📖 ${who}今日の 1 本を読みました(連続 ${streak} 日)`,
    `*${escapeSlack(paper.title)}*${by ? `(${escapeSlack(by)})` : ""}`,
    oneLiner ? `> ${escapeSlack(oneLiner)}` : "",
    link ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}
