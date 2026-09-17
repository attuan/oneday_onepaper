import { describe, expect, it } from "vitest";
import { completionShareText, escapeSlack, firstMemoLine } from "./share";
import { memoTemplate } from "@/core/memo/format";
import { newPaper } from "@/core/papers/queue";

describe("firstMemoLine", () => {
  it("見出しと空行を飛ばして最初の 1 行", () => {
    expect(firstMemoLine("# T\n\n## ひとこと\n\n- 注意機構だけで翻訳できる\n\n## 手法\n次の行")).toBe("注意機構だけで翻訳できる");
  });
  it("テンプレートのままなら空", () => {
    expect(firstMemoLine(memoTemplate(newPaper({ title: "T" }, [], "t")))).toBe("");
  });
  it("長い行は切る", () => {
    expect(firstMemoLine("あ".repeat(300))).toBe(`${"あ".repeat(140)}…`);
  });
});

describe("completionShareText", () => {
  const paper = newPaper({ title: "A <B> & C", authors: ["Vaswani", "Shazeer"], year: 2017, doi: "10.1/x" }, [], "t");
  it("タイトル・書誌・ひとこと・リンクを並べる", () => {
    expect(completionShareText({ paper, memoBody: "## ひとこと\n読んだ > 良い", streak: 3, displayName: "attuan" })).toBe(
      ["📖 attuan が今日の 1 本を読みました(連続 3 日)", "*A &lt;B&gt; &amp; C*(Vaswani ほか, 2017)", "> 読んだ &gt; 良い", "https://doi.org/10.1/x"].join("\n"),
    );
  });
  it("名前・ひとこと・リンクが無ければその行を出さない", () => {
    const bare = newPaper({ title: "T" }, [], "t");
    expect(completionShareText({ paper: bare, memoBody: "", streak: 1, displayName: " " })).toBe("📖 今日の 1 本を読みました(連続 1 日)\n*T*");
  });
  it("escapeSlack", () => {
    expect(escapeSlack("<!channel> & co")).toBe("&lt;!channel&gt; &amp; co");
  });
});
