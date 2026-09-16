// テスト用のメモリ実装。removeFile は Tauri 版と同じく、無いファイルに対してはエラーにする

import type { Backend } from "../backend";

export interface MemoryBackend extends Backend {
  files: Map<string, Uint8Array>;
  /** db.flush / db.close / write / remove の呼び出し順 */
  log: string[];
  saved: { fileName: string; data: Uint8Array }[];
}

const norm = (path: string) => "/" + path.split("/").filter(Boolean).join("/");
const enc = new TextEncoder();
const dec = new TextDecoder();

export function memoryBackend(): MemoryBackend {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(["/"]);
  const log: string[] = [];
  const saved: MemoryBackend["saved"] = [];
  const put = (path: string, data: Uint8Array) => {
    files.set(norm(path), data.slice());
    log.push(`write ${norm(path)}`);
  };
  const unsupported = async (): Promise<never> => {
    throw new Error("memory backend では使えません");
  };

  return {
    name: "web",
    files,
    log,
    saved,
    fs: {
      defaultDataDir: async () => "/data",
      appConfigDir: async () => "/config",
      readText: async (path) => {
        const b = files.get(norm(path));
        if (!b) throw new Error(`ファイルがありません: ${path}`);
        return dec.decode(b);
      },
      writeText: async (path, content) => put(path, enc.encode(content)),
      readBinary: async (path) => files.get(norm(path))?.slice() ?? null,
      writeBinary: async (path, data) => put(path, data),
      exists: async (path) => {
        const p = norm(path);
        return files.has(p) || dirs.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/"));
      },
      listDir: async (path) => {
        const prefix = norm(path) + "/";
        return [...files.keys()]
          .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
          .map((k) => k.slice(prefix.length))
          .sort();
      },
      mkdirAll: async (path) => {
        dirs.add(norm(path));
      },
      removeFile: async (path) => {
        if (!files.delete(norm(path))) throw new Error(`ファイルがありません: ${path}`);
        log.push(`remove ${norm(path)}`);
      },
    },
    db: {
      open: async () => {},
      flush: async () => {
        log.push("db.flush");
      },
      close: async () => {
        log.push("db.close");
      },
      execute: async () => 0,
      query: async () => [],
    },
    secret: { get: async () => null, set: unsupported, delete: unsupported },
    notifier: { isPermissionGranted: async () => false, requestPermission: async () => false, send: unsupported },
    opener: { url: unsupported, path: unsupported },
    pdf: { download: unsupported, extractText: unsupported },
    fetch: unsupported,
    saveFile: async (fileName, data) => {
      saved.push({ fileName, data });
      return fileName;
    },
  };
}

export function textOf(b: MemoryBackend, path: string): string | null {
  const d = b.files.get(norm(path));
  return d ? dec.decode(d) : null;
}
