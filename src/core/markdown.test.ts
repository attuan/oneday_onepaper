import { describe, expect, it } from "vitest";
import { markdownTitle, renderInline, renderMarkdown } from "./markdown";

describe("renderInline", () => {
  it("エスケープしてから太字・コード・リンクにする", () => {
    expect(renderInline("a <b> & **強調** `x<y`")).toBe("a &lt;b&gt; &amp; <strong>強調</strong> <code>x&lt;y</code>");
    expect(renderInline("[arXiv](https://arxiv.org/)")).toBe('<a href="https://arxiv.org/" target="_blank" rel="noopener noreferrer">arXiv</a>');
    expect(renderInline("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
  });
});

describe("renderMarkdown", () => {
  it("見出し・段落・箇条書き・引用・コード・区切り線", () => {
    const md = ["# 題", "", "一行目", "二行目", "", "- a", "- b", "  続き", "", "1. one", "2) two", "", "> 引用", "", "```", "<code>", "```", "", "---"].join("\n");
    expect(renderMarkdown(md)).toBe(
      ["<h1>題</h1>", "<p>一行目 二行目</p>", "<ul><li>a</li><li>b 続き</li></ul>", "<ol><li>one</li><li>two</li></ol>", "<blockquote>引用</blockquote>", "<pre><code>&lt;code&gt;</code></pre>", "<hr>"].join("\n"),
    );
  });
  it("箇条書きの直後の段落は分ける", () => {
    expect(renderMarkdown("- a\nb")).toBe("<ul><li>a</li></ul>\n<p>b</p>");
  });
  it("タイトルは最初の # 見出し", () => {
    expect(markdownTitle("前置き\n# 題\n## 小")).toBe("題");
    expect(markdownTitle("## 小だけ")).toBeNull();
  });
});
