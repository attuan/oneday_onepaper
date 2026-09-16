import { describe, expect, it } from "vitest";
import { s2ToCandidate } from "./semanticscholar";
import { crossrefToCandidate } from "./crossref";
import { ciniiToCandidate } from "./cinii";
import { parseJstageFeed } from "./jstage";
import { parsePubmedArticles } from "./pubmed";
import { arxivSearchQuery } from "./arxiv";
import { stripTags } from "./types";
import { DEFAULT_SOURCES, SOURCES, SOURCE_IDS, dedupe, interleave, mergeCandidates, sourceInfo } from "./sources";

describe("semantic scholar", () => {
  it("DOI があれば DOI を id に", () => {
    const c = s2ToCandidate({ paperId: "abc", title: "T", year: 2020, venue: "V", externalIds: { DOI: "10.1000/ABC" }, authors: [{ name: "A" }], citationCount: 3, openAccessPdf: { url: "https://x/pdf" }, abstract: " a " });
    expect(c).toMatchObject({ id: "10.1000/abc", doi: "10.1000/abc", authors: ["A"], cited_by: 3, pdf_url: "https://x/pdf", abstract: "a", sources: ["semanticscholar"] });
  });
  it("arXiv しかなければ arXiv DOI に寄せる", () => {
    const c = s2ToCandidate({ paperId: "abc", title: "T", externalIds: { ArXiv: "1706.03762" } });
    expect(c?.id).toBe("10.48550/arxiv.1706.03762");
    expect(c?.pdf_url).toBe("https://arxiv.org/pdf/1706.03762");
  });
  it("どちらもなければ s2 id", () => {
    expect(s2ToCandidate({ paperId: "abc", title: "T" })?.id).toBe("s2:abc");
    expect(s2ToCandidate({ paperId: "abc", title: "" })).toBeNull();
  });
});

describe("crossref", () => {
  it("work → candidate", () => {
    const c = crossrefToCandidate({
      DOI: "10.1000/XYZ",
      title: ["Deep <i>Learning</i>"],
      author: [{ given: "Yann", family: "LeCun" }, { name: "Consortium" }],
      issued: { "date-parts": [[2015, 5]] },
      "container-title": ["Nature"],
      URL: "https://doi.org/10.1000/xyz",
      link: [{ URL: "https://x/html", "content-type": "text/html" }, { URL: "https://x/pdf", "content-type": "application/pdf" }],
      abstract: "<jats:p>Abstract &amp; text</jats:p>",
      "is-referenced-by-count": 100,
    });
    expect(c).toMatchObject({ id: "10.1000/xyz", title: "Deep Learning", authors: ["Yann LeCun", "Consortium"], year: 2015, venue: "Nature", pdf_url: "https://x/pdf", abstract: "Abstract & text", cited_by: 100, sources: ["crossref"] });
  });
  it("タイトルなしは捨てる", () => {
    expect(crossrefToCandidate({ DOI: "10.1/x" })).toBeNull();
  });
});

describe("cinii", () => {
  it("JSON-LD の item → candidate(creator が単数でも)", () => {
    const c = ciniiToCandidate({
      "@id": "https://cir.nii.ac.jp/crid/1520853832707568768",
      title: "深層学習の応用",
      link: { "@id": "https://cir.nii.ac.jp/crid/1520853832707568768" },
      "dc:creator": "山田 太郎",
      "prism:publicationName": "人工知能学会論文誌",
      "prism:publicationDate": "2020-03-01",
      "dc:identifier": [{ "@type": "cir:NAID", "@value": "123" }, { "@type": "cir:DOI", "@value": "10.1527/TJSAI.35-2_A" }],
      description: "抄録",
    });
    expect(c).toMatchObject({ id: "10.1527/tjsai.35-2_a", doi: "10.1527/tjsai.35-2_a", title: "深層学習の応用", authors: ["山田 太郎"], year: 2020, venue: "人工知能学会論文誌", abstract: "抄録", sources: ["cinii"] });
  });
  it("DOI なしは crid", () => {
    const c = ciniiToCandidate({ "@id": "https://cir.nii.ac.jp/crid/99", title: "T", "dc:creator": ["A", "B"] });
    expect(c).toMatchObject({ id: "cinii:99", authors: ["A", "B"], year: null, url: "https://cir.nii.ac.jp/crid/99" });
  });
});

