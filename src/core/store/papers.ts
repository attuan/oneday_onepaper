import type { Paper, PapersFile } from "@/core/types";
import { fs, joinPath } from "./backend";

export function papersPath(dataDir: string): string {
  return joinPath(dataDir, "papers.json");
}

export async function loadPapers(dataDir: string): Promise<Paper[]> {
  const p = papersPath(dataDir);
  if (!(await fs.exists(p))) return [];
  const j = JSON.parse(await fs.readText(p)) as PapersFile;
  return j.papers ?? [];
}

export async function savePapers(dataDir: string, papers: Paper[]): Promise<void> {
  const file: PapersFile = { version: 1, papers };
  await fs.writeText(papersPath(dataDir), JSON.stringify(file, null, 2));
}
