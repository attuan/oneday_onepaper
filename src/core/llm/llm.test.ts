import { describe, expect, it } from "vitest";
import { parseJsonLoose } from "./provider";
import { runGrade } from "./tasks";
import { estimateCostUsd, priceFor, roughTokenCount } from "@/core/usage/cost";
import { newPaper } from "@/core/papers/queue";
import type { LlmProvider } from "./provider";

describe("parseJsonLoose", () => {
  it("素の JSON / code fence / 前後にゴミ", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('結果: {"a":1} 以上')).toEqual({ a: 1 });
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
