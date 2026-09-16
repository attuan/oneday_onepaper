// 起動時にバックエンドを 1 つ選んで注入する。ここが Tauri 版と Web 版の分かれ目

import { setBackend } from "./backend";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function installBackend(): Promise<void> {
  // 動的 import にしておくと、それぞれのバンドルに他方のコードが混ざらない
  if (isTauri()) {
    const { tauriBackend } = await import("./backends/tauri");
    setBackend(tauriBackend);
    return;
  }
  const { webBackend } = await import("./backends/web");
  setBackend(webBackend);
}
