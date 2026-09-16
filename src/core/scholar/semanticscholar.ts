// Semantic Scholar Graph API。キーなしでも動くが、キーがあるとレート制限が緩む

import { normalizeDoi } from "@/core/papers/queue";
import type { Candidate, FetchFn } from "./types";

export interface S2Paper {
  paperId: string;
  title?: string | null;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  url?: string | null;
  citationCount?: number | null;
  authors?: { name?: string | null }[];
  externalIds?: { DOI?: string | null; ArXiv?: string | null } | null;
  openAccessPdf?: { url?: string | null } | null;
}

const BASE = "https://api.semanticscholar.org/graph/v1";
const FIELDS = "title,abstract,year,venue,url,citationCount,authors,externalIds,openAccessPdf";

export function s2ToCandidate(p: S2Paper): Candidate | null {
  const title = (p.title ?? "").trim();
  if (!title) return null;
  // arXiv 由来は OpenAlex/arXiv と同じ DOI 形式に寄せて重複統合できるようにする
  const doi = p.externalIds?.DOI ? normalizeDoi(p.externalIds.DOI) : p.externalIds?.ArXiv ? `10.48550/arxiv.${p.externalIds.ArXiv}` : null;
  return {
    id: doi ?? `s2:${p.paperId}`,
    title,
    authors: (p.authors ?? []).map((a) => a?.name ?? "").filter(Boolean),
    year: p.year ?? null,
    venue: p.venue || null,
    doi,
    url: p.url ?? (doi ? `https://doi.org/${doi}` : null),
    pdf_url: p.openAccessPdf?.url ?? (p.externalIds?.ArXiv ? `https://arxiv.org/pdf/${p.externalIds.ArXiv}` : null),
    abstract: p.abstract?.trim() || null,
    cited_by: p.citationCount ?? 0,
    sources: ["semanticscholar"],
  };
}

export async function searchSemanticScholar(query: string, fetchFn: FetchFn, limit = 15, apiKey?: string | null): Promise<Candidate[]> {
  const url = `${BASE}/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${FIELDS}`;
  const res = await fetchFn(url, { headers: apiKey ? { "x-api-key": apiKey } : {} });
  if (!res.ok) throw new Error(`Semantic Scholar ${res.status}`);
  const data = (await res.json()) as { data?: S2Paper[] };
  return (data.data ?? []).map(s2ToCandidate).filter((c): c is Candidate => c !== null);
}
