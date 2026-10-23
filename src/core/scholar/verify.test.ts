import { describe, expect, it } from "vitest";
import { titleMatches, verifyRecalled } from "./verify";

describe("titleMatches", () => {
  it("記号・空白・大小を無視して一致", () => {
    expect(titleMatches("Attention Is All You Need", "attention is all you need!")).toBe(true);
    expect(titleMatches("注意機構だけで十分である", "注意機構だけで十分である。")).toBe(true);
  });
  it("副題の有無は許す。短い前方一致は許さない", () => {
    expect(titleMatches("Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks: A Survey")).toBe(true);
    expect(titleMatches("Deep Learning", "Deep Learning for Natural Language Processing")).toBe(false);
  });
});

describe("verifyRecalled", () => {
  const work = (over: Record<string, unknown> = {}) => ({
    id: "https://openalex.org/W1",
    doi: "https://doi.org/10.5555/attention",
    title: "Attention Is All You Need",
    publication_year: 2017,
    authorships: [{ author: { display_name: "Ashish Vaswani" } }],
    cited_by_count: 100000,
    ...over,
  });
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  /** lookupDoi は /works/https://doi.org/…、タイトル検索は /works?search= に来る */
  const fakeFetch = (byDoi: unknown | null, bySearch: unknown[]) =>
    (async (input: RequestInfo | URL) => (String(input).includes("/works?search=") ? json({ results: bySearch }) : byDoi ? json(byDoi) : new Response("", { status: 404 }))) as typeof fetch;

  it("DOI で引けて題名が合えば照合でき、書誌は API のもの・理由は LLM のものになる", async () => {
    const r = await verifyRecalled([{ title: "Attention is all you need", doi: "10.5555/attention", year: 2017, reason: "Transformer の原典" }], fakeFetch(work(), []));
    expect(r.unverified).toEqual([]);
    expect(r.verified[0]).toMatchObject({ doi: "10.5555/attention", title: "Attention Is All You Need", cited_by: 100000, reason: "Transformer の原典", recalled: true });
  });
  it("DOI の先の題名が合わなければタイトル検索で引き直す", async () => {
    const r = await verifyRecalled([{ title: "Attention Is All You Need", doi: "10.5555/attention", reason: "" }], fakeFetch(work({ title: "A Totally Different Paper" }), [work()]));
    expect(r.verified).toHaveLength(1);
    expect(r.verified[0].title).toBe("Attention Is All You Need");
  });
  it("タイトル検索でも見つからなければ「照合できなかった」へ", async () => {
    const r = await verifyRecalled([{ title: "This Paper Does Not Exist At All", authors: ["X"], year: 2020 }], fakeFetch(null, [work()]));
    expect(r.verified).toEqual([]);
    expect(r.unverified[0]).toMatchObject({ title: "This Paper Does Not Exist At All", authors: ["X"], year: 2020 });
    expect(r.unverified[0].note).toMatch(/見つかりません/);
  });
  it("副題つきの一致は、年が 2 年超ずれていたら別物とみなす", async () => {
    const hit = work({ title: "Attention Is All You Need: Extended Edition", publication_year: 2005 });
    const r = await verifyRecalled([{ title: "Attention Is All You Need", year: 2020 }], fakeFetch(null, [hit]));
    expect(r.verified).toEqual([]);
  });
  it("完全一致なら年のずれは問わない(プレプリントと出版のずれを捨てない)", async () => {
    const r = await verifyRecalled([{ title: "Attention Is All You Need", year: 2014 }], fakeFetch(null, [work()]));
    expect(r.verified).toHaveLength(1);
  });
  it("API エラーは「照合に失敗」として理由ごと返し、残りは続ける", async () => {
    const failFetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes(encodeURIComponent("Broken"))) throw new Error("network down");
      return json({ results: [work()] });
    }) as typeof fetch;
    const r = await verifyRecalled([{ title: "Broken Lookup" }, { title: "Attention Is All You Need" }], failFetch);
    expect(r.unverified[0].note).toMatch(/照合に失敗/);
    expect(r.verified).toHaveLength(1);
  });
});
