import { describe, expect, it } from "vitest";
import { countMemoChars, memoTemplate, parseMemo, serializeMemo, memoFileName } from "./format";
import { judgeCompletion, levelThresholds } from "./completion";
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
    const fm = { paper_id: "10.1/x", date: "2026-09-07", chars: 5, completed: false, level: 0 as const, summary_input: "none" as const, score_total: null };
    const text = serializeMemo(fm, "# T\n\nbody\n");
    const m = parseMemo("p.md", text);
    expect(m?.frontmatter).toEqual(fm);
    expect(m?.body).toBe("# T\n\nbody\n");
  });
  it("score あり", () => {
    const text = serializeMemo({ paper_id: "a", date: "d", chars: 1, completed: true, level: 2, summary_input: "abstract", score_total: 16 }, "x");
    expect(parseMemo("p", text)?.frontmatter.score_total).toBe(16);
  });
  it("level の無い昔の読了メモは Lv3 として読む", () => {
    const old = '---\npaper_id: "a"\ndate: 2026-09-07\nchars: 250\ncompleted: true\nsummary_input: "none"\nscore_total: null\n---\n\nx';
    expect(parseMemo("p", old)?.frontmatter).toMatchObject({ completed: true, level: 3 });
    expect(parseMemo("p", old.replace("completed: true", "completed: false"))?.frontmatter).toMatchObject({ completed: false, level: 0 });
  });
  it("file name は安全な文字に", () => {
    expect(memoFileName("2026-09-07", "10.48550/arXiv.1")).toBe("2026-09-07_10.48550_arXiv.1.md");
  });
});

describe("judgeCompletion", () => {
  const t = levelThresholds({ quick_memo_chars: 20, standard_memo_chars: 80, min_memo_chars: 200 });
  it("Lv1 に届けば読了", () => {
    expect(judgeCompletion(19, t, 0)).toMatchObject({ completed: false, level: 0, next: { level: 1, required: 20, remaining: 1 } });
    expect(judgeCompletion(20, t, 0)).toMatchObject({ completed: true, level: 1, next: { level: 2, remaining: 60 } });
    expect(judgeCompletion(80, t, 1).level).toBe(2);
    expect(judgeCompletion(200, t, 0)).toMatchObject({ level: 3, next: null });
  });
  it("届いた段階は取り消さない", () => {
    expect(judgeCompletion(0, t, 2)).toMatchObject({ completed: true, level: 2 });
  });
  it("Lv3 を下げた設定でも閾値は Lv1 <= Lv2 <= Lv3", () => {
    expect(levelThresholds({ quick_memo_chars: 20, standard_memo_chars: 80, min_memo_chars: 50 })).toEqual([20, 50, 50]);
    expect(levelThresholds({ quick_memo_chars: 20, standard_memo_chars: 80, min_memo_chars: 10 })).toEqual([10, 10, 10]);
  });
});
