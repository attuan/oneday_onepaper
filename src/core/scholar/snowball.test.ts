import { describe, expect, it } from "vitest";
import type { Paper } from "@/core/types";
import { citingWorks, lookupWork, referencedOf, workIdOf, worksByIds } from "./openalex";
import { annotateSnowball, resolveSeed, sortSnowball, type SnowballCandidate } from "./snowball";
import type { WorkCandidate } from "./openalex";

const work = (id: string, over: Record<string, unknown> = {}) => ({
  id: `https://openalex.org/${id}`,
  doi: null,
  title: `Paper ${id}`,
  publication_year: 2020,
  cited_by_count: 1,
  ...over,
});

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("openalex 引用グラフ", () => {
  it("workIdOf", () => {
    expect(workIdOf("https://openalex.org/W123")).toBe("W123");
    expect(workIdOf("W123")).toBe("W123");
  });

  it("lookupWork は DOI で引き、referenced を W-ID に落とす", async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return okJson(work("W1", { doi: "https://doi.org/10.1000/X", referenced_works: ["https://openalex.org/W2", "https://openalex.org/W3"] }));
    }) as typeof fetch;
    const c = await lookupWork({ doi: "10.1000/X" }, fetchFn);
    expect(urls[0]).toContain("/works/https://doi.org/10.1000/x");
    expect(urls[0]).toContain("referenced_works");
    expect(c).toMatchObject({ workId: "W1", id: "10.1000/x", referenced: ["W2", "W3"] });
  });

  it("lookupWork は 404 で null、referenced_works 無しは空", async () => {
    expect(await lookupWork({ doi: "10.1/x" }, (async () => new Response("", { status: 404 })) as typeof fetch)).toBeNull();
    const c = await lookupWork({ workId: "W9" }, (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/works/W9?");
      return okJson(work("W9"));
    }) as typeof fetch);
    expect(c).toMatchObject({ workId: "W9", referenced: [] });
  });

  it("worksByIds は 1 回の filter=openalex で引く。空なら呼ばない", async () => {
    expect(await worksByIds([], (async () => { throw new Error("呼ばれないはず"); }) as unknown as typeof fetch)).toEqual([]);
    const cs = await worksByIds(["W1", "W2"], (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("filter=openalex:W1|W2");
      return okJson({ results: [work("W1"), work("W2")] });
    }) as typeof fetch);
    expect(cs.map((c) => c.workId)).toEqual(["W1", "W2"]);
  });

  it("citingWorks は cites フィルタと並び順を渡し、総数を返す", async () => {
    const r = await citingWorks("W7", "publication_date:desc", (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("filter=cites:W7");
      expect(String(input)).toContain("sort=publication_date:desc");
      return okJson({ meta: { count: 123 }, results: [work("W8")] });
    }) as typeof fetch);
    expect(r.count).toBe(123);
    expect(r.items[0].workId).toBe("W8");
  });

  it("referencedOf は DOI → W-ID の配列。DOI は正規化し、頼んでいない DOI の work は捨てる", async () => {
    const m = await referencedOf(["https://doi.org/10.1/A"], (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("filter=doi:10.1/a");
      return okJson({
        results: [
          work("W1", { doi: "https://doi.org/10.1/A", referenced_works: ["https://openalex.org/W5"] }),
          // OpenAlex の誤マージで混ざる、頼んでいない DOI の work
          work("W2", { doi: "https://doi.org/10.9/other", referenced_works: ["https://openalex.org/W6"] }),
        ],
      });
    }) as typeof fetch);
    expect(m.get("10.1/a")).toEqual(["W5"]);
    expect(m.size).toBe(1);
  });
});

describe("resolveSeed", () => {
  it("DOI があればそれで引く", async () => {
    const seed = await resolveSeed({ title: "T", doi: "10.1/x", year: 2020 }, (async () => okJson(work("W1", { doi: "https://doi.org/10.1/x", referenced_works: [] }))) as typeof fetch);
    expect(seed?.workId).toBe("W1");
  });

  it("DOI が無ければタイトル検索で突き合わせ、見つけた work を引き直す", async () => {
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("search=")) return okJson({ results: [work("W2", { title: "Attention Is All You Need", publication_year: 2017 })] });
      return okJson(work("W2", { title: "Attention Is All You Need", referenced_works: ["https://openalex.org/W3"] }));
    }) as typeof fetch;
    const seed = await resolveSeed({ title: "Attention Is All You Need", doi: null, year: 2017 }, fetchFn);
    expect(seed).toMatchObject({ workId: "W2", referenced: ["W3"] });
    expect(urls[1]).toContain("/works/W2?");
  });

  it("タイトルが合っても年が離れすぎなら別物。見つからなければ null", async () => {
    const fetchFn = (async () => okJson({ results: [work("W2", { title: "Same Title", publication_year: 1990 })] })) as typeof fetch;
    expect(await resolveSeed({ title: "Same Title", doi: null, year: 2020 }, fetchFn)).toBeNull();
  });
});

describe("annotateSnowball / sortSnowball", () => {
  const paper = (id: string, status: Paper["status"]): Paper =>
    ({ id, title: id, authors: [], year: null, venue: null, doi: id, url: null, pdf_url: null, abstract: null, reason: null, source: "import", status, queue_order: 0, added_at: "", read_at: null, skip_count: 0, bibtex: null, fulltext_tokens: null }) as Paper;
  const cand = (workId: string, id: string, over: Partial<WorkCandidate> = {}): WorkCandidate => ({ workId, id, title: `Paper ${id}`, cited_by: 0, ...over });

  it("リストにあるか・サーベイか・共引用を付け、種は除く", () => {
    const papers = [paper("10.1/read", "read"), paper("10.1/unread", "unread"), paper("10.1/removed", "removed")];
    const cands = [
      cand("W0", "10.1/seed"),
      cand("W1", "10.1/read"),
      cand("W2", "10.1/unread"),
      cand("W3", "10.1/removed"),
      cand("W4", "10.1/new", { title: "A Survey of Things" }),
    ];
    const refsOfMine = new Map([
      ["10.1/read", ["W4", "W1"]],
      ["10.1/unread", ["W4"]],
    ]);
    const out = annotateSnowball(cands, papers, { id: "10.1/seed", workId: "W0" }, refsOfMine);
    expect(out.map((c) => c.id)).toEqual(["10.1/read", "10.1/unread", "10.1/removed", "10.1/new"]);
    expect(out.map((c) => c.known)).toEqual(["read", "unread", null, null]);
    expect(out.map((c) => c.survey)).toEqual([false, false, false, true]);
    expect(out.map((c) => c.coCited)).toEqual([1, 0, 0, 2]);
  });

  it("並びは共引用 → 被引用数", () => {
    const c = (id: string, coCited: number, cited_by: number): SnowballCandidate => ({ ...cand(id, id, { cited_by }), known: null, survey: false, coCited });
    const out = sortSnowball([c("a", 0, 100), c("b", 2, 1), c("c", 2, 50), c("d", 1, 0)]);
    expect(out.map((x) => x.id)).toEqual(["c", "b", "d", "a"]);
  });
});
