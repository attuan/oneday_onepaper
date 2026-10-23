import { describe, expect, it } from "vitest";
import { buildRecallPrompt, parseRecallAnswer } from "./recall";

describe("AI の記憶から候補(recall)", () => {
  const prompt = buildRecallPrompt("transformer attention", "修論のため", "ja");
  it("プロンプトにキーワード・補足・返す形が入る", () => {
    expect(prompt).toContain("transformer attention");
    expect(prompt).toContain("修論のため");
    expect(prompt).toContain('"papers"');
    expect(prompt).toContain("推測で作らない");
  });
  it("空文字・0 は null になり、arXiv ID から DOI・URL を作る", () => {
    const r = parseRecallAnswer(
      JSON.stringify({
        papers: [
          { title: "Attention Is All You Need", authors: ["Vaswani"], year: 2017, venue: "", doi: "", arxiv_id: "1706.03762", reason: "原典" },
          { title: "Unknown Year", authors: [], year: 0, venue: "", doi: "", arxiv_id: "", reason: "" },
        ],
      }),
      prompt,
    );
    expect(r[0]).toMatchObject({ doi: "10.48550/arxiv.1706.03762", url: "https://arxiv.org/abs/1706.03762", venue: null, reason: "原典" });
    expect(r[1]).toMatchObject({ title: "Unknown Year", year: null, doi: null, reason: null });
  });
  it("プロンプトのまま・空は断る", () => {
    expect(() => parseRecallAnswer(" ", prompt)).toThrow(/空/);
    expect(() => parseRecallAnswer(prompt, prompt)).toThrow(/プロンプトのまま/);
  });
});
