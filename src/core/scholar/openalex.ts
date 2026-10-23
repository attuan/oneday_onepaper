// OpenAlex クライアント(仕様 8)。キー不要。書誌情報はここから取り、LLM には判断だけさせる

import { normalizeDoi } from "@/core/papers/queue";
import { ARXIV_ID_RE, arxivIdFromDoi, lookupArxiv } from "./arxiv";
import type { Candidate, FetchFn } from "./types";

export type { Candidate } from "./types";
export { dedupe } from "./sources";

interface OaWork {
  id: string;
  doi: string | null;
  title: string | null;
  display_name?: string | null;
  publication_year: number | null;
  authorships?: { author?: { display_name?: string | null } }[];
  primary_location?: { source?: { display_name?: string | null } | null; landing_page_url?: string | null } | null;
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
  open_access?: { oa_url?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  cited_by_count?: number;
  referenced_works?: string[];
}

const BASE = "https://api.openalex.org";
const UA = "mailto=onedayonepaper@example.invalid"; // polite pool 用。個人情報は送らない

/** inverted index を本文に戻す */
export function rebuildAbstract(idx: Record<string, number[]> | null | undefined): string | null {
  if (!idx) return null;
  const words: [number, string][] = [];
  for (const [w, positions] of Object.entries(idx)) for (const p of positions) words.push([p, w]);
  if (!words.length) return null;
  words.sort((a, b) => a[0] - b[0]);
  return words.map((w) => w[1]).join(" ");
}

export function workToCandidate(w: OaWork): Candidate | null {
  const title = (w.title ?? w.display_name ?? "").trim();
  if (!title) return null;
  const doi = w.doi ? normalizeDoi(w.doi) : null;
  const id = doi ?? `openalex:${w.id.replace(/^https:\/\/openalex\.org\//, "")}`;
  return {
    id,
    title,
    authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
    year: w.publication_year ?? null,
    venue: w.primary_location?.source?.display_name ?? null,
    doi,
    url: w.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : null),
    pdf_url: w.best_oa_location?.pdf_url ?? w.open_access?.oa_url ?? null,
    abstract: rebuildAbstract(w.abstract_inverted_index),
    cited_by: w.cited_by_count ?? 0,
    sources: ["openalex"],
  };
}

const SELECT = "id,doi,title,display_name,publication_year,authorships,primary_location,best_oa_location,open_access,abstract_inverted_index,cited_by_count";

