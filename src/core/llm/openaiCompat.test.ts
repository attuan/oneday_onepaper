import { describe, expect, it } from "vitest";
import { OpenAiCompatProvider } from "./openaiCompat";

const ok = (content: string) => new Response(JSON.stringify({ model: "m-1", choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });

describe("OpenAiCompatProvider", () => {
  it("/chat/completions に投げ、スキーマは文面で伝えて JSON モードを頼む", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok('{"a":1}');
    }) as unknown as typeof fetch;
    const p = new OpenAiCompatProvider({ baseUrl: "https://x.test/v1/", apiKey: " k ", model: "m", fetch: fetchFn });
    const r = await p.complete({ system: "sys", user: "u", schema: { type: "object" } });
    expect(r).toEqual({ text: '{"a":1}', inputTokens: 10, outputTokens: 5, model: "m-1" });
    expect(calls[0].url).toBe("https://x.test/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain('{"type":"object"}');
  });
  it("JSON モードを知らないサーバー(400)には、外してもう一度。キーなしなら Authorization を付けない", async () => {
    const bodies: Record<string, unknown>[] = [];
    const headers: Record<string, string>[] = [];
    const fetchFn = (async (_: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      headers.push(init.headers as Record<string, string>);
      return bodies.length === 1 ? new Response("unknown field", { status: 400 }) : ok("{}");
    }) as unknown as typeof fetch;
    await new OpenAiCompatProvider({ baseUrl: "http://localhost:1234/v1", model: "m", fetch: fetchFn }).complete({ system: "s", user: "u", schema: {} });
    expect(bodies.map((b) => "response_format" in b)).toEqual([true, false]);
    expect(headers[0].authorization).toBeUndefined();
  });
  it("401 と 429 は種類つきのエラー", async () => {
    const mk = (status: number) => new OpenAiCompatProvider({ baseUrl: "https://x.test", model: "m", fetch: (async () => new Response("", { status })) as unknown as typeof fetch });
    await expect(mk(401).complete({ system: "", user: "" })).rejects.toMatchObject({ kind: "auth" });
    await expect(mk(429).complete({ system: "", user: "" })).rejects.toMatchObject({ kind: "rate_limit" });
  });
});
