// Crossref REST API。キー不要。DOI 登録機関なので網羅性は高いが、抄録と PDF は少ない

import { normalizeDoi } from "@/core/papers/queue";
import { stripTags, type Candidate, type FetchFn } from "./types";

export interface CrossrefWork {
  DOI: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { "date-parts"?: (number | null)[][] };
  "container-title"?: string[];
  URL?: string;
  link?: { URL?: string; "content-type"?: string }[];
  abstract?: string;
  "is-referenced-by-count"?: number;
}

const BASE = "https://api.crossref.org";
const MAILTO = "onedayonepaper@example.invalid"; // polite pool 用
const SELECT = "DOI,title,author,issued,container-title,URL,link,abstract,is-referenced-by-count";

export function crossrefToCandidate(w: CrossrefWork): Candidate | null {
  const title = stripTags(w.title?.[0]) ?? "";
  if (!title || !w.DOI) return null;
  const doi = normalizeDoi(w.DOI);
  const pdf = (w.link ?? []).find((l) => l["content-type"] === "application/pdf" && l.URL)?.URL ?? null;
  const year = w.issued?.["date-parts"]?.[0]?.[0] ?? null;
  return {
    id: doi,
    title,
    authors: (w.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
    year,
    venue: w["container-title"]?.[0] ?? null,
    doi,
    url: w.URL ?? `https://doi.org/${doi}`,
    pdf_url: pdf,
    abstract: stripTags(w.abstract),
    cited_by: w["is-referenced-by-count"] ?? 0,
    sources: ["crossref"],
  };
}

export async function searchCrossref(query: string, fetchFn: FetchFn, rows = 15): Promise<Candidate[]> {
  const url = `${BASE}/works?query=${encodeURIComponent(query)}&rows=${rows}&select=${SELECT}&mailto=${MAILTO}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Crossref ${res.status}`);
  const data = (await res.json()) as { message?: { items?: CrossrefWork[] } };
  return (data.message?.items ?? []).map(crossrefToCandidate).filter((c): c is Candidate => c !== null);
}
