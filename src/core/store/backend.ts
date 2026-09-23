// OS に触る処理の境界。core と ui はここだけを見て、実装(Tauri / Web)は起動時に注入する。
//
// 方針は仕様 3 の役割分担のまま: 「OS の代わりに何かをする」ものだけがここに来る。
// Tauri 固有の import はこのファイルには無く、backends/ 以下だけが持つ。

export type SqlParam = string | number | boolean | null;
export type Row = Record<string, string | number | null>;

/** ファイル。パスは文字列で、区切りは "/"(Web 実装では OPFS 内の相対パスになる) */
export interface FsBackend {
  /** 既定のデータフォルダ(仕様 4.1) */
  defaultDataDir(): Promise<string>;
  /** data_dir を指すポインタ config.json を置く場所 */
  appConfigDir(): Promise<string>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  /** 無ければ null。state.sqlite・PDF・エクスポートに使う */
  readBinary(path: string): Promise<Uint8Array | null>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** ディレクトリ直下のファイル名(パスではない)。存在しなければ空配列 */
  listDir(path: string): Promise<string[]>;
  mkdirAll(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

/** SQLite。SQL 文字列はそのまま渡すので、実装を替えても db.ts は変わらない */
export interface DbBackend {
  open(path: string): Promise<void>;
  /** ファイル上の state.sqlite を最新にする(エクスポートの前に呼ぶ) */
  flush(): Promise<void>;
  /** 閉じる。以後ファイルを書き換えてもメモリ上の古い内容で上書きされない */
  close(): Promise<void>;
  execute(sql: string, params?: SqlParam[]): Promise<number>;
  query<T extends Row = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
}

/** API キーの保管。Tauri では OS キーチェーン、Web では別の手段になる */
export interface SecretBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface NotifierBackend {
  isPermissionGranted(): Promise<boolean>;
  /** 許可されたら true */
  requestPermission(): Promise<boolean>;
  send(title: string, body: string): Promise<void>;
}

export interface OpenerBackend {
  /** 外部リンクを開く */
  url(url: string): Promise<void>;
  /** 保存済みのローカルファイルを開く */
  path(path: string): Promise<void>;
}

export interface PdfBackend {
  /** url の中身を dest に保存する */
  download(url: string, dest: string): Promise<void>;
  extractText(path: string): Promise<string>;
}

// ---- arXiv の手元の索引(デスクトップ版だけ。core/scholar/arxivLocal.ts が使う) ----

export interface ArxivIndexProgress {
  /** download = Parquet の取得、read = Parquet を読んで書き込み、finish = 全文索引の構築 */
  phase: "download" | "read" | "finish";
  done: number;
  total: number;
  /** 条件に合って索引に入った本数 */
  kept: number;
}

export interface ArxivIndexStats {
  path: string;
  papers: number;
  categories: string[];
  built_at: string;
  source: string;
  /** 索引の中で一番新しい版の日付 */
  snapshot: string | null;
  bytes: number;
}

export interface ArxivIndexHit {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  categories: string;
  primary_category: string;
  doi: string | null;
  journal_ref: string | null;
  year: number | null;
  first_date: string | null;
}

export interface ArxivIndexQuery {
  query: string;
  /** all = 全部の語を含む、any = どれかを含む(似た論文を探すとき) */
  mode: "all" | "any";
  categories?: string[];
  yearFrom?: number | null;
  yearTo?: number | null;
  limit?: number;
}

export interface ArxivIndexBackend {
  /** 大きなファイルを途中経過つきで保存する */
  download(url: string, dest: string, onProgress: (p: ArxivIndexProgress) => void): Promise<void>;
  /** Parquet(metadata config)から dest に索引を作る。categories が空なら全部 */
  build(parquetPath: string, dest: string, categories: string[], onProgress: (p: ArxivIndexProgress) => void): Promise<ArxivIndexStats>;
  /** 無ければ null */
  stats(path: string): Promise<ArxivIndexStats | null>;
  search(path: string, q: ArxivIndexQuery): Promise<ArxivIndexHit[]>;
}

export interface Backend {
  readonly name: "tauri" | "web";
  /** 無い実装(Web)では undefined。UI はこれで機能ごと隠す */
  readonly arxivIndex?: ArxivIndexBackend;
  readonly fs: FsBackend;
  readonly db: DbBackend;
  readonly secret: SecretBackend;
  readonly notifier: NotifierBackend;
  readonly opener: OpenerBackend;
  readonly pdf: PdfBackend;
  /** CORS を回避できる fetch。学術 API と LLM はこれを使う */
  readonly fetch: typeof globalThis.fetch;
  /** 書き出したファイルをユーザーの手元に渡す。どこに置いたかを文で返す */
  saveFile(fileName: string, data: Uint8Array): Promise<string>;
}

let current: Backend | null = null;

export function setBackend(b: Backend): void {
  current = b;
}

export function getBackend(): Backend {
  if (!current) throw new Error("バックエンドが未設定です。起動時に installBackend() を呼んでください");
  return current;
}

export function backendName(): Backend["name"] | null {
  return current?.name ?? null;
}

// 以下は呼び出し側の見た目を変えないための薄い委譲。
// getBackend() を呼ぶのは実行時なので、import 順に依存しない。

export const fs: FsBackend = {
  defaultDataDir: () => getBackend().fs.defaultDataDir(),
  appConfigDir: () => getBackend().fs.appConfigDir(),
  readText: (path) => getBackend().fs.readText(path),
  writeText: (path, content) => getBackend().fs.writeText(path, content),
  readBinary: (path) => getBackend().fs.readBinary(path),
  writeBinary: (path, data) => getBackend().fs.writeBinary(path, data),
  exists: (path) => getBackend().fs.exists(path),
  listDir: (path) => getBackend().fs.listDir(path),
  mkdirAll: (path) => getBackend().fs.mkdirAll(path),
  removeFile: (path) => getBackend().fs.removeFile(path),
};

export const db: DbBackend = {
  open: (path) => getBackend().db.open(path),
  flush: () => getBackend().db.flush(),
  close: () => getBackend().db.close(),
  execute: (sql, params = []) => getBackend().db.execute(sql, params),
  query: <T extends Row = Row>(sql: string, params: SqlParam[] = []) => getBackend().db.query<T>(sql, params),
};

export const secret: SecretBackend = {
  get: (key) => getBackend().secret.get(key),
  set: (key, value) => getBackend().secret.set(key, value),
  delete: (key) => getBackend().secret.delete(key),
};

export const notifier: NotifierBackend = {
  isPermissionGranted: () => getBackend().notifier.isPermissionGranted(),
  requestPermission: () => getBackend().notifier.requestPermission(),
  send: (title, body) => getBackend().notifier.send(title, body),
};

export const opener: OpenerBackend = {
  url: (url) => getBackend().opener.url(url),
  path: (path) => getBackend().opener.path(path),
};

export const pdf: PdfBackend = {
  download: (url, dest) => getBackend().pdf.download(url, dest),
  extractText: (path) => getBackend().pdf.extractText(path),
};

/** arXiv の手元の索引。この実装に無ければ null */
export function arxivIndexBackend(): ArxivIndexBackend | null {
  return getBackend().arxivIndex ?? null;
}

export function saveFile(fileName: string, data: Uint8Array): Promise<string> {
  return getBackend().saveFile(fileName, data);
}

/** 学術 API と LLM に渡す fetch。バックエンドが決まってから解決される */
export const appFetch: typeof globalThis.fetch = (input, init) => getBackend().fetch(input, init);

export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .join("/");
}