export async function searchWorks(query: string, fetchFn: FetchFn, perPage = 15): Promise<Candidate[]> {
  const url = `${BASE}/works?search=${encodeURIComponent(query)}&per-page=${perPage}&select=${SELECT}&${UA}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const data = (await res.json()) as { results: OaWork[] };
  return data.results.map(workToCandidate).filter((c): c is Candidate => c !== null);
}

export async function lookupDoi(doi: string, fetchFn: FetchFn): Promise<Candidate | null> {
  const d = normalizeDoi(doi);
  const arxivId = arxivIdFromDoi(d);
  if (arxivId) return lookupArxivWithFallback(arxivId, d, fetchFn);
  return lookupOpenAlex(d, fetchFn);
}

async function lookupOpenAlex(d: string, fetchFn: FetchFn): Promise<Candidate | null> {
  // DOI はパスにそのまま置く("/" をエンコードすると 404 になる)
  const url = `${BASE}/works/https://doi.org/${d.replace(/ /g, "%20")}?select=${SELECT}&${UA}`;
  const res = await fetchFn(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  return workToCandidate((await res.json()) as OaWork);
}

/**
 * arXiv API が引けない(ブラウザ版で中継が無いと CORS で落ちる、混んでいて 429/503 など)ときは OpenAlex で引く。
 * OpenAlex は arXiv の DOI を出版版の DOI に寄せて返すので、id・URL・PDF は arXiv のものに戻す
 */
async function lookupArxivWithFallback(arxivId: string, d: string, fetchFn: FetchFn): Promise<Candidate | null> {
  let arxivError: unknown = null;
  try {
    const c = await lookupArxiv(arxivId, fetchFn);
    if (c) return c;
  } catch (e) {
    arxivError = e;
  }
  let c: Candidate | null;
  try {
    c = await lookupOpenAlex(d, fetchFn);
  } catch (e) {
    throw arxivError ?? e;
  }
  if (!c) {
    if (arxivError) throw arxivError;
    return null;
  }
  return { ...c, id: d, doi: d, url: `https://arxiv.org/abs/${arxivId}`, pdf_url: `https://arxiv.org/pdf/${arxivId}` };
}

// ---- 引用をたどる(仕様 8.2) ----

/** "https://openalex.org/W123" → "W123" */
export const workIdOf = (id: string): string => id.replace(/^https:\/\/openalex\.org\//, "");

export type WorkCandidate = Candidate & { workId: string };

function toWorkCandidate(w: OaWork): WorkCandidate | null {
  const c = workToCandidate(w);
  return c && { ...c, workId: workIdOf(w.id) };
}

/** 種にする 1 本を引く。参照一覧(referenced_works)も付けて返す */
export async function lookupWork(ref: { doi?: string | null; workId?: string | null }, fetchFn: FetchFn): Promise<(WorkCandidate & { referenced: string[] }) | null> {
  const path = ref.workId ? ref.workId : `https://doi.org/${normalizeDoi(ref.doi ?? "").replace(/ /g, "%20")}`;
  const res = await fetchFn(`${BASE}/works/${path}?select=${SELECT},referenced_works&${UA}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const w = (await res.json()) as OaWork;
  const c = toWorkCandidate(w);
  return c && { ...c, referenced: (w.referenced_works ?? []).map(workIdOf) };
}

/** OR で並べられる値の上限(OpenAlex の制限) */
export const MAX_FILTER_OR = 50;

/** W-ID の一括取得(1 回で 50 件まで)。見つからなかった ID は黙って抜ける */
export async function worksByIds(ids: string[], fetchFn: FetchFn): Promise<WorkCandidate[]> {
  if (!ids.length) return [];
  const url = `${BASE}/works?filter=openalex:${ids.slice(0, MAX_FILTER_OR).join("|")}&per-page=${MAX_FILTER_OR}&select=${SELECT}&${UA}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const data = (await res.json()) as { results: OaWork[] };
  return data.results.map(toWorkCandidate).filter((c): c is WorkCandidate => c !== null);
}

/** この work を引用している論文。count はヒット総数(取るのは 1 ページだけ) */
export async function citingWorks(workId: string, sort: "cited_by_count:desc" | "publication_date:desc", fetchFn: FetchFn, perPage = 50): Promise<{ items: WorkCandidate[]; count: number }> {
  const url = `${BASE}/works?filter=cites:${workId}&sort=${sort}&per-page=${perPage}&select=${SELECT}&${UA}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const data = (await res.json()) as { meta?: { count?: number }; results: OaWork[] };
  return { items: data.results.map(toWorkCandidate).filter((c): c is WorkCandidate => c !== null), count: data.meta?.count ?? data.results.length };
}

/** リスト内の論文(DOI があるもの)の参照一覧を 1 回の呼び出しでまとめて引く。DOI(正規形)→ W-ID の配列 */
export async function referencedOf(dois: string[], fetchFn: FetchFn): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!dois.length) return out;
  const asked = new Set(dois.slice(0, MAX_FILTER_OR).map(normalizeDoi));
  const url = `${BASE}/works?filter=doi:${[...asked].join("|")}&per-page=${MAX_FILTER_OR}&select=id,doi,referenced_works&${UA}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const data = (await res.json()) as { results: OaWork[] };
  // OpenAlex は頼んでいない DOI の work を混ぜて返すことがある(誤マージ)。共引用の数が汚れるので、頼んだものだけ使う
  for (const w of data.results) {
    const d = w.doi ? normalizeDoi(w.doi) : null;
    if (d && asked.has(d)) out.set(d, (w.referenced_works ?? []).map(workIdOf));
  }
  return out;
}

/** テキストから DOI と arXiv ID を拾う。arXiv ID は DOI 形式に正規化する */
export function extractIdentifiers(text: string): string[] {
  const out = new Set<string>(extractDois(text));
  for (const line of text.split(/\s+/)) {
    if (/^10\./.test(line) || /doi\.org/.test(line)) continue;
    const m = ARXIV_ID_RE.exec(line);
    if (m) out.add(`10.48550/arxiv.${m[1]}`);
  }
  return [...out];
}

/** テキストから DOI らしき文字列を全部拾う(1 行 1 DOI でも URL でも可) */
export function extractDois(text: string): string[] {
  const re = /10\.\d{4,9}\/[^\s"'<>,;]+/g;
  const out = new Set<string>();
  for (const m of text.matchAll(re)) out.add(normalizeDoi(m[0].replace(/[.)\]]+$/, "")));
  return [...out];
}
