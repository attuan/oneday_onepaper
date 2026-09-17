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

/**
 * 共有から開かれたときの URL(?url=&title=&text=)から、記事の URL とタイトルを取り出す(仕様 8.0)。
 * Android は PWA の共有先として、iOS / iPadOS は共有シートのショートカットから、同じ形の URL でこのページを開く。
 * 共有元によって URL が text や title に入ってくることがあるので、全部から探す
 */
export function sharedArticle(pageUrl: string): { url: string; title: string } | null {
  let q: URLSearchParams;
  try {
    q = new URL(pageUrl).searchParams;
  } catch {
    return null;
  }
  const [url, title, text] = ["url", "title", "text"].map((k) => q.get(k)?.trim() ?? "");
  const found = normalizeArticleUrl(url) ?? normalizeArticleUrl(findUrl(text) ?? "") ?? normalizeArticleUrl(findUrl(title) ?? "");
  if (!found) return null;
  const strip = (s: string) => s.replace(/https?:\/\/\S+/g, "").trim();
  return { url: found, title: strip(title) || strip(text) || new URL(found).hostname };
}
