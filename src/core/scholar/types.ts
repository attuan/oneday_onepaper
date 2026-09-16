// 学術 API 共通の候補型。各ソースのアダプタはこれに変換して返す

import type { Paper, SourceId } from "@/core/types";

export type Candidate = Partial<Paper> & {
  title: string;
  id: string;
  cited_by: number;
  /** どのソースから来たか(重複統合で増える) */
  sources?: SourceId[];
};

export type FetchFn = typeof globalThis.fetch;

/** XML/HTML のタグを剥がして空白を畳む(Crossref の JATS 抄録など) */
export function stripTags(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

/** 文字列でも配列でも配列に揃える(CiNii の JSON-LD は単数だと文字列になる) */
export function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
