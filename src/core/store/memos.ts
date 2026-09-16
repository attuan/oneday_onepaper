import type { Memo, MemoFrontmatter } from "@/core/types";
import { memoFileName, parseMemo, serializeMemo } from "@/core/memo/format";
import { fs, joinPath } from "./backend";

export function memosDir(dataDir: string): string {
  return joinPath(dataDir, "memos");
}

export async function listMemos(dataDir: string): Promise<Memo[]> {
  const dir = memosDir(dataDir);
  const names = (await fs.listDir(dir)).filter((n) => n.endsWith(".md"));
  const memos: Memo[] = [];
  for (const name of names) {
    const path = joinPath(dir, name);
    try {
      const m = parseMemo(path, await fs.readText(path));
      if (m) memos.push(m);
    } catch {
      /* 壊れたファイルは無視 */
    }
  }
  return memos;
}

export async function findMemoForPaper(dataDir: string, paperId: string): Promise<Memo | null> {
  const memos = await listMemos(dataDir);
  const hits = memos.filter((m) => m.frontmatter.paper_id === paperId).sort((a, b) => (a.frontmatter.date < b.frontmatter.date ? 1 : -1));
  return hits[0] ?? null;
}

export async function saveMemo(dataDir: string, fm: MemoFrontmatter, body: string, existingPath?: string): Promise<Memo> {
  const path = existingPath ?? joinPath(memosDir(dataDir), memoFileName(fm.date, fm.paper_id));
  await fs.writeText(path, serializeMemo(fm, body));
  return { path, frontmatter: fm, body };
}

/** 読了済みメモを日付ごとにまとめる(判定の入力) */
export function readsByDate(memos: Memo[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of memos) {
    if (!m.frontmatter.completed) continue;
    (out[m.frontmatter.date] ??= []).push(m.frontmatter.paper_id);
  }
  return out;
}
