import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkTarget, handle, MAX_BYTES } from "./worker";

const env = { ALLOWED_ORIGINS: "http://localhost:1420, https://oneday.example.com" };
const ORIGIN = "https://oneday.example.com";
const BASE = "https://proxy.example.workers.dev/";

function req(target: string | null, init: RequestInit & { origin?: string | null } = {}): Request {
  const u = new URL(BASE);
  if (target !== null) u.searchParams.set("url", target);
  const headers = new Headers(init.headers);
  const origin = init.origin === undefined ? ORIGIN : init.origin;
  if (origin) headers.set("origin", origin);
  return new Request(u, { ...init, headers });
}

/** 上流の応答。url はリダイレクト後の行き先 */
function upstream(body: BodyInit | null, init: ResponseInit & { url?: string } = {}): Response {
  const r = new Response(body, init);
  if (init.url) Object.defineProperty(r, "url", { value: init.url });
  return r;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const sentHeaders = () => new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);

describe("Origin と メソッド", () => {
  it("Origin が無い・許可リストに無いなら 403。CORS ヘッダも付けない", async () => {
    for (const origin of [null, "https://evil.example", "null"]) {
      const r = await handle(req("https://api.openalex.org/works", { origin }), env);
      expect(r.status, String(origin)).toBe(403);
      expect(r.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("ALLOWED_ORIGINS が未設定なら全部断る", async () => {
    expect((await handle(req("https://api.openalex.org/works"), {})).status).toBe(403);
  });
  it("プリフライトに答える。x-api-key を許可する", async () => {
    const r = await handle(req(null, { method: "OPTIONS" }), env);
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(r.headers.get("access-control-allow-headers")).toContain("x-api-key");
  });
  it("GET 以外は 405", async () => {
    const r = await handle(req("https://api.openalex.org/works", { method: "POST", body: "x" }), env);
    expect(r.status).toBe(405);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("行き先の検査", () => {
  it.each([
    [null, /url パラメータ/],
    ["not a url", /不正/],
    ["file:///etc/passwd", /http\(s\) 以外/],
    ["ftp://api.openalex.org/", /http\(s\) 以外/],
    ["https://user:pw@api.openalex.org/", /認証情報/],
    ["http://api.openalex.org:8080/", /ポート/],
    ["http://127.0.0.1/", /IP アドレス/],
    ["http://169.254.169.254/latest/meta-data", /IP アドレス/],
    ["http://[::1]/", /IP アドレス/],
    ["http://localhost/", /内部向け/],
    ["http://intranet/", /内部向け/],
    ["http://printer.local/", /内部向け/],
    ["http://metadata.google.internal/", /内部向け/],
  ])("%s は 400", async (target, why) => {
    const r = await handle(req(target), env);
    expect(r.status).toBe(400);
    expect(await r.text()).toMatch(why);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("既定のポートは明示されていても通す", () => {
    expect(checkTarget("https://api.openalex.org:443/works")).toBeInstanceOf(URL);
  });
});

describe("学術 API", () => {
  it("中身と状態をそのまま返し、CORS ヘッダを付ける", async () => {
    fetchMock.mockResolvedValue(upstream('{"results":[]}', { status: 200, headers: { "content-type": "application/json", "set-cookie": "a=b" } }));
    const r = await handle(req("https://api.openalex.org/works?search=x", { headers: { accept: "application/json" } }), env);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('{"results":[]}');
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openalex.org/works?search=x");
  });
  it("上流には Accept だけ渡し、Cookie や Authorization は渡さない", async () => {
    fetchMock.mockResolvedValue(upstream("{}", { status: 200 }));
    await handle(req("https://api.openalex.org/works", { headers: { accept: "application/json", cookie: "s=1", authorization: "Bearer t", "x-api-key": "k" } }), env);
    expect([...sentHeaders().keys()]).toEqual(["accept"]);
  });
  it("x-api-key は Semantic Scholar にだけ渡す", async () => {
    fetchMock.mockResolvedValue(upstream("{}", { status: 200 }));
    await handle(req("https://api.semanticscholar.org/graph/v1/paper/search?query=x", { headers: { "x-api-key": "k" } }), env);
    expect(sentHeaders().get("x-api-key")).toBe("k");
  });
  it("429 は状態と Retry-After を返す(アプリがレート制限の案内を出すため)", async () => {
    fetchMock.mockResolvedValue(upstream("slow down", { status: 429, headers: { "retry-after": "30" } }));
    const r = await handle(req("https://api.semanticscholar.org/graph/v1/paper/search"), env);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("30");
  });
  it("上流に繋がらなければ 502", async () => {
    fetchMock.mockRejectedValue(new Error("dns"));
    const r = await handle(req("https://api.crossref.org/works"), env);
    expect(r.status).toBe(502);
    expect(await r.text()).toMatch(/dns/);
  });
});

describe("学術 API 以外(PDF)", () => {
  const PDF = "%PDF-1.7 ...";
  it("application/pdf なら中継する", async () => {
    fetchMock.mockResolvedValue(upstream(PDF, { status: 200, headers: { "content-type": "application/pdf" } }));
    const r = await handle(req("https://www.jstage.jst.go.jp/article/x/_pdf"), env);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(PDF);
  });
  it("octet-stream は .pdf の URL のときだけ通す", async () => {
    fetchMock.mockResolvedValue(upstream(PDF, { status: 200, headers: { "content-type": "application/octet-stream" } }));
    expect((await handle(req("https://repo.example.ac.jp/files/paper.PDF"), env)).status).toBe(200);
    fetchMock.mockResolvedValue(upstream("bin", { status: 200, headers: { "content-type": "application/octet-stream" } }));
    expect((await handle(req("https://repo.example.ac.jp/files/tool.exe"), env)).status).toBe(403);
  });
  it("HTML などは中継しない", async () => {
    fetchMock.mockResolvedValue(upstream("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    const r = await handle(req("https://example.com/"), env);
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain("<html>");
  });
  it("失敗した応答は状態だけ返し、本文は返さない", async () => {
    fetchMock.mockResolvedValue(upstream("<html>secret</html>", { status: 404, headers: { "content-type": "text/html" } }));
    const r = await handle(req("https://example.com/paper.pdf"), env);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("secret");
  });
  it("学術 API から別ホストへリダイレクトされたら、行き先で判断する", async () => {
    fetchMock.mockResolvedValue(upstream("<html>", { status: 200, headers: { "content-type": "text/html" }, url: "https://elsewhere.example/landing" }));
    expect((await handle(req("https://api.crossref.org/works/10.1/x"), env)).status).toBe(403);
  });
  it("OA の PDF へのリダイレクトは通す", async () => {
    fetchMock.mockResolvedValue(upstream(PDF, { status: 200, headers: { "content-type": "application/pdf" }, url: "https://arxiv.org/pdf/2401.00001v2" }));
    expect((await handle(req("https://arxiv.org/pdf/2401.00001"), env)).status).toBe(200);
  });
});

describe("大きさの上限", () => {
  it("content-length が上限を超えていれば 413", async () => {
    fetchMock.mockResolvedValue(upstream("x", { status: 200, headers: { "content-type": "application/pdf", "content-length": String(MAX_BYTES + 1) } }));
    expect((await handle(req("https://example.com/a.pdf"), env)).status).toBe(413);
  });
  it("content-length が無くても、上限を超えたところで打ち切る", async () => {
    const big = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(8));
        c.enqueue(new Uint8Array(8));
        c.close();
      },
    });
    fetchMock.mockResolvedValue(upstream(big, { status: 200, headers: { "content-type": "application/pdf" } }));
    const r = await handle(req("https://example.com/a.pdf"), env, 10);
    expect(r.status).toBe(200);
    await expect(r.arrayBuffer()).rejects.toThrow();
  });
  it("上限以内ならそのまま流す", async () => {
    fetchMock.mockResolvedValue(upstream(new Uint8Array(10), { status: 200, headers: { "content-type": "application/pdf" } }));
    const r = await handle(req("https://example.com/a.pdf"), env, 10);
    expect((await r.arrayBuffer()).byteLength).toBe(10);
  });
});
