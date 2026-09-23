// 検索ソースの一覧と振り分け。UI と app.ts はここだけを見る

import type { SourceId } from "@/core/types";
import { searchArxiv } from "./arxiv";
import { searchArxivLocal } from "./arxivLocal";
import { searchCinii } from "./cinii";
import { searchCrossref } from "./crossref";
import { searchJstage } from "./jstage";
import { searchWorks } from "./openalex";
import { searchPubmed } from "./pubmed";
import { searchSemanticScholar } from "./semanticscholar";
import type { Candidate, FetchFn } from "./types";
import type { ArxivIndexBackend } from "@/core/store/backend";

export interface SourceInfo {
  id: SourceId;
  label: string;
  /** 1 行の説明(UI 用) */
  note: string;
  /** ja のソースには日本語クエリを投げる */
  lang: "en" | "ja";
  /** 任意の API キーを使えるか */
  optionalKey?: boolean;
  /** ネットではなく手元の索引を引く。索引が無い環境(Web、未作成)では UI が隠す */
  local?: boolean;
}

export const SOURCES: SourceInfo[] = [
  { id: "openalex", label: "OpenAlex", note: "分野横断。被引用数と OA の PDF リンクが取れる", lang: "en" },
  { id: "semanticscholar", label: "Semantic Scholar", note: "CS 系に強い。キーなしだと 1 秒に数回まで", lang: "en", optionalKey: true },
  { id: "crossref", label: "Crossref", note: "DOI 登録元。網羅的だが抄録は少ない", lang: "en" },
  { id: "arxiv", label: "arXiv", note: "プレプリント。PDF は必ず取れる", lang: "en" },
  { id: "arxiv_local", label: "arXiv(手元の索引)", note: "設定で作った索引を引く。オフラインで動き、レート制限が無い。新着は入らない", lang: "en", local: true },
  { id: "pubmed", label: "PubMed", note: "医学・生命科学", lang: "en" },
  { id: "cinii", label: "CiNii Research", note: "日本語論文。日本語クエリで検索する", lang: "ja" },
  { id: "jstage", label: "J-STAGE", note: "国内学会誌。本文 PDF が多い", lang: "ja" },
];

export const SOURCE_IDS: SourceId[] = SOURCES.map((s) => s.id);
export const DEFAULT_SOURCES: SourceId[] = ["openalex", "semanticscholar", "arxiv"];

export function sourceInfo(id: SourceId): SourceInfo {
  return SOURCES.find((s) => s.id === id) ?? { id, label: id, note: "", lang: "en" };
}

export interface SearchOpts {
  perPage?: number;
  semanticScholarKey?: string | null;
  /** 429 のあと再試行するまでの待ち時間 */
  retryDelayMs?: number;
  /** arXiv の手元の索引(arxiv_local 用)。無ければそのソースは失敗する */
  arxivIndex?: { backend: ArxivIndexBackend; path: string } | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** レート制限(429)は少し待って 1 回だけやり直す。arXiv と Semantic Scholar はキーなしだと当たりやすい */
export async function searchSource(id: SourceId, query: string, fetchFn: FetchFn, opts: SearchOpts = {}): Promise<Candidate[]> {
  try {
    return await searchOnce(id, query, fetchFn, opts);
  } catch (e) {
    if (!/\b429\b/.test(String(e))) throw e;
    await sleep(opts.retryDelayMs ?? 3000);
    return searchOnce(id, query, fetchFn, opts);
  }
}

async function searchOnce(id: SourceId, query: string, fetchFn: FetchFn, opts: SearchOpts): Promise<Candidate[]> {
  const n = opts.perPage ?? 15;
  switch (id) {
    case "openalex":
      return searchWorks(query, fetchFn, n);
    case "semanticscholar":
      return searchSemanticScholar(query, fetchFn, n, opts.semanticScholarKey);
    case "crossref":
      return searchCrossref(query, fetchFn, n);
    case "arxiv":
      return searchArxiv(query, fetchFn, n);
    case "arxiv_local":
      if (!opts.arxivIndex) throw new Error("手元の索引がありません。設定の「arXiv の手元の索引」で作ってください");
      return searchArxivLocal(opts.arxivIndex.backend, opts.arxivIndex.path, query, n);
    case "pubmed":
      return searchPubmed(query, fetchFn, n);
    case "cinii":
      return searchCinii(query, fetchFn, n);
    case "jstage":
      return searchJstage(query, fetchFn, n);
  }
}

/** 重複統合のキー。DOI があれば DOI、なければタイトルを正規化したもの */
export function candidateKey(c: Candidate): string {
  return c.doi ?? c.title.toLowerCase().replace(/\W+/g, " ").trim();
}

/** 2 件を 1 件に。先に来た方を主にし、欠けている項目だけ後から補う */
export function mergeCandidates(a: Candidate, b: Candidate): Candidate {
  return {
    ...b,
    ...a,
    authors: a.authors?.length ? a.authors : b.authors,
    year: a.year ?? b.year ?? null,
    venue: a.venue ?? b.venue ?? null,
    doi: a.doi ?? b.doi ?? null,
    url: a.url ?? b.url ?? null,
    pdf_url: a.pdf_url ?? b.pdf_url ?? null,
    abstract: (a.abstract?.length ?? 0) >= (b.abstract?.length ?? 0) ? (a.abstract ?? null) : (b.abstract ?? null),
    cited_by: Math.max(a.cited_by, b.cited_by),
    sources: [...new Set([...(a.sources ?? []), ...(b.sources ?? [])])],
  };
}

/** 重複を統合する。順序は最初に現れた位置を保つ */
export function dedupe(cands: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of cands) {
    const key = candidateKey(c);
    const prev = byKey.get(key);
    byKey.set(key, prev ? mergeCandidates(prev, c) : c);
  }
  return [...byKey.values()];
}

/** ソースごとの配列を交互に並べ、どのソースの結果も上位に残るようにする */
export function interleave(lists: Candidate[][]): Candidate[] {
  const out: Candidate[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
