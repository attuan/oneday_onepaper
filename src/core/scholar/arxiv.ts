// arXiv API(Atom)。OpenAlex が arXiv の DOI(10.48550/arXiv.xxxx)を持っていないためのフォールバック

import type { Candidate } from "./openalex";

export const ARXIV_DOI_RE = /^10\.48550\/arxiv\.(.+)$/i;
export const ARXIV_ID_RE = /(?:arxiv:)?(\d{4}\.\d{4,5})(v\d+)?/i;

export function arxivIdFromDoi(doi: string): string | null {
  const m = ARXIV_DOI_RE.exec(doi);
  return m ? m[1] : null;
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
}

function unescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

export function parseArxivFeed(xml: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const idUrl = tag(e, "id") ?? "";
    const idm = /abs\/(\d{4}\.\d{4,5})(v\d+)?/.exec(idUrl);
    if (!idm) continue;
    const id = idm[1];
    const title = unescape((tag(e, "title") ?? "").replace(/\s+/g, " "));
    if (!title) continue;
    const authors = [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => unescape(a[1].trim()));
    const published = tag(e, "published") ?? "";
    const pdfm = /<link[^>]*title="pdf"[^>]*href="([^"]+)"/.exec(e) ?? /<link[^>]*href="([^"]+)"[^>]*title="pdf"/.exec(e);
    const journal = tag(e, "arxiv:journal_ref");
    const doi = `10.48550/arxiv.${id}`;
    out.push({
      id: doi,
      doi,
      title,
      authors,
      year: published ? Number(published.slice(0, 4)) || null : null,
      venue: journal ? unescape(journal) : "arXiv",
      url: `https://arxiv.org/abs/${id}`,
      pdf_url: pdfm ? pdfm[1].replace(/^http:/, "https:") : `https://arxiv.org/pdf/${id}`,
      abstract: unescape((tag(e, "summary") ?? "").replace(/\s+/g, " ")),
      cited_by: 0,
    });
  }
  return out;
}

export async function lookupArxiv(arxivId: string, fetchFn: typeof globalThis.fetch): Promise<Candidate | null> {
  const res = await fetchFn(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
  if (!res.ok) throw new Error(`arXiv ${res.status}`);
  return parseArxivFeed(await res.text())[0] ?? null;
}
