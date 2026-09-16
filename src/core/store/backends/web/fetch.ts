// ブラウザからの HTTP。Tauri の plugin-http と違って CORS に当たるので、
// VITE_PROXY_BASE を設定したときは GET をプロキシ(proxy/)に逃がす。
//
// POST を素通しにしているのは、
//   - Anthropic は SDK が anthropic-dangerous-direct-browser-access を付けるので直接呼べる
//   - Ollama は localhost なので OLLAMA_ORIGINS の設定で通る
// から。学術 API と PDF の取得はすべて GET なので、これで足りる。
//
// 例外は通知の配信先(Slack の Webhook と LINE の Messaging API)。どちらも CORS を許可していないので、
// 中継があれば POST も中継に回す。中継が無いときの Slack は no-cors のフォーム送信で通す
// (応答は見えないが送れる)。LINE は Authorization ヘッダが要るので中継なしでは送れない。

import { LINE_API_HOST, SLACK_WEBHOOK_HOST } from "@/core/notifyChannels";

const PROXY: string | undefined = import.meta.env.VITE_PROXY_BASE || undefined;

/** POST でも中継に回すホスト。proxy/src/worker.ts の NOTIFY_HOSTS と揃える */
export const NOTIFY_POST_HOSTS = new Set([SLACK_WEBHOOK_HOST, LINE_API_HOST]);

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return init?.method ?? (input instanceof Request ? input.method : "GET");
}

function isLocal(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function parse(url: string, pageOrigin: string): URL | null {
  try {
    const u = new URL(url, pageOrigin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u;
  } catch {
    return null;
  }
}

/** プロキシに回すべきか。同じオリジンとローカル(Ollama)は直接。GET 以外は通知の配信先だけ */
export function shouldProxy(url: string, method: string, pageOrigin: string): boolean {
  const u = parse(url, pageOrigin);
  if (!u) return false;
  if (u.origin === pageOrigin || isLocal(u.hostname)) return false;
  const m = method.toUpperCase();
  if (m === "GET") return true;
  return m === "POST" && NOTIFY_POST_HOSTS.has(u.hostname);
}

/** 中継なしでも送れるように、Slack の Webhook への POST を no-cors のフォーム送信に変える */
export function isDirectSlackPost(url: string, method: string, pageOrigin: string): boolean {
  const u = parse(url, pageOrigin);
  return !!u && method.toUpperCase() === "POST" && u.hostname === SLACK_WEBHOOK_HOST;
}

/** プロキシ経由の URL。proxy/src/worker.ts は ?url= で行き先を受け取る */
export function proxied(proxyBase: string, url: string): string {
  const u = new URL(proxyBase);
  u.searchParams.set("url", url);
  return u.href;
}

export const webFetch: typeof globalThis.fetch = (input, init) => {
  const url = urlOf(input);
  const method = methodOf(input, init);
  if (PROXY && shouldProxy(url, method, location.origin)) {
    const target = proxied(PROXY, url);
    return input instanceof Request ? fetch(new Request(target, input), init) : fetch(target, init);
  }
  if (!PROXY && isDirectSlackPost(url, method, location.origin) && typeof init?.body === "string") {
    // Slack は payload=<JSON> のフォーム形式も受け付ける。これなら preflight が要らない
    const form = new URLSearchParams({ payload: init.body });
    return fetch(url, { method: "POST", mode: "no-cors", body: form });
  }
  return fetch(input, init);
};
