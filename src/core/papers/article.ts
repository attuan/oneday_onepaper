// 記事(仕様 4.2)。Zenn・技術ブログ・解説記事も「今日の 1 本」にできる。論文が重い日の逃げ道。
// 本文は取りに行かない(中継は HTML を通さず、デスクトップ版は行き先を絞っているため)。入れるのは URL とタイトルだけ

import type { Paper } from "@/core/types";

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|ref|ref_src|s|t)$/i;

/** 同じ記事を 2 回入れないために、計測用のパラメータと # 以降を落とす。URL でなければ null */
export function normalizeArticleUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  return u.toString().replace(/\/$/, "");
}

/** 共有シートは「タイトル URL」を 1 つの文にして渡してくることがある。文の中から URL を拾う */
export function findUrl(text: string): string | null {
  return /https?:\/\/[^\s<>"'」)]+/.exec(text)?.[0] ?? null;
}

export function articleInput(rawUrl: string, title: string): (Partial<Paper> & { title: string }) | null {
  const url = normalizeArticleUrl(rawUrl);
  if (!url || !title.trim()) return null;
  return { id: `url:${url}`, kind: "article", title: title.trim(), url, venue: new URL(url).hostname.replace(/^www\./, ""), source: "manual" };
}
