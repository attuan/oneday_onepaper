// データのエクスポート/インポート。
//
// ZIP の中身はデータフォルダ(仕様 4.1)と同じ並びにする:
//   OneDayOnePaper/papers.json, settings.json, state.sqlite, memos/*.md, pdfs/*.pdf
// だからデスクトップ版のフォルダを手で圧縮したものもそのまま取り込めるし、
// ブラウザ版から書き出したものを解凍すればデスクトップ版のフォルダになる。
// API キーは含めない。

import { unzipSync, zipSync, type Zippable } from "fflate";
import { db, fs, joinPath } from "@/core/store/backend";

export const ARCHIVE_ROOT = "OneDayOnePaper";
const MAX_ENTRY_BYTES = 200 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
/** SQLite ファイルの先頭 16 バイトは "SQLite format 3" と NUL */
const SQLITE_MAGIC = "SQLite format 3";
const EMPTY_PAPERS = '{\n  "version": 1,\n  "papers": []\n}';

export type EntryKind = "papers" | "settings" | "db" | "memo" | "pdf";

const TOP_FILES = new Map<string, EntryKind>([
  ["papers.json", "papers"],
  ["settings.json", "settings"],
  ["state.sqlite", "db"],
]);

// ---- 分類(純粋) ----

/** ファイル名 1 つとして安全か。区切り・親参照・制御文字・隠しファイルを弾く */
function safeName(name: string): boolean {
  if (!name || name.length > 255 || name.startsWith(".")) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return ![...name].some((c) => c.charCodeAt(0) < 0x20);
}

/** データフォルダ内の相対パスを分類する。受け付けないものは null */
export function classify(rel: string): EntryKind | null {
  const top = TOP_FILES.get(rel);
  if (top) return top;
  const m = /^(memos|pdfs)\/([^/]+)$/.exec(rel);
  if (!m || !safeName(m[2])) return null;
  if (m[1] === "memos" && m[2].endsWith(".md")) return "memo";
  if (m[1] === "pdfs" && m[2].endsWith(".pdf")) return "pdf";
  return null;
}

/** ディレクトリ項目と、macOS の圧縮が混ぜるもの */
function isJunk(name: string): boolean {
  return name.endsWith("/") || name.startsWith("__MACOSX/") || name.split("/").includes(".DS_Store");
}

/** 全項目が同じフォルダの下にあれば、その 1 段を返す(OneDayOnePaper/ など) */
export function commonRoot(names: string[]): string {
  const firsts = new Set(names.map((n) => (n.includes("/") ? n.slice(0, n.indexOf("/") + 1) : "")));
  if (firsts.size !== 1) return "";
  const [only] = firsts;
  // memos/ だけの ZIP を「memos フォルダの圧縮」と取り違えない
  if (only === "memos/" || only === "pdfs/") return "";
  return only;
}

export interface PlannedEntry {
  name: string;
  rel: string;
  kind: EntryKind;
  size: number;
}

export interface ImportPlan {
  entries: PlannedEntry[];
  /** 取り込まなかった項目(ZIP 内の名前) */
  skipped: string[];
  warnings: string[];
}

