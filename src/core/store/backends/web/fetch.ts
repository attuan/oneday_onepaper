// ブラウザからの HTTP。Tauri の plugin-http と違って CORS に当たるので、
// VITE_PROXY_BASE を設定したときは GET だけプロキシ(proxy/)に逃がす。
//
// POST を素通しにしているのは、
//   - Anthropic は SDK が anthropic-dangerous-direct-browser-access を付けるので直接呼べる
//   - Ollama は localhost なので OLLAMA_ORIGINS の設定で通る
// から。学術 API と PDF の取得はすべて GET なので、これで足りる。

const PROXY: string | undefined = import.meta.env.VITE_PROXY_BASE || undefined;

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

/** プロキシに回すべきか。同じオリジンとローカル(Ollama)と GET 以外は直接 */
export function shouldProxy(url: string, method: string, pageOrigin: string): boolean {
  if (method.toUpperCase() !== "GET") return false;
  let u: URL;
  try {
    u = new URL(url, pageOrigin);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.origin === pageOrigin) return false;
  return !isLocal(u.hostname);
}

/** プロキシ経由の URL。proxy/src/worker.ts は ?url= で行き先を受け取る */
export function proxied(proxyBase: string, url: string): string {
  const u = new URL(proxyBase);
  u.searchParams.set("url", url);
  return u.href;
}

export const webFetch: typeof globalThis.fetch = (input, init) => {
  const url = urlOf(input);
  if (PROXY && shouldProxy(url, methodOf(input, init), location.origin)) {
    const target = proxied(PROXY, url);
    return input instanceof Request ? fetch(new Request(target, input), init) : fetch(target, init);
  }
  return fetch(input, init);
};
