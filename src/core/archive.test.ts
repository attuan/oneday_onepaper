import { beforeEach, describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { setBackend } from "@/core/store/backend";
import { memoryBackend, textOf, type MemoryBackend } from "@/core/store/backends/memory";
import { classify, commonRoot, exportArchive, importArchive, isSqlite, PartialImportError, planImport } from "./archive";

const DIR = "/data";
const NOW = new Date(2026, 8, 16, 18, 5, 9);
const sqlite = (tag: number) => new Uint8Array([...strToU8("SQLite format 3"), 0, tag, tag, tag]);
const papersJson = (n: number) => JSON.stringify({ version: 1, papers: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })) });

function seed(b: MemoryBackend, tag: string) {
  const put = (rel: string, data: Uint8Array | string) => b.files.set(`${DIR}/${rel}`, typeof data === "string" ? strToU8(data) : data);
  put("papers.json", papersJson(2));
  put("settings.json", JSON.stringify({ tag }));
  put("state.sqlite", sqlite(1));
  put(`memos/2026-09-01_${tag}.md`, `# ${tag} 1`);
  put(`memos/2026-09-02_${tag}.md`, `# ${tag} 2`);
  put(`pdfs/${tag}.pdf`, `%PDF-${tag}`);
  put("backups/old.zip", "old");
}

function zipOf(entries: Record<string, Uint8Array | string>): Uint8Array {
  const z: Zippable = {};
  for (const [k, v] of Object.entries(entries)) z[k] = typeof v === "string" ? strToU8(v) : v;
  return zipSync(z);
}

const namesIn = (zip: Uint8Array) => Object.keys(unzipSync(zip)).sort();
const snapshot = (b: MemoryBackend) => new Map([...b.files].map(([k, v]) => [k, [...v].join(",")]));

let b: MemoryBackend;
beforeEach(() => {
  b = memoryBackend();
  setBackend(b);
});

describe("classify", () => {
  it("データフォルダの既知のファイルだけを受け付ける", () => {
    expect(classify("papers.json")).toBe("papers");
    expect(classify("settings.json")).toBe("settings");
    expect(classify("state.sqlite")).toBe("db");
    expect(classify("memos/2026-09-01_x.md")).toBe("memo");
    expect(classify("pdfs/x.pdf")).toBe("pdf");
  });
  it("親参照・入れ子・隠しファイル・拡張子違い・プロトタイプのキーを弾く", () => {
    for (const rel of ["../papers.json", "memos/../papers.json", "memos/sub/x.md", "memos/.x.md", "memos/..", "memos/x.txt", "pdfs/x.md", "memos\\x.md", "constructor", "notes.txt", "state.sqlite-wal"]) {
      expect(classify(rel), rel).toBeNull();
    }
  });
});

describe("planImport", () => {
  it("共通の先頭フォルダを剥がし、ゴミを無視する", () => {
    const p = planImport([
      { name: "Backup/", size: 0 },
      { name: "Backup/papers.json", size: 10 },
      { name: "Backup/memos/a.md", size: 1 },
      { name: "Backup/.DS_Store", size: 1 },
      { name: "__MACOSX/Backup/._papers.json", size: 1 },
    ]);
    expect(p.entries.map((e) => [e.rel, e.kind])).toEqual([["papers.json", "papers"], ["memos/a.md", "memo"]]);
    expect(p.skipped).toEqual([]);
  });
  it("フォルダに入っていない ZIP もそのまま読む。memos/ だけの ZIP を剥がさない", () => {
    expect(commonRoot(["papers.json", "memos/a.md"])).toBe("");
    expect(commonRoot(["memos/a.md", "memos/b.md"])).toBe("");
  });
  it("空でない WAL にだけ警告を出す", () => {
    expect(planImport([{ name: "papers.json", size: 1 }, { name: "state.sqlite-wal", size: 0 }]).warnings).toEqual([]);
    expect(planImport([{ name: "papers.json", size: 1 }, { name: "state.sqlite-wal", size: 9 }]).warnings).toHaveLength(1);
  });
});

describe("isSqlite", () => {
  it("先頭 16 バイトで判定する", () => {
    expect(isSqlite(sqlite(0))).toBe(true);
    expect(isSqlite(strToU8("SQLite format 3!xxxx"))).toBe(false);
    expect(isSqlite(strToU8("{}"))).toBe(false);
  });
});

