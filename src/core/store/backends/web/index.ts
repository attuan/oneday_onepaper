// ブラウザ実装。データはこの端末のブラウザの中(OPFS と localStorage)にだけ置かれる。
// Tauri 版と違い、サイトデータを消すと一緒に消える。設定画面のエクスポートで書き出せるようにする予定。

import type { Backend } from "../../backend";
import { exists, listDir, mkdirAll, readBinary, readText, removeFile, write } from "./opfs";
import { webDb } from "./sqlite";
import { webFetch } from "./fetch";

const SECRET_PREFIX = "oneday:secret:";

function mimeFor(path: string): string {
  if (path.endsWith(".pdf")) return "application/pdf";
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

// Uint8Array<ArrayBufferLike> のままでは Blob の型に合わない。ここで扱うバッファは共有メモリではない
function blobOf(data: Uint8Array, path: string): Blob {
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeFor(path) });
}

export const webBackend: Backend = {
  name: "web",

  fs: {
    defaultDataDir: async () => "/OneDayOnePaper",
    appConfigDir: async () => "/config",
    readText,
    writeText: (path, content) => write(path, content),
    readBinary,
    writeBinary: (path, data) => write(path, data),
    exists,
    listDir,
    mkdirAll,
    removeFile,
  },

  db: webDb,

  // OS のキーチェーンに当たるものがブラウザには無い。localStorage に平文で置く
  secret: {
    get: async (key) => localStorage.getItem(SECRET_PREFIX + key),
    set: async (key, value) => localStorage.setItem(SECRET_PREFIX + key, value),
    delete: async (key) => localStorage.removeItem(SECRET_PREFIX + key),
  },

  // タブを開いている間だけ届く。閉じている間の通知には Web Push(= サーバー)が要る
  notifier: {
    isPermissionGranted: async () => "Notification" in window && Notification.permission === "granted",
    requestPermission: async () => {
      if (!("Notification" in window)) return false;
      return (await Notification.requestPermission()) === "granted";
    },
    send: async (title, body) => {
      new Notification(title, { body });
    },
  },

  opener: {
    url: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    path: async (path) => {
      // クリック直後に窓を開いておく。await の後だとポップアップブロックに掛かる
      const w = window.open("", "_blank");
      try {
        const bytes = await readBinary(path);
        if (!bytes) throw new Error(`ファイルがありません: ${path}`);
        const url = URL.createObjectURL(blobOf(bytes, path));
        if (w) w.location.href = url;
        else window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e) {
        w?.close();
        throw e;
      }
    },
  },

  pdf: {
    download: async (url, dest) => {
      const res = await webFetch(url);
      if (!res.ok) throw new Error(`PDF を取得できませんでした (HTTP ${res.status})`);
      await write(dest, new Uint8Array(await res.arrayBuffer()));
    },
    extractText: async (path) => {
      const bytes = await readBinary(path);
      if (!bytes) throw new Error(`PDF がありません: ${path}`);
      const { extractPdfText } = await import("./pdf");
      return extractPdfText(bytes);
    },
  },

  fetch: webFetch,

  saveFile: async (fileName, data) => {
    const url = URL.createObjectURL(blobOf(data, fileName));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return `${fileName} をダウンロードしました`;
  },
};
