import { describe, expect, it } from "vitest";
import { parseJsonLoose } from "./provider";
import { runGrade, verifyEvidence } from "./tasks";
import { estimateCostUsd, priceFor, roughTokenCount } from "@/core/usage/cost";
import { newPaper } from "@/core/papers/queue";
import type { LlmProvider } from "./provider";

describe("parseJsonLoose", () => {
  it("素の JSON / code fence / 前後にゴミ", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('結果: {"a":1} 以上')).toEqual({ a: 1 });
  });
  it("画面から手でコピーしたもの", () => {
    // NBSP・ゼロ幅文字・末尾カンマ
    expect(parseJsonLoose('{\u00a0"a":\u00a01,\u200b "b": [1, 2,],}')).toEqual({ a: 1, b: [1, 2] });
    // カーブした引用符。中身の " は残す
    expect(parseJsonLoose('{“a”: “x \"y\" z”}')).toEqual({ a: 'x "y" z' });
    // 文字列の中の生の改行
    expect(parseJsonLoose('{"a": "1 行目\n2 行目"}')).toEqual({ a: "1 行目\n2 行目" });
    // 後ろの文章に } があっても、対になる括弧で切る
    expect(parseJsonLoose('はい。{"a": "}"} 補足: {注} です')).toEqual({ a: "}" });
  });
  it("途中で切れているときはそう言う", () => {
    expect(() => parseJsonLoose('{"a": {"b": 1')).toThrow(/途中で切れて/);
    expect(() => parseJsonLoose("ただの文章")).toThrow(/解釈できません/);
  });
});

describe("cost", () => {
  it("単価表", () => {
    expect(priceFor("anthropic", "claude-opus-5")?.input).toBe(5);
    expect(priceFor("anthropic", "claude-opus-5-20990101")?.input).toBe(5);
    expect(priceFor("ollama", "llama3")).toBeNull();
    expect(estimateCostUsd("anthropic", "claude-opus-5", 1_000_000, 0)).toBe(5);
    expect(estimateCostUsd("ollama", "x", 1000, 1000)).toBe(0);
  });
  it("rough tokens", () => {
    expect(roughTokenCount("abcd")).toBe(1);
    expect(roughTokenCount("日本語")).toBe(4);
  });
});

describe("runGrade", () => {
  it("total を再計算する", async () => {
    const fake: LlmProvider = {
      name: "ollama",
      model: "fake",
      async complete() {
        return {
          text: JSON.stringify({
            items: [
              { name: "a", score: 5, comment: "" },
              { name: "b", score: 3, comment: "" },
              { name: "c", score: 9, comment: "" },
              { name: "d", score: 1, comment: "" },
            ],
            total: 99,
            overall_comment: "ok",
            missing_points: ["a", "b", "c", "d"],
            misreadings: "not an array",
          }),
          inputTokens: 10,
          outputTokens: 5,
          model: "fake",
        };
      },
      async countTokens() {
        return 0;
      },
    };
    const paper = newPaper({ title: "t" }, [], "now");
    const r = await runGrade(fake, { paper, text: "abs", inputKind: "abstract" }, "memo", "ja");
    expect(r.output.total).toBe(5 + 3 + 5 + 1);
    // 差分フィードバックは 3 つまで。欠けた項目や形の違うものは空にする
    expect(r.output.missing_points).toEqual(["a", "b", "c"]);
    expect(r.output.misreadings).toEqual([]);
    expect(r.output.good_points).toEqual([]);
    expect(r.output.next_step).toBe("");
  });
});

describe("verifyEvidence", () => {
  const base = { problem: "", method: "", results: "", limitations: "" };
  it("空白・改行・引用符の違いは無視して照合する。無い引用は found: false", () => {
    const src = "We propose a new simple network\narchitecture, the \u201cTransformer\u201d, based solely on attention.";
    const r = verifyEvidence({ ...base, evidence: [
      { field: "method", quote: 'architecture, the "Transformer", based solely', found: false },
      { field: "results", quote: "achieves 28.4 BLEU on WMT 2014", found: true },
    ] }, src);
    expect(r.evidence?.map((e) => e.found)).toEqual([true, false]);
  });
  it("形の違うもの・短すぎる引用は根拠にしない", () => {
    const r = verifyEvidence({ ...base, evidence: [{ field: "other", quote: "x" }, { field: "method", quote: "the" }, null] as never }, "the method");
    expect(r.evidence).toEqual([{ field: "method", quote: "the", found: false }]);
  });
});
