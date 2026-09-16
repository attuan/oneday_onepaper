// sql.js(WASM の SQLite)。DB 全体をメモリに持ち、変更のたびに OPFS へ書き戻す。
// SQL 文字列はそのまま渡すので、core/store/db.ts のクエリは Tauri 版と共通のまま。

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { DbBackend, Row, SqlParam } from "../../backend";
import { readBinary, write } from "./opfs";

/** 書き戻しをまとめる間隔。短いほど取りこぼしにくく、長いほど書き込み回数が減る */
const SAVE_DELAY_MS = 300;

let SQL: SqlJsStatic | null = null;
let handle: Database | null = null;
let dbPath = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<void> = Promise.resolve();
let dirty = false;
let hooked = false;

function need(): Database {
  if (!handle) throw new Error("データベースが開かれていません");
  return handle;
}

/** sql.js は boolean を受け付けないので 0/1 に直す */
function toBind(params: SqlParam[]): (string | number | null)[] {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
}

/** メモリ上の DB を OPFS に書き戻す。呼び出しは直列化する */
export function flush(): Promise<void> {
  if (!handle || !dbPath || !dirty) return queue;
  dirty = false;
  const bytes = handle.export();
  queue = queue
    .then(() => write(dbPath, bytes))
    .catch((e) => {
      dirty = true; // 次の機会に再試行する
      console.error("state.sqlite の保存に失敗しました", e);
    });
  return queue;
}

function scheduleSave(): void {
  dirty = true;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, SAVE_DELAY_MS);
}

function installFlushHooks(): void {
  if (hooked) return;
  hooked = true;
  // タブを閉じる/隠すときの取りこぼしを減らす。OPFS の書き込みは非同期なので完全ではない
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("pagehide", () => void flush());
}

export const webDb: DbBackend = {
  async open(path) {
    if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const bytes = await readBinary(path);
    handle?.close();
    handle = bytes ? new SQL.Database(bytes) : new SQL.Database();
    dbPath = path;
    installFlushHooks();
  },

  flush,

  async close() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    await flush(); // 閉じる前の変更は書き出しておく(Tauri 版で接続を閉じたときと同じ)
    const h = handle;
    handle = null; // 以後の flush は何もしない。差し替えたファイルを古い内容で上書きしない
    dbPath = "";
    dirty = false;
    await queue;
    h?.close();
  },

  async execute(sql, params = []) {
    const d = need();
    if (params.length) d.run(sql, toBind(params));
    else d.run(sql); // スキーマのような複文はパラメータなしで渡す
    scheduleSave();
    return d.getRowsModified();
  },

  async query<T extends Row = Row>(sql: string, params: SqlParam[] = []) {
    const stmt = need().prepare(sql);
    try {
      if (params.length) stmt.bind(toBind(params));
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as unknown as T);
      return rows;
    } finally {
      stmt.free();
    }
  },
};
