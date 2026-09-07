import { describe, expect, it } from "vitest";
import { newPaper, queue, reorderQueue, skipPaper, todaysPaper, normalizeDoi } from "./queue";
import { csvToPapers } from "./csv";
import type { Paper } from "@/core/types";

function mk(id: string, order: number, status: Paper["status"] = "unread"): Paper {
  return { ...newPaper({ title: id, id }, [], "t"), queue_order: order, status };
}

describe("queue", () => {
  const papers = [mk("a", 2), mk("b", 1), mk("c", 3, "read"), mk("d", 4)];
  it("unread を順に", () => {
    expect(queue(papers).map((p) => p.id)).toEqual(["b", "a", "d"]);
    expect(todaysPaper(papers)?.id).toBe("b");
  });
  it("skip で末尾へ", () => {
    const after = skipPaper(papers, "b");
    expect(queue(after).map((p) => p.id)).toEqual(["a", "d", "b"]);
    expect(after.find((p) => p.id === "b")?.skip_count).toBe(1);
  });
  it("reorder", () => {
    const after = reorderQueue(papers, ["d", "a"]);
    expect(queue(after).map((p) => p.id)).toEqual(["d", "a", "b"]);
  });
  it("newPaper は末尾に付く", () => {
    const p = newPaper({ title: "x" }, papers, "t");
    expect(p.queue_order).toBe(5);
    expect(p.id.startsWith("local:")).toBe(true);
  });
});

describe("normalizeDoi", () => {
  it("URL と prefix を落とす", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC")).toBe("10.1000/abc");
    expect(normalizeDoi("doi:10.1000/x")).toBe("10.1000/x");
  });
});

describe("csvToPapers", () => {
  it("引用符と authors 区切り", () => {
    const csv = 'title,authors,year,doi\n"Hello, World","A; B",2020,10.1/x\nNo year,,,\n';
    const r = csvToPapers(csv);
    expect(r.errors).toEqual([]);
    expect(r.papers[0]).toMatchObject({ title: "Hello, World", authors: ["A", "B"], year: 2020, doi: "10.1/x" });
    expect(r.papers[1]).toMatchObject({ title: "No year", year: null });
  });
  it("title 列なしはエラー", () => {
    expect(csvToPapers("a,b\n1,2").errors.length).toBe(1);
  });
});
