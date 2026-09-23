import { describe, expect, it } from "vitest";
import type { ArxivIndexBackend, ArxivIndexHit } from "@/core/store/backend";
import { arxivIdOf, describeIndex, hitToCandidate, parseCategories, similarInIndex, splitAuthors, titleWords } from "./arxivLocal";
import { dedupe } from "./sources";
import { parseArxivFeed } from "./arxiv";

const hit = (id: string, title: string, year = 2020): ArxivIndexHit => ({ id, title, authors: "A. One, B. Two and C. Three", abstract: "abs", categories: "cs.CL cs.LG", primary_category: "cs.CL", doi: null, journal_ref: null, year, first_date: `${year}-01-02` });

describe("arxivLocal", () => {
  it("索引の行 → 候補。ライブの arXiv API と同じ id になるので重複統合できる", () => {
    const c = hitToCandidate(hit("1706.03762", "Attention Is All You Need", 2017));
    expect(c).toMatchObject({ id: "10.48550/arxiv.1706.03762", doi: "10.48550/arxiv.1706.03762", authors: ["A. One", "B. Two", "C. Three"], year: 2017, venue: "arXiv", url: "https://arxiv.org/abs/1706.03762", pdf_url: "https://arxiv.org/pdf/1706.03762", sources: ["arxiv_local"] });
    const live = parseArxivFeed(`<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention Is All You Need</title><summary>s</summary><published>2017-06-12T00:00:00Z</published><author><name>Ashish Vaswani</name></author></entry></feed>`);
    const merged = dedupe([c, ...live]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toEqual(["arxiv_local", "arxiv"]);
  });

  it("カテゴリと著者の分割", () => {
    expect(parseCategories(" cs.CL, cs.LG\nstat.ML cs.CL cs. ")).toEqual(["cs.CL", "cs.LG", "stat.ML", "cs"]);
    expect(splitAuthors("Yuxin Chen, Andrea J. Goldsmith and Yonina C. Eldar")).toEqual(["Yuxin Chen", "Andrea J. Goldsmith", "Yonina C. Eldar"]);
  });

  it("タイトルから検索語(短い語・一般語を除く)", () => {
    expect(titleWords("A Survey of Retrieval-Augmented Generation for Large Language Models")).toEqual(["survey", "retrieval-augmented", "generation", "large", "language", "models"]);
  });

  it("arXiv id の取り出し", () => {
    expect(arxivIdOf({ id: "10.48550/arxiv.2301.00001", doi: "10.48550/arxiv.2301.00001", url: null })).toBe("2301.00001");
    expect(arxivIdOf({ id: "local:x", doi: null, url: "https://arxiv.org/abs/2301.00002v2" })).toBe("2301.00002");
    expect(arxivIdOf({ id: "10.1000/x", doi: "10.1000/x", url: null })).toBeNull();
  });

  it("似た論文: 自分自身を除き、年の幅を付けて any で問い合わせる", async () => {
    const calls: unknown[] = [];
    const index: ArxivIndexBackend = {
      download: async () => {},
      build: async () => {
        throw new Error("no");
      },
      stats: async () => null,
      search: async (_p, q) => {
        calls.push(q);
        return [hit("2301.00001", "self"), hit("2301.00002", "other 1"), hit("2301.00003", "other 2")];
      },
    };
    const out = await similarInIndex(index, "/idx", { id: "10.48550/arxiv.2301.00001", doi: "10.48550/arxiv.2301.00001", url: null, title: "Retrieval augmented generation survey", year: 2023 }, 2);
    expect(out.map((c) => c.title)).toEqual(["other 1", "other 2"]);
    expect(calls[0]).toMatchObject({ mode: "any", query: "retrieval augmented generation survey", yearFrom: 2020, yearTo: 2026, limit: 3 });
    expect(await similarInIndex(index, "/idx", { id: "x", doi: null, url: null, title: "On", year: null })).toEqual([]);
  });

  it("索引の説明文", () => {
    expect(describeIndex({ path: "/x", papers: 123456, categories: ["cs.CL"], built_at: "2026-09-23T12:00:00Z", source: "f.parquet", snapshot: "2026-08-27", bytes: 300 * 1024 * 1024 })).toBe("123,456 本(cs.CL)、300 MB、作成 2026-09-23、収録は 2026-08-27 まで");
  });
});
