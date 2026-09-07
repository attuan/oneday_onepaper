import { describe, expect, it } from "vitest";
import { countMemoChars, memoTemplate, parseMemo, serializeMemo, memoFileName } from "./format";
import { judgeCompletion } from "./completion";
import { newPaper } from "@/core/papers/queue";

describe("memo format", () => {
  const paper = newPaper({ title: "Test Paper", id: "10.1/x" }, [], "t");
  it("template は見出しだけなので 0 文字", () => {
    expect(countMemoChars(memoTemplate(paper))).toBe(0);
  });
  it("文字数は見出し・空白を除く", () => {
    expect(countMemoChars("# T\n\n## A\n\nこんにちは 世界\n- x\n")).toBe(7 + 2);
  });
  it("round trip", () => {
    const fm = { paper_id: "10.1/x", date: "2026-09-07", chars: 5, completed: false, summary_input: "none" as const, score_total: null };
    const text = serializeMemo(fm, "# T\n\nbody\n");
    const m = parseMemo("p.md", text);
    expect(m?.frontmatter).toEqual(fm);
    expect(m?.body).toBe("# T\n\nbody\n");
  });
  it("score あり", () => {
    const text = serializeMemo({ paper_id: "a", date: "d", chars: 1, completed: true, summary_input: "abstract", score_total: 16 }, "x");
    expect(parseMemo("p", text)?.frontmatter.score_total).toBe(16);
  });
  it("file name は安全な文字に", () => {
    expect(memoFileName("2026-09-07", "10.48550/arXiv.1")).toBe("2026-09-07_10.48550_arXiv.1.md");
  });
});

describe("judgeCompletion", () => {
  it("閾値", () => {
    expect(judgeCompletion(199, 200, false).completed).toBe(false);
    expect(judgeCompletion(200, 200, false).completed).toBe(true);
    expect(judgeCompletion(199, 200, false).remaining).toBe(1);
  });
  it("成立後は取り消さない", () => {
    expect(judgeCompletion(0, 200, true).completed).toBe(true);
  });
});
