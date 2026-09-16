// CiNii Research OpenSearch(JSON-LD)。キー不要。日本語論文はここが最も広い

import { normalizeDoi } from "@/core/papers/queue";
import { asArray, type Candidate, type FetchFn } from "./types";

export interface CiniiItem {
  "@id": string;
  title?: string | null;
  link?: { "@id"?: string } | null;
  "dc:creator"?: string | string[] | null;
  "prism:publicationName"?: string | null;
  "prism:publicationDate"?: string | null;
  "dc:identifier"?: { "@type"?: string; "@value"?: string } | { "@type"?: string; "@value"?: string }[] | null;
  description?: string | string[] | null;
}

const BASE = "https://cir.nii.ac.jp/opensearch/articles";

export function ciniiToCandidate(it: CiniiItem): Candidate | null {
  const title = (it.title ?? "").trim();
  if (!title) return null;
  const crid = /crid\/(\d+)/.exec(it["@id"])?.[1] ?? it["@id"];
  const doiRaw = asArray(it["dc:identifier"]).find((x) => /DOI/i.test(x?.["@type"] ?? ""))?.["@value"];
  const doi = doiRaw ? normalizeDoi(doiRaw) : null;
  const ym = /^(\d{4})/.exec(it["prism:publicationDate"] ?? "");
  return {
    id: doi ?? `cinii:${crid}`,
    title,
    authors: asArray(it["dc:creator"]).map((a) => String(a).trim()).filter(Boolean),
    year: ym ? Number(ym[1]) : null,
    venue: it["prism:publicationName"]?.trim() || null,
    doi,
    url: it.link?.["@id"] ?? it["@id"],
    pdf_url: null,
    abstract: asArray(it.description).map(String).join(" ").trim() || null,
    cited_by: 0,
    sources: ["cinii"],
  };
}

export async function searchCinii(query: string, fetchFn: FetchFn, count = 15): Promise<Candidate[]> {
  const url = `${BASE}?q=${encodeURIComponent(query)}&count=${count}&format=json`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`CiNii ${res.status}`);
  const data = (await res.json()) as { items?: CiniiItem[] };
  return (data.items ?? []).map(ciniiToCandidate).filter((c): c is Candidate => c !== null);
}
