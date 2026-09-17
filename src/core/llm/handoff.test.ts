import { describe, expect, it } from "vitest";
import { buildHandoffPrompt, handoffReturnPaperId, handoffReturnUrl, parseHandoffResult, shortcutRunUrl } from "./handoff";
import { newPaper } from "@/core/papers/queue";

const paper = newPaper({ title: "Attention Is All You Need", id: "10.1/x y", authors: ["Vaswani"] }, [], "t");

describe("buildHandoffPrompt", () => {
  it("論文・メモ・返す形が入る", () => {
    const p = buildHandoffPrompt({ paper, text: "We propose the Transformer.", inputKind: "abstract" }, "注意機構だけで翻訳", "ja");
    expect(p).toContain("Attention Is All You Need");
    expect(p).toContain("We propose the Transformer.");
    expect(p).toContain("注意機構だけで翻訳");
    expect(p).toContain('"limitations"');
    expect(p).toContain("misreadings");
  });
});

describe("parseHandoffResult", () => {
  const summary = { problem: "p", method: "m", results: "r", limitations: "l" };
  it("要約と採点。点は 1〜5 に丸め、合計は数え直す", () => {
    const text = "```json\n" + JSON.stringify({ summary, grade: { items: [{ name: "a", score: 9, comment: "c" }, { name: "b", score: 2, comment: "" }], total: 99, overall_comment: "o" } }) + "\n```";
    const r = parseHandoffResult(text, "");
    expect(r.summary).toEqual({ ...summary, evidence: [] });
    expect(r.grade?.items.map((i) => i.score)).toEqual([5, 2]);
    expect(r.grade?.total).toBe(7);
    expect(r.grade?.missing_points).toEqual([]);
  });
  it("要約だけ・包まれていない・欠けた項目は「不明」", () => {
    const r = parseHandoffResult('はい。{"problem":"p","method":"m","evidence":[{"field":"method","quote":"based solely on  attention"},{"field":"method","quote":"made up sentence"}]}', "The Transformer is based solely on\nattention mechanisms.");
    expect(r.summary).toEqual({ problem: "p", method: "m", results: "不明", limitations: "不明", evidence: [{ field: "method", quote: "based solely on  attention", found: true }, { field: "method", quote: "made up sentence", found: false }] });
    expect(r.grade).toBeNull();
  });
  it("要約が無ければエラー", () => {
    expect(() => parseHandoffResult('{"foo":1}', "")).toThrow(/要約が見つかりません/);
    expect(() => parseHandoffResult("ただの文章", "")).toThrow();
    expect(() => parseHandoffResult(" ", "")).toThrow(/空/);
  });
});

describe("ショートカットの URL", () => {
  it("戻り先は今のページ + 論文 ID。往復で取り出せる", () => {
    const back = handoffReturnUrl("https://u.github.io/repo/?old=1#x", paper.id);
    expect(back).toBe("https://u.github.io/repo/?ai_return=10.1%2Fx+y");
    expect(handoffReturnPaperId(back)).toBe("10.1/x y");
    expect(handoffReturnPaperId("https://u.github.io/repo/")).toBeNull();
  });
  it("名前と戻り先を載せる", () => {
    const u = shortcutRunUrl("One Day", "https://a/b?ai_return=1");
    expect(u.startsWith("shortcuts://x-callback-url/run-shortcut?name=One%20Day&x-success=https%3A%2F%2Fa%2Fb%3Fai_return%3D1")).toBe(true);
  });
});