describe("jstage", () => {
  const xml = `<feed><entry>
    <article_title><en/><ja><![CDATA[機械学習の基礎]]></ja></article_title>
    <article_link><en>https://www.jstage.jst.go.jp/article/ipsjjip/27/1/27_1/_article</en><ja>https://www.jstage.jst.go.jp/article/ipsjjip/27/1/27_1/_article/-char/ja/</ja></article_link>
    <author><en><name><![CDATA[Ichiro Suzuki]]></name></en><ja><name><![CDATA[鈴木 一郎]]></name><name><![CDATA[佐藤 花子]]></name></ja></author>
    <material_title><en><![CDATA[IPSJ Journal]]></en><ja><![CDATA[情報処理学会論文誌]]></ja></material_title>
    <pubyear>2019</pubyear>
    <prism:doi>10.2197/IPSJJIP.27.1</prism:doi>
    <title><![CDATA[機械学習の基礎]]></title>
    <link href="https://www.jstage.jst.go.jp/article/ipsjjip/27/1/27_1/_article/-char/ja/"/>
  </entry><entry>
    <article_title><en><![CDATA[Only English]]></en><ja/></article_title>
    <author><en><name>A B</name></en></author>
    <link href="https://www.jstage.jst.go.jp/article/x/1/1/1_1/_article"/>
  </entry></feed>`;
  it("Atom を candidate に(日本語優先、CDATA、PDF は _pdf)", () => {
    const [a, b] = parseJstageFeed(xml);
    expect(a).toMatchObject({ id: "10.2197/ipsjjip.27.1", title: "機械学習の基礎", authors: ["鈴木 一郎", "佐藤 花子"], venue: "情報処理学会論文誌", year: 2019, url: "https://www.jstage.jst.go.jp/article/ipsjjip/27/1/27_1/_article/-char/ja/", pdf_url: "https://www.jstage.jst.go.jp/article/ipsjjip/27/1/27_1/_pdf/-char/ja/", sources: ["jstage"] });
    expect(b).toMatchObject({ id: "jstage:x/1/1/1_1", title: "Only English", authors: ["A B"], doi: null });
  });
});

describe("pubmed", () => {
  const xml = `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">12345</PMID><Article>
    <Journal><Title>The Lancet</Title><JournalIssue><PubDate><Year>2021</Year></PubDate></JournalIssue></Journal>
    <ArticleTitle>A trial of <i>something</i>.</ArticleTitle>
    <Abstract><AbstractText Label="BACKGROUND">Part one.</AbstractText><AbstractText>Part two.</AbstractText></Abstract>
    <AuthorList><Author><LastName>Doe</LastName><ForeName>Jane</ForeName></Author><Author><CollectiveName>Study Group</CollectiveName></Author></AuthorList>
  </Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">12345</ArticleId><ArticleId IdType="doi">10.1016/S0140</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;
  it("efetch XML → candidate", () => {
    const c = parsePubmedArticles(xml)[0];
    expect(c).toMatchObject({ id: "10.1016/s0140", title: "A trial of something .", authors: ["Jane Doe", "Study Group"], year: 2021, venue: "The Lancet", abstract: "Part one. Part two.", url: "https://pubmed.ncbi.nlm.nih.gov/12345/", sources: ["pubmed"] });
  });
});

describe("arxiv search query", () => {
  it("語ごとに all: で AND", () => {
    expect(arxivSearchQuery("retrieval augmented generation")).toBe("all:retrieval AND all:augmented AND all:generation");
    expect(arxivSearchQuery("  ")).toBe("");
  });
});

describe("sources registry", () => {
  it("一覧と既定が整合する", () => {
    expect(new Set(SOURCE_IDS).size).toBe(SOURCES.length);
    for (const id of DEFAULT_SOURCES) expect(SOURCE_IDS).toContain(id);
    expect(sourceInfo("cinii").lang).toBe("ja");
  });
  it("merge は欠けた項目を補い、ソースを合算する", () => {
    const a = { id: "10.1/x", doi: "10.1/x", title: "T", cited_by: 5, abstract: null, pdf_url: null, sources: ["openalex" as const] };
    const b = { id: "10.1/x", doi: "10.1/x", title: "T", cited_by: 9, abstract: "long abstract", pdf_url: "https://p", year: 2020, sources: ["arxiv" as const] };
    expect(mergeCandidates(a, b)).toMatchObject({ cited_by: 9, abstract: "long abstract", pdf_url: "https://p", year: 2020, sources: ["openalex", "arxiv"] });
  });
  it("dedupe は最初の位置を保ちつつ統合する", () => {
    const r = dedupe([
      { id: "1", title: "Same Title", cited_by: 0, sources: ["openalex"] },
      { id: "2", title: "Other", cited_by: 0 },
      { id: "3", title: "same title!", cited_by: 4, sources: ["crossref"] },
    ]);
    expect(r.map((c) => c.id)).toEqual(["1", "2"]);
    expect(r[0]).toMatchObject({ cited_by: 4, sources: ["openalex", "crossref"] });
  });
  it("interleave はソースを交互に", () => {
    const a = [{ id: "a1", title: "a1", cited_by: 0 }, { id: "a2", title: "a2", cited_by: 0 }];
    const b = [{ id: "b1", title: "b1", cited_by: 0 }];
    expect(interleave([a, b]).map((c) => c.id)).toEqual(["a1", "b1", "a2"]);
  });
  it("stripTags", () => {
    expect(stripTags("<p>a &amp; b</p>  c")).toBe("a & b c");
    expect(stripTags("<![CDATA[x & y]]>")).toBe("x & y");
    expect(stripTags("")).toBeNull();
  });
});
