// CORS 中継(Cloudflare Workers)。ブラウザ版から学術 API と OA の PDF を取るためだけのもの。
//
// - 基本は GET だけ。上流へ渡すヘッダは Accept と、Semantic Scholar の x-api-key だけ(Cookie などは渡さない)
// - 学術 API 以外のホストは、PDF を返したときだけ中継する(汎用のプロキシにしない)
// - 例外として、通知の配信先(Slack の Webhook と LINE の Messaging API)への POST は本文ごと中継する。
//   このときだけ content-type と authorization を上流へ渡す
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

/** POST を中継するホスト(通知の配信先)。src/core/store/backends/web/fetch.ts の NOTIFY_POST_HOSTS と揃える */
export const NOTIFY_HOSTS = new Set(["hooks.slack.com", "api.line.me"]);

/** ホストごとに、ブラウザから受け取って上流へ渡すヘッダ */
const PASS_HEADERS: Record<string, string[]> = {
  "api.semanticscholar.org": ["x-api-key"],
  "hooks.slack.com": ["content-type"],
  "api.line.me": ["content-type", "authorization"],
};

/** 通知の本文の上限。通知は短い */
export const MAX_POST_BYTES = 16 * 1024;

/** 上流の応答から返すヘッダ */
const KEEP_HEADERS = ["content-type", "content-length", "retry-after"];

export const MAX_BYTES = 50 * 1024 * 1024;

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "accept, x-api-key, content-type, authorization",
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
  if (request.method !== "GET" && request.method !== "POST") return reply(405, "GET と POST だけ受け付けます", origin);

  const target = checkTarget(new URL(request.url).searchParams.get("url"));
  if (typeof target === "string") return reply(400, target, origin);
  if (request.method === "POST" && !NOTIFY_HOSTS.has(target.hostname)) return reply(405, "POST は通知の配信先(Slack / LINE)にだけ中継します", origin);

  const headers = new Headers({ accept: request.headers.get("accept") ?? "*/*" });
  for (const name of PASS_HEADERS[target.hostname] ?? []) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }

  let body: string | undefined;
  if (request.method === "POST") {
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_POST_BYTES) return reply(413, "本文が大きすぎます", origin);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.href, { method: request.method, headers, body, redirect: "follow" });
  } catch (e) {
    return reply(502, `取得に失敗しました: ${e instanceof Error ? e.message : e}`, origin);
  }

  if (request.method === "POST") {
    // 通知の配信先はリダイレクトしないので、行き先の再検査は要らない。応答は本文ごと返す(LINE はエラーの JSON を返す)
    const out = new Headers(corsHeaders(origin));
    for (const name of KEEP_HEADERS) {
      const v = upstream.headers.get(name);
      if (v) out.set(name, v);
    }
    return new Response(upstream.body ? limited(upstream.body, max) : null, { status: upstream.status, headers: out });
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