describe("exportArchive", () => {
  it("フォルダと同じ並びで入れる。PDF と backups/ は既定で入れない。先に flush する", async () => {
    seed(b, "a");
    const r = await exportArchive(DIR, { includePdfs: false }, NOW);
    expect(r.fileName).toBe("OneDayOnePaper-2026-09-16.zip");
    expect(namesIn(r.data)).toEqual([
      "OneDayOnePaper/memos/2026-09-01_a.md",
      "OneDayOnePaper/memos/2026-09-02_a.md",
      "OneDayOnePaper/papers.json",
      "OneDayOnePaper/settings.json",
      "OneDayOnePaper/state.sqlite",
    ]);
    expect(r.counts).toEqual({ papers: true, memos: 2, pdfs: 0, db: true, settings: true });
    expect(b.log[0]).toBe("db.flush");
  });
  it("includePdfs で PDF も入れる", async () => {
    seed(b, "a");
    const r = await exportArchive(DIR, { includePdfs: true }, NOW);
    expect(namesIn(r.data)).toContain("OneDayOnePaper/pdfs/a.pdf");
    expect(r.counts.pdfs).toBe(1);
  });
  it("まっさらでも papers.json は入れる(取り込みの必須項目なので)", async () => {
    const r = await exportArchive(DIR, { includePdfs: false }, NOW);
    const files = unzipSync(r.data);
    expect(Object.keys(files)).toEqual(["OneDayOnePaper/papers.json"]);
    expect(JSON.parse(new TextDecoder().decode(files["OneDayOnePaper/papers.json"]))).toEqual({ version: 1, papers: [] });
  });
});

