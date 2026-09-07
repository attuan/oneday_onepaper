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
