// Tauri 実装。invoke とプラグインを呼ぶのはこのファイルだけ

import { Channel, invoke } from "@tauri-apps/api/core";
import { appConfigDir, downloadDir } from "@tauri-apps/api/path";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { joinPath, type ArxivIndexHit, type ArxivIndexProgress, type ArxivIndexStats, type Backend, type Row, type SqlParam } from "../backend";

async function readBinary(path: string): Promise<Uint8Array | null> {
  if (!(await invoke<boolean>("path_exists", { path }))) return null;
  // read_binary は ipc::Response で返すので、JSON ではなく ArrayBuffer で届く
  return new Uint8Array(await invoke<ArrayBuffer>("read_binary", { path }));
}

async function writeBinary(path: string, data: Uint8Array): Promise<void> {
  // 本文は生バイトで送る。パスはヘッダに載せるので ASCII にしておく
  await invoke("write_binary", data, { headers: { "x-path": encodeURIComponent(path) } });
}

export const tauriBackend: Backend = {
  name: "tauri",

  fs: {
    defaultDataDir: () => invoke<string>("default_data_dir"),
    appConfigDir: () => appConfigDir(),
    readText: (path) => invoke<string>("read_text", { path }),
    writeText: (path, content) => invoke<void>("write_text", { path, content }),
    readBinary,
    writeBinary,
    exists: (path) => invoke<boolean>("path_exists", { path }),
    listDir: (path) => invoke<string[]>("list_dir", { path }),
    mkdirAll: (path) => invoke<void>("mkdir_all", { path }),
    removeFile: (path) => invoke<void>("remove_file", { path }),
  },

  db: {
    open: (path) => invoke<void>("db_open", { path }),
    // WAL の中身を本体に書き戻す。これをしないと state.sqlite 単体では最近の記録が欠ける
    flush: async () => {
      await invoke("db_query", { sql: "PRAGMA wal_checkpoint(TRUNCATE)", params: [] });
    },
    close: () => invoke<void>("db_close"),
    execute: (sql, params: SqlParam[] = []) => invoke<number>("db_execute", { sql, params }),
    query: <T extends Row = Row>(sql: string, params: SqlParam[] = []) => invoke<T[]>("db_query", { sql, params }),
  },

  secret: {
    get: (key) => invoke<string | null>("secret_get", { key }),
    set: (key, value) => invoke<void>("secret_set", { key, value }),
    delete: (key) => invoke<void>("secret_delete", { key }),
  },

  notifier: {
    isPermissionGranted: () => isPermissionGranted(),
    requestPermission: async () => (await requestPermission()) === "granted",
    send: async (title, body) => {
      sendNotification({ title, body });
    },
  },

  opener: {
    url: (url) => openUrl(url),
    path: (path) => openPath(path),
  },

  pdf: {
    download: async (url, dest) => {
      await invoke("download_file", { url, dest });
    },
    extractText: (path) => invoke<string>("extract_pdf_text", { path }),
  },

  fetch: tauriFetch,

  arxivIndex: {
    download: async (url, dest, onProgress) => {
      const ch = new Channel<ArxivIndexProgress>();
      ch.onmessage = onProgress;
      await invoke("download_large", { url, dest, onProgress: ch });
    },
    build: (parquet, dest, categories, onProgress) => {
      const ch = new Channel<ArxivIndexProgress>();
      ch.onmessage = onProgress;
      return invoke<ArxivIndexStats>("arxiv_index_build", { parquet, dest, categories, onProgress: ch });
    },
    stats: (path) => invoke<ArxivIndexStats | null>("arxiv_index_stats", { path }),
    search: (path, q) =>
      invoke<ArxivIndexHit[]>("arxiv_index_search", { path, query: q.query, mode: q.mode, categories: q.categories ?? [], yearFrom: q.yearFrom ?? null, yearTo: q.yearTo ?? null, limit: q.limit ?? 25 }),
  },

  // WebView の <a download> は当てにならないので、ダウンロードフォルダに直接書く
  saveFile: async (fileName, data) => {
    const path = joinPath(await downloadDir(), fileName);
    await writeBinary(path, data);
    return `${path} に保存しました`;
  },
};