describe("importArchive", () => {
  it("書き出したものを別の環境に取り込むと、同じ中身になる", async () => {
    seed(b, "a");
    const { data } = await exportArchive(DIR, { includePdfs: true }, NOW);
    const want = snapshot(b);

    const other = memoryBackend();
    setBackend(other);
    const r = await importArchive(DIR, data, NOW);
    expect(r).toMatchObject({ papers: 2, memos: 2, pdfs: 1, db: true, settings: true, skipped: [], warnings: [] });
    for (const [k, v] of want) {
      if (k.startsWith(`${DIR}/backups/`)) continue;
      expect(snapshot(other).get(k), k).toEqual(v);
    }
  });

  it("memos は置き換え、PDF と設定は ZIP に無ければ残し、state.sqlite は ZIP に無ければ消す", async () => {
    seed(b, "old");
    b.files.set(`${DIR}/state.sqlite-wal`, strToU8("wal"));
    const zip = zipOf({ "OneDayOnePaper/papers.json": papersJson(5), "OneDayOnePaper/memos/2026-09-10_new.md": "# new" });
    const r = await importArchive(DIR, zip, NOW);

    expect(r).toMatchObject({ papers: 5, memos: 1, pdfs: 0, db: false, settings: false });
    expect(await b.fs.listDir(`${DIR}/memos`)).toEqual(["2026-09-10_new.md"]);
    expect(textOf(b, `${DIR}/pdfs/old.pdf`)).toBe("%PDF-old");
    expect(textOf(b, `${DIR}/settings.json`)).toBe(JSON.stringify({ tag: "old" }));
    expect(b.files.has(`${DIR}/state.sqlite`)).toBe(false);
    expect(b.files.has(`${DIR}/state.sqlite-wal`)).toBe(false);
    expect(JSON.parse(textOf(b, `${DIR}/papers.json`)!).papers).toHaveLength(5);
  });

  it("書き換える前に今のデータを backups/ に退避し、DB を閉じてから state.sqlite を書く", async () => {
    seed(b, "old");
    const zip = zipOf({ "papers.json": papersJson(1), "state.sqlite": sqlite(9) });
    const r = await importArchive(DIR, zip, NOW);

    expect(r.backupPath).toBe(`${DIR}/backups/before-import-2026-09-16_180509.zip`);
    const backup = unzipSync(b.files.get(r.backupPath)!);
    expect(new TextDecoder().decode(backup["OneDayOnePaper/memos/2026-09-01_old.md"])).toBe("# old 1");
    expect(backup["OneDayOnePaper/state.sqlite"]).toEqual(sqlite(1));

    const i = (s: string) => b.log.indexOf(s);
    expect(i(`write ${r.backupPath}`)).toBeLessThan(i("db.close"));
    expect(i("db.close")).toBeLessThan(i(`remove ${DIR}/state.sqlite`));
    expect(i(`remove ${DIR}/state.sqlite`)).toBeLessThan(i(`write ${DIR}/state.sqlite`));
    expect(b.files.get(`${DIR}/state.sqlite`)).toEqual(sqlite(9));
  });

  it("危ない名前は書かずに skipped に回す", async () => {
    seed(b, "old");
    const zip = zipOf({
      "OneDayOnePaper/papers.json": papersJson(1),
      "OneDayOnePaper/../evil.md": "x",
      "OneDayOnePaper/memos/../../evil2.md": "x",
      "OneDayOnePaper/memos/sub/y.md": "x",
      "OneDayOnePaper/memos/.hidden.md": "x",
      "OneDayOnePaper/notes.txt": "x",
    });
    const r = await importArchive(DIR, zip, NOW);
    expect(r.skipped.sort()).toEqual([
      "OneDayOnePaper/../evil.md",
      "OneDayOnePaper/memos/../../evil2.md",
      "OneDayOnePaper/memos/.hidden.md",
      "OneDayOnePaper/memos/sub/y.md",
      "OneDayOnePaper/notes.txt",
    ]);
    const written = [...b.files.keys()].filter((k) => k.includes("evil") || k.includes("hidden") || k.includes("notes") || k.includes("/sub/"));
    expect(written).toEqual([]);
  });

  it("壊れた settings.json と SQLite でないファイルは取り込まず、警告にする", async () => {
    seed(b, "old");
    const zip = zipOf({ "papers.json": papersJson(1), "settings.json": "{broken", "state.sqlite": "not sqlite" });
    const r = await importArchive(DIR, zip, NOW);
    expect(r.settings).toBe(false);
    expect(r.db).toBe(false);
    expect(r.warnings).toHaveLength(2);
    expect(textOf(b, `${DIR}/settings.json`)).toBe(JSON.stringify({ tag: "old" }));
    expect(b.files.has(`${DIR}/state.sqlite`)).toBe(false);
  });

  it("DB を閉じた後に失敗したら、退避先を持った PartialImportError にする", async () => {
    seed(b, "old");
    const writeBinary = b.fs.writeBinary;
    (b.fs as { writeBinary: typeof writeBinary }).writeBinary = async (path, data) => {
      if (path.endsWith("papers.json")) throw new Error("disk full");
      return writeBinary(path, data);
    };
    const err = await importArchive(DIR, zipOf({ "papers.json": papersJson(1) }), NOW).catch((e) => e);
    expect(err).toBeInstanceOf(PartialImportError);
    expect(err.message).toMatch(/disk full/);
    expect(err.backupPath).toBe(`${DIR}/backups/before-import-2026-09-16_180509.zip`);
    expect(b.files.has(err.backupPath)).toBe(true);
  });

  describe("取り込めないときは何も変えない", () => {
    const cases: [string, Uint8Array, RegExp][] = [
      ["ZIP でない", strToU8("hello"), /ZIP ファイルとして読めません/],
      ["papers.json が無い", zipOf({ "memos/a.md": "x" }), /papers\.json が入っていません/],
      ["papers.json が JSON でない", zipOf({ "papers.json": "{" }), /JSON として読めません/],
      ["papers 配列が無い", zipOf({ "papers.json": "{}" }), /papers 配列がありません/],
      ["絶対パスが混ざって先頭フォルダが揃わない", zipOf({ "OneDayOnePaper/papers.json": papersJson(1), "/abs.md": "x" }), /papers\.json が入っていません/],
    ];
    for (const [label, zip, err] of cases) {
      it(label, async () => {
        seed(b, "old");
        const before = snapshot(b);
        await expect(importArchive(DIR, zip, NOW)).rejects.toThrow(err);
        expect(snapshot(b)).toEqual(before);
        expect(b.log).not.toContain("db.close");
      });
    }
  });
});
