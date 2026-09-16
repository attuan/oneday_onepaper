// CORS 中継(Cloudflare Workers)。ブラウザ版から学術 API と OA の PDF を取るためだけのもの。
//
// - GET だけ。上流へ渡すヘッダは Accept と、Semantic Scholar の x-api-key だけ(Cookie などは渡さない)
// - 学術 API 以外のホストは、PDF を返したときだけ中継する(汎用のプロキシにしない)
// - Origin が ALLOWED_ORIGINS に無ければ断る。ブラウザ以外からの利用を防ぐものではない
//
// 学術 API の一覧は src-tauri/capabilities/default.json の http 許可と揃えてある。

export interface Env {
  /** カンマ区切り。例: "http://localhost:1420,https://oneday.example.com" */
  ALLOWED_ORIGINS?: string;
}

export const API_HOSTS = new Set([
  "api.openalex.org",
  "api.semanticscholar.org",
  "api.crossref.org",
  "export.arxiv.org",
  "eutils.ncbi.nlm.nih.gov",
  "cir.nii.ac.jp",
  "api.jstage.jst.go.jp",
]);

/** ホストごとに、ブラウザから受け取って上流へ渡すヘッダ */
const PASS_HEADERS: Record<string, string[]> = {
  "api.semanticscholar.org": ["x-api-key"],
};

/** 上流の応答から返すヘッダ */
const KEEP_HEADERS = ["content-type", "content-length", "retry-after"];

export const MAX_BYTES = 50 * 1024 * 1024;

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "accept, x-api-key",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function reply(status: number, message: string, origin: string | null): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...(origin ? corsHeaders(origin) : {}) },
  });
}

export function allowedOrigin(origin: string | null, env: Env): string | null {
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(origin) ? origin : null;
}

/** 中継してよい URL なら URL を、だめなら理由を返す */
export function checkTarget(raw: string | null): URL | string {
  if (!raw) return "url パラメータがありません";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "url が不正です";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "http(s) 以外は中継しません";
  if (u.username || u.password) return "認証情報つきの URL は中継しません";
  if (u.port) return "既定以外のポートは中継しません";
  const h = u.hostname;
  if (h.startsWith("[") || /^[\d.]+$/.test(h)) return "IP アドレスへは中継しません";
  if (!h.includes(".") || /\.(localhost|local|internal)$/.test(h)) return "内部向けのホストへは中継しません";
  return u;
}

function looksLikePdf(res: Response, url: URL): boolean {
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("application/pdf")) return true;
  return type.includes("application/octet-stream") && url.pathname.toLowerCase().endsWith(".pdf");
}

/** max バイトを超えたら途中で打ち切る(content-length が無い応答のため) */
function limited(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        seen += chunk.byteLength;
        if (seen > max) ctl.error(new Error(`${max} バイトを超えました`));
        else ctl.enqueue(chunk);
      },
    }),
  );
}

export async function handle(request: Request, env: Env, max = MAX_BYTES): Promise<Response> {
  const origin = allowedOrigin(request.headers.get("origin"), env);
  if (!origin) return reply(403, "この Origin からの利用は許可されていません", null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "GET") return reply(405, "GET だけ受け付けます", origin);

  const target = checkTarget(new URL(request.url).searchParams.get("url"));
  if (typeof target === "string") return reply(400, target, origin);

  const headers = new Headers({ accept: request.headers.get("accept") ?? "*/*" });
  for (const name of PASS_HEADERS[target.hostname] ?? []) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.href, { headers, redirect: "follow" });
  } catch (e) {
    return reply(502, `取得に失敗しました: ${e instanceof Error ? e.message : e}`, origin);
  }

  // リダイレクトした後の行き先で判断する
  const finalUrl = upstream.url ? new URL(upstream.url) : target;
  if (!API_HOSTS.has(finalUrl.hostname)) {
    if (!upstream.ok) return reply(upstream.status, `取得に失敗しました (HTTP ${upstream.status})`, origin);
    if (!looksLikePdf(upstream, finalUrl)) return reply(403, "学術 API 以外は PDF だけ中継します", origin);
  }
  if (Number(upstream.headers.get("content-length") ?? 0) > max) {
    return reply(413, `大きすぎます(${Math.floor(max / 1024 / 1024)} MB まで)`, origin);
  }

  const out = new Headers(corsHeaders(origin));
  for (const name of KEEP_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) out.set(name, v);
  }
  return new Response(upstream.body ? limited(upstream.body, max) : null, { status: upstream.status, headers: out });
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
