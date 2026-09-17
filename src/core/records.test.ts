import { describe, expect, it } from "vitest";
import { heatmap, reviewKey, reviewsDue } from "./records";
import { newPaper } from "@/core/papers/queue";
import type { Memo, ReadLevel } from "@/core/types";

const memo = (paperId: string, date: string, level: ReadLevel, body = "## ひとこと\n覚えている"): Memo => ({
  path: "",
  frontmatter: { paper_id: paperId, date, chars: 10, completed: level >= 1, level, summary_input: "none", score_total: null },
  body,
});

describe("heatmap", () => {
  it("日曜始まりで、最後の週が今日を含む。その日の一番上の段階を採る", () => {
    // 2026-09-17 は木曜
    const weeks = heatmap([memo("a", "2026-09-16", 1), memo("b", "2026-09-16", 3), memo("c", "2026-09-07", 2), memo("d", "2026-09-15", 0)], "2026-09-17", 2);
    expect(weeks.map((w) => w[0].date)).toEqual(["2026-09-06", "2026-09-13"]);
    expect(weeks[1].map((c) => c.level)).toEqual([0, 0, 0, 3, 0, 0, 0]);
    expect(weeks[0][1]).toEqual({ date: "2026-09-07", level: 2, future: false });
    expect(weeks[1].map((c) => c.future)).toEqual([false, false, false, false, false, true, true]);
  });
});

describe("reviewsDue", () => {
  const papers = [newPaper({ title: "A", id: "a" }, [], "t"), newPaper({ title: "B", id: "b" }, [], "t"), newPaper({ title: "C", id: "c" }, [], "t")];
  const memos = [memo("a", "2026-09-10", 1), memo("b", "2026-08-17", 2), memo("c", "2026-09-12", 1)];
  it("7 日前と 30 日前(それぞれ 3 日の幅)。済ませたものは出さない", () => {
    const due = reviewsDue(papers, memos, "2026-09-17", new Set());
    expect(due.map((d) => [d.paper.id, d.after, d.daysAgo, d.oneLiner])).toEqual([["a", 7, 7, "覚えている"], ["b", 30, 31, "覚えている"]]);
    expect(reviewsDue(papers, memos, "2026-09-17", new Set([reviewKey("a", 7)])).map((d) => d.paper.id)).toEqual(["b"]);
  });
});

describe("月のまとめ", () => {
  it("書かなかった見出しとタイトル行を落とす", async () => {
    const { compactMemoBody } = await import("./records");
    expect(compactMemoBody("# T\n\n## ひとこと\n良い\n\n## 手法\n\n\n## 結果\n- 速い\n\n## 疑問\n")).toBe("## ひとこと\n良い\n\n## 結果\n- 速い");
  });
  it("その月に読了したものだけ、読んだ順に", async () => {
    const { monthDigest, buildRelatedWorkRequest } = await import("./records");
    const papers = [newPaper({ title: "A", id: "a", authors: ["X", "Y", "Z"], year: 2020, doi: "10.1/a" }, [], "t"), newPaper({ title: "B", id: "b" }, [], "t")];
    const memos = [memo("b", "2026-09-20", 1, "# B\n## ひとこと\nびー"), memo("a", "2026-09-03", 3, "# A\n## ひとこと\nえー"), memo("a", "2026-08-31", 1), memo("b", "2026-09-21", 0)];
    const md = monthDigest(papers, memos, "2026-09");
    expect(md).toContain("# 2026-09 に読んだもの(2 本)");
    expect(md.indexOf("## A")).toBeLessThan(md.indexOf("## B"));
    expect(md).toContain("X ほか, 2020 / https://doi.org/10.1/a");
    expect(md).toContain("### ひとこと\nえー");
    const req = buildRelatedWorkRequest(papers, memos, "2026-09", "ja");
    expect(req.user).toContain("[1] A(X ほか, 2020)");
    expect(req.user).toContain("[2] B");
  });
});
