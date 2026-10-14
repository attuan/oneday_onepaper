import { describe, expect, it } from "vitest";
import { dedupe, extractDois, rebuildAbstract, workToCandidate } from "./openalex";

describe("openalex", () => {
  it("inverted index を戻す", () => {
    expect(rebuildAbstract({ world: [1], Hello: [0], again: [2] })).toBe("Hello world again");
    expect(rebuildAbstract(null)).toBeNull();
  });
  it("work → candidate", () => {
    const c = workToCandidate({
      id: "https://openalex.org/W123",
      doi: "https://doi.org/10.1000/ABC",
      title: "T",
      publication_year: 2020,
      authorships: [{ author: { display_name: "A" } }, {}],
      primary_location: { source: { display_name: "V" }, landing_page_url: "https://x" },
      best_oa_location: { pdf_url: "https://x/pdf" },
      abstract_inverted_index: { a: [0] },
      cited_by_count: 5,
    });
    expect(c).toMatchObject({ id: "10.1000/abc", doi: "10.1000/abc", authors: ["A"], venue: "V", pdf_url: "https://x/pdf", abstract: "a", cited_by: 5 });
  });
  it("DOI なしは openalex id", () => {
    const c = workToCandidate({ id: "https://openalex.org/W9", doi: null, title: "x", publication_year: null });
    expect(c?.id).toBe("openalex:W9");
    expect(c?.url).toBeNull();
  });
  it("extractDois", () => {
    expect(extractDois("https://doi.org/10.1000/abc.\n10.5555/x-y, doi:10.1234/z)")).toEqual(["10.1000/abc", "10.5555/x-y", "10.1234/z"]);
  });
  it("dedupe は DOI かタイトルで", () => {
    const a = { id: "1", title: "Same Title", cited_by: 0 };
    const b = { id: "2", title: "same title!", cited_by: 0 };
    expect(dedupe([a, b])).toHaveLength(1);
  });
});

import { parseArxivFeed, arxivIdFromDoi } from "./arxiv";
import { extractIdentifiers } from "./openalex";

describe("arxiv", () => {
  const xml = `<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention Is
  All You Need</title><published>2017-06-12T17:57:34Z</published><summary>The dominant &amp; models.</summary>
  <author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author>
  <link href="https://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
  <link href="https://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf" title="pdf"/></entry></feed>`;
  it("Atom を candidate に", () => {
    const c = parseArxivFeed(xml)[0];
    expect(c).toMatchObject({ id: "10.48550/arxiv.1706.03762", title: "Attention Is All You Need", year: 2017, authors: ["Ashish Vaswani", "Noam Shazeer"], pdf_url: "https://arxiv.org/pdf/1706.03762v7", venue: "arXiv", abstract: "The dominant & models." });
  });
  it("DOI → arXiv id", () => {
    expect(arxivIdFromDoi("10.48550/arxiv.1706.03762")).toBe("1706.03762");
    expect(arxivIdFromDoi("10.1109/x")).toBeNull();
  });
  it("extractIdentifiers は DOI と arXiv ID の両方", () => {
    expect(extractIdentifiers("1706.03762\narXiv:2312.10997v2\n10.1109/CVPR.2016.90").sort()).toEqual(["10.1109/cvpr.2016.90", "10.48550/arxiv.1706.03762", "10.48550/arxiv.2312.10997"]);
  });
});

import { lookupDoi } from "./openalex";

describe("lookupDoi(arXiv の DOI)", () => {
  const work = {
    id: "https://openalex.org/W4403826407",
    doi: "https://doi.org/10.1080/01621459.2026.2689629",
    title: "Causal Inference with Generative Artificial Intelligence",
    publication_year: 2026,
    authorships: [{ author: { display_name: "Kosuke Imai" } }],
    primary_location: { source: { display_name: "Journal of the American Statistical Association" }, landing_page_url: "https://doi.org/10.1080/01621459.2026.2689629" },
    cited_by_count: 2,
  };
  const fakeFetch = (arxiv: () => Promise<Response>) =>
    (async (input: RequestInfo | URL) => (String(input).includes("export.arxiv.org") ? arxiv() : new Response(JSON.stringify(work), { status: 200 }))) as typeof fetch;

  it("arXiv API が落ちたら OpenAlex で引き、id と URL は arXiv のまま", async () => {
    const c = await lookupDoi("10.48550/arXiv.2410.00903", fakeFetch(() => Promise.reject(new TypeError("Failed to fetch"))));
    expect(c).toMatchObject({ id: "10.48550/arxiv.2410.00903", doi: "10.48550/arxiv.2410.00903", title: work.title, year: 2026, venue: "Journal of the American Statistical Association", url: "https://arxiv.org/abs/2410.00903", pdf_url: "https://arxiv.org/pdf/2410.00903" });
  });
  it("arXiv API が空なら OpenAlex で引く", async () => {
    const c = await lookupDoi("10.48550/arxiv.2410.00903", fakeFetch(async () => new Response("<feed></feed>", { status: 200 })));
    expect(c?.title).toBe(work.title);
  });
  it("arXiv API が引ければ OpenAlex は使わない", async () => {
    const xml = `<feed><entry><id>http://arxiv.org/abs/2410.00903v5</id><title>From arXiv</title><published>2024-10-01T17:46:21Z</published><summary>s</summary></entry></feed>`;
    const c = await lookupDoi("10.48550/arxiv.2410.00903", fakeFetch(async () => new Response(xml, { status: 200 })));
    expect(c).toMatchObject({ title: "From arXiv", sources: ["arxiv"] });
  });
});
