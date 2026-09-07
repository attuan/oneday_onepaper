// Tauri コマンドの薄いラッパ。ここ以外で invoke を呼ばない

import { invoke } from "@tauri-apps/api/core";

export const fs = {
  defaultDataDir: () => invoke<string>("default_data_dir"),
  readText: (path: string) => invoke<string>("read_text", { path }),
  writeText: (path: string, content: string) => invoke<void>("write_text", { path, content }),
  exists: (path: string) => invoke<boolean>("path_exists", { path }),
  listDir: (path: string) => invoke<string[]>("list_dir", { path }),
  mkdirAll: (path: string) => invoke<void>("mkdir_all", { path }),
  removeFile: (path: string) => invoke<void>("remove_file", { path }),
};

export type SqlParam = string | number | boolean | null;
export type Row = Record<string, string | number | null>;

export const db = {
  open: (path: string) => invoke<void>("db_open", { path }),
  execute: (sql: string, params: SqlParam[] = []) => invoke<number>("db_execute", { sql, params }),
  query: <T extends Row = Row>(sql: string, params: SqlParam[] = []) => invoke<T[]>("db_query", { sql, params }),
};

export const secret = {
  get: (key: string) => invoke<string | null>("secret_get", { key }),
  set: (key: string, value: string) => invoke<void>("secret_set", { key, value }),
  delete: (key: string) => invoke<void>("secret_delete", { key }),
};

export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .join("/");
}