export function planImport(listing: { name: string; size: number }[]): ImportPlan {
  const real = listing.filter((f) => !isJunk(f.name));
  const root = commonRoot(real.map((f) => f.name));
  const entries: PlannedEntry[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  for (const f of real) {
    const rel = f.name.slice(root.length);
    if (rel === "state.sqlite-wal" || rel === "state.sqlite-shm") {
      if (rel === "state.sqlite-wal" && f.size > 0) {
        warnings.push(
          "state.sqlite-wal が入っています。デスクトップ版を起動したまま圧縮したようで、state.sqlite に最近の記録(AI の要約・採点、使用量)が入っていない可能性があります。デスクトップ版の「書き出す」を使うか、アプリを終了してから圧縮し直してください",
        );
      }
      continue;
    }
    const kind = classify(rel);
    if (kind) entries.push({ name: f.name, rel, kind, size: f.size });
    else skipped.push(f.name);
  }
  return { entries, skipped, warnings };
}

/** papers.json の件数。形式が違えば投げる */
export function countPapers(bytes: Uint8Array): number {
  let j: unknown;
  try {
    j = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("papers.json が JSON として読めません");
  }
  const papers = (j as { papers?: unknown } | null)?.papers;
  if (!Array.isArray(papers)) throw new Error("papers.json の形式が正しくありません(papers 配列がありません)");
  return papers.length;
}

function isSettingsJson(bytes: Uint8Array): boolean {
  try {
    const j = JSON.parse(new TextDecoder().decode(bytes));
    return typeof j === "object" && j !== null && !Array.isArray(j);
  } catch {
    return false;
  }
}

export function isSqlite(bytes: Uint8Array): boolean {
  return bytes.length >= 16 && new TextDecoder().decode(bytes.subarray(0, 15)) === SQLITE_MAGIC && bytes[15] === 0;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d: Date) => `${ymd(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// ---- エクスポート ----

export interface ExportResult {
  fileName: string;
  data: Uint8Array;
  counts: { papers: boolean; memos: number; pdfs: number; db: boolean; settings: boolean };
}

async function listByExt(dir: string, ext: string): Promise<string[]> {
  return (await fs.listDir(dir)).filter((n) => n.endsWith(ext) && safeName(n));
}

export async function exportArchive(dataDir: string, opts: { includePdfs: boolean }, now = new Date()): Promise<ExportResult> {
  await db.flush(); // WAL / メモリ上の変更を state.sqlite に反映してから読む
  const files: Zippable = {};
  const add = (rel: string, data: Uint8Array, stored = false) => {
    files[`${ARCHIVE_ROOT}/${rel}`] = [data, { level: stored ? 0 : 6 }];
  };

  // papers.json は取り込みの必須項目なので、無くても空で入れておく
  const papers = await fs.readBinary(joinPath(dataDir, "papers.json"));
  add("papers.json", papers ?? new TextEncoder().encode(EMPTY_PAPERS));

  const settings = await fs.readBinary(joinPath(dataDir, "settings.json"));
  if (settings) add("settings.json", settings);
  const sqlite = await fs.readBinary(joinPath(dataDir, "state.sqlite"));
  if (sqlite) add("state.sqlite", sqlite);

  const memos = await listByExt(joinPath(dataDir, "memos"), ".md");
  for (const n of memos) {
    const b = await fs.readBinary(joinPath(dataDir, "memos", n));
    if (b) add(`memos/${n}`, b);
  }

  let pdfCount = 0;
  if (opts.includePdfs) {
    for (const n of await listByExt(joinPath(dataDir, "pdfs"), ".pdf")) {
      const b = await fs.readBinary(joinPath(dataDir, "pdfs", n));
      if (!b) continue;
      add(`pdfs/${n}`, b, true); // PDF は圧縮済みなので無圧縮で入れる
      pdfCount++;
    }
  }

  return {
    fileName: `${ARCHIVE_ROOT}-${ymd(now)}.zip`,
    data: zipSync(files),
    counts: { papers: !!papers, memos: memos.length, pdfs: pdfCount, db: !!sqlite, settings: !!settings },
  };
}

// ---- インポート ----

export interface ImportReport {
  papers: number;
  memos: number;
  pdfs: number;
  db: boolean;
  settings: boolean;
  skipped: string[];
  warnings: string[];
  /** 取り込む前のデータを書き出した場所(データフォルダ内) */
  backupPath: string;
}

/** DB を閉じた後に失敗した。データが半端なので、退避先を案内して読み込み直させる */
export class PartialImportError extends Error {
  constructor(
    message: string,
    readonly backupPath: string,
  ) {
    super(message);
    this.name = "PartialImportError";
  }
}

async function removeIfExists(path: string): Promise<void> {
  if (await fs.exists(path)) await fs.removeFile(path);
}

/**
 * 現在のデータを ZIP の中身で置き換える。
 * - memos/ は置き換える。papers.json は必須
 * - state.sqlite は ZIP に無ければ消す(メモから作り直される)
 * - settings.json と pdfs/ は ZIP に入っているときだけ置き換える
 * 書き換える前に、今のデータを backups/ に書き出しておく。
 * 呼んだ後は DB が閉じているので、画面を読み込み直すこと。
 */
export async function importArchive(dataDir: string, zip: Uint8Array, now = new Date()): Promise<ImportReport> {
  // 1. 読んで確かめる。ここまでは何も書き換えない
  const listing: { name: string; size: number }[] = [];
  try {
    unzipSync(zip, {
      filter: (f) => {
        listing.push({ name: f.name, size: f.originalSize });
        return false;
      },
    });
  } catch {
    throw new Error("ZIP ファイルとして読めませんでした");
  }
  const plan = planImport(listing);
  const big = plan.entries.find((e) => e.size > MAX_ENTRY_BYTES);
  if (big) throw new Error(`大きすぎるファイルが入っています: ${big.name}`);
  if (plan.entries.reduce((s, e) => s + e.size, 0) > MAX_TOTAL_BYTES) throw new Error("ZIP の中身が大きすぎます(1 GB まで)");

  const papersEntry = plan.entries.find((e) => e.kind === "papers");
  if (!papersEntry) throw new Error("papers.json が入っていません。One day, One paper のデータではないようです");

  const wanted = new Set(plan.entries.map((e) => e.name));
  const data = unzipSync(zip, { filter: (f) => wanted.has(f.name) });
  const paperCount = countPapers(data[papersEntry.name]);

  const warnings = [...plan.warnings];
  const entries = plan.entries.filter((e) => {
    if (e.kind === "settings" && !isSettingsJson(data[e.name])) {
      warnings.push("settings.json が壊れていたので、今の設定を残しました");
      return false;
    }
    if (e.kind === "db" && !isSqlite(data[e.name])) {
      warnings.push("state.sqlite が SQLite のファイルではなかったので取り込みませんでした。記録はメモから作り直されます");
      return false;
    }
    return true;
  });
  const has = (k: EntryKind) => entries.some((e) => e.kind === k);

  // 2. 今のデータを退避する
  const backup = await exportArchive(dataDir, { includePdfs: false }, now);
  const backupPath = joinPath(dataDir, "backups", `before-import-${stamp(now)}.zip`);
  await fs.writeBinary(backupPath, backup.data);

  // 3. 置き換える。DB を閉じてから state.sqlite に触る
  try {
    await db.close();
    // WAL が残っていると、新しい state.sqlite に古い WAL が当てられて壊れる
    for (const f of ["state.sqlite", "state.sqlite-wal", "state.sqlite-shm"]) {
      await removeIfExists(joinPath(dataDir, f));
    }
    const memosDir = joinPath(dataDir, "memos");
    for (const n of await listByExt(memosDir, ".md")) await fs.removeFile(joinPath(memosDir, n));
    if (has("pdf")) {
      const pdfsDir = joinPath(dataDir, "pdfs");
      for (const n of await listByExt(pdfsDir, ".pdf")) await fs.removeFile(joinPath(pdfsDir, n));
    }
    await fs.mkdirAll(memosDir);
    for (const e of entries) await fs.writeBinary(joinPath(dataDir, e.rel), data[e.name]);
  } catch (e) {
    throw new PartialImportError(
      `取り込みの途中で失敗しました: ${e instanceof Error ? e.message : e}。取り込む前のデータは ${backupPath} にあるので、読み込み直してからこれを取り込んでください`,
      backupPath,
    );
  }

  return {
    papers: paperCount,
    memos: entries.filter((e) => e.kind === "memo").length,
    pdfs: entries.filter((e) => e.kind === "pdf").length,
    db: has("db"),
    settings: has("settings"),
    skipped: plan.skipped,
    warnings,
    backupPath,
  };
}
