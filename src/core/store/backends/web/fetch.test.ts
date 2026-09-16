import { describe, expect, it } from "vitest";
import { proxied, shouldProxy } from "./fetch";

const PAGE = "https://oneday.example.com";

describe("shouldProxy", () => {
  it("別オリジンへの GET だけを回す", () => {
    expect(shouldProxy("https://api.openalex.org/works?search=x", "GET", PAGE)).toBe(true);
    expect(shouldProxy("https://arxiv.org/pdf/2401.00001", "get", PAGE)).toBe(true);
  });
  it("POST は回さない(Anthropic は直接呼べる)", () => {
    expect(shouldProxy("https://api.anthropic.com/v1/messages", "POST", PAGE)).toBe(false);
  });
  it("同じオリジン・相対 URL・ローカル(Ollama)は回さない", () => {
    expect(shouldProxy(`${PAGE}/assets/sql-wasm.wasm`, "GET", PAGE)).toBe(false);
    expect(shouldProxy("/assets/x.js", "GET", PAGE)).toBe(false);
    for (const u of ["http://localhost:11434/api/tags", "http://127.0.0.1:11434/", "http://[::1]:11434/"]) {
      expect(shouldProxy(u, "GET", PAGE), u).toBe(false);
    }
  });
  it("http(s) 以外は回さない", () => {
    expect(shouldProxy("blob:https://oneday.example.com/abc", "GET", PAGE)).toBe(false);
    expect(shouldProxy("data:text/plain,hi", "GET", PAGE)).toBe(false);
  });
});

describe("proxied", () => {
  it("行き先を url パラメータに符号化して載せる", () => {
    const target = "https://api.crossref.org/works?query=a b&rows=5";
    const p = new URL(proxied("https://proxy.example.workers.dev", target));
    expect(p.origin).toBe("https://proxy.example.workers.dev");
    expect(p.searchParams.get("url")).toBe(target);
  });
  it("末尾スラッシュやパス付きのベースでも壊れない", () => {
    expect(new URL(proxied("https://p.example.dev/", "https://x.org/a")).searchParams.get("url")).toBe("https://x.org/a");
    expect(proxied("https://p.example.dev/cors", "https://x.org/a")).toBe("https://p.example.dev/cors?url=https%3A%2F%2Fx.org%2Fa");
  });
});
