// OpenAlex クライアント(仕様 8)。キー不要。書誌情報はここから取り、LLM には判断だけさせる

import type { Paper } from "@/core/types";
import { normalizeDoi } from "@/core/papers/queue";
import { ARXIV_ID_RE, arxivIdFromDoi, lookupArxiv } from "./arxiv";

export type Candidate = Partial<Paper> & { title: string; id: string; cited_by: number };

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
}

type FetchFn = typeof globalThis.fetch;

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
  if (arxivId) return lookupArxiv(arxivId, fetchFn);
  // DOI はパスにそのまま置く("/" をエンコードすると 404 になる)
  const url = `${BASE}/works/https://doi.org/${d.replace(/ /g, "%20")}?select=${SELECT}&${UA}`;
  const res = await fetchFn(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  return workToCandidate((await res.json()) as OaWork);
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

export function dedupe(cands: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    const key = c.doi ?? c.title.toLowerCase().replace(/\W+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
