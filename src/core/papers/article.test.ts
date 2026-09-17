import { describe, expect, it } from "vitest";
import { articleInput, findUrl, normalizeArticleUrl } from "./article";

describe("記事", () => {
  it("計測用のパラメータと # を落とす。URL でなければ null", () => {
    expect(normalizeArticleUrl(" https://zenn.dev/a/articles/x?utm_source=tw&page=2#top ")).toBe("https://zenn.dev/a/articles/x?page=2");
    expect(normalizeArticleUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeArticleUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeArticleUrl("zenn の記事")).toBeNull();
  });
  it("文の中から URL を拾う", () => {
    expect(findUrl("RAG 入門 https://zenn.dev/a/articles/x を読む")).toBe("https://zenn.dev/a/articles/x");
    expect(findUrl("URL なし")).toBeNull();
  });
  it("id は URL から作る(同じ記事は重複になる)。掲載はホスト名", () => {
    expect(articleInput("https://www.example.com/post?utm_medium=x", " 題 ")).toEqual({ id: "url:https://www.example.com/post", kind: "article", title: "題", url: "https://www.example.com/post", venue: "example.com", source: "manual" });
    expect(articleInput("https://example.com", " ")).toBeNull();
  });
});
