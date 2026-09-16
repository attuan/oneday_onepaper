// PubMed E-utilities。キー不要。esearch で PMID を引き、efetch で書誌と抄録を取る

import { normalizeDoi } from "@/core/papers/queue";
import { stripTags, type Candidate, type FetchFn } from "./types";

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
}

export function parsePubmedArticles(xml: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)) {
    const a = m[1];
    const pmid = stripTags(tag(a, "PMID"));
    const title = stripTags(tag(a, "ArticleTitle"));
    if (!pmid || !title) continue;
    const doiRaw = /<ArticleId IdType="doi">([^<]+)<\/ArticleId>/.exec(a)?.[1] ?? null;
    const doi = doiRaw ? normalizeDoi(doiRaw) : null;
    const authors = [...(tag(a, "AuthorList") ?? "").matchAll(/<Author[^>]*>([\s\S]*?)<\/Author>/g)]
      .map((x) => [stripTags(tag(x[1], "ForeName")), stripTags(tag(x[1], "LastName"))].filter(Boolean).join(" ") || stripTags(tag(x[1], "CollectiveName")) || "")
      .filter(Boolean);
    const pubDate = tag(a, "PubDate") ?? "";
    const year = Number(stripTags(tag(pubDate, "Year")) ?? /\d{4}/.exec(pubDate)?.[0]) || null;
    const abstract = [...(tag(a, "Abstract") ?? "").matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((x) => stripTags(x[1])).filter(Boolean).join(" ") || null;
    out.push({
      id: doi ?? `pubmed:${pmid}`,
      title,
      authors,
      year,
      venue: stripTags(tag(tag(a, "Journal") ?? "", "Title")),
      doi,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      pdf_url: null,
      abstract,
      cited_by: 0,
      sources: ["pubmed"],
    });
  }
  return out;
}

export async function searchPubmed(query: string, fetchFn: FetchFn, retmax = 15): Promise<Candidate[]> {
  const s = await fetchFn(`${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=relevance&retmode=json`);
  if (!s.ok) throw new Error(`PubMed ${s.status}`);
  const ids = ((await s.json()) as { esearchresult?: { idlist?: string[] } }).esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const f = await fetchFn(`${BASE}/efetch.fcgi?db=pubmed&id=${ids.join(",")}&retmode=xml`);
  if (!f.ok) throw new Error(`PubMed ${f.status}`);
  return parsePubmedArticles(await f.text());
}
