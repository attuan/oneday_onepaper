import type { Proposal } from "@/core/types";
import { normalizeProposal } from "@/core/proposal/model";
import { fs, joinPath } from "./backend";

// 研究計画書(仕様 13)。1 本 1 ファイル: proposals/<id>.json

export function proposalsDir(dataDir: string): string {
  return joinPath(dataDir, "proposals");
}

function proposalPath(dataDir: string, id: string): string {
  return joinPath(proposalsDir(dataDir), `${id.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`);
}

/** 新しく書き直したものから */
export async function listProposals(dataDir: string): Promise<Proposal[]> {
  const dir = proposalsDir(dataDir);
  const out: Proposal[] = [];
  for (const name of (await fs.listDir(dir)).filter((n) => n.endsWith(".json"))) {
    try {
      const raw = JSON.parse(await fs.readText(joinPath(dir, name))) as Proposal;
      if (raw && typeof raw.id === "string") out.push(normalizeProposal(raw));
    } catch {
      /* 壊れたファイルは無視 */
    }
  }
  return out.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export async function saveProposal(dataDir: string, p: Proposal): Promise<void> {
  await fs.mkdirAll(proposalsDir(dataDir));
  await fs.writeText(proposalPath(dataDir, p.id), JSON.stringify(p, null, 2));
}

export async function deleteProposal(dataDir: string, id: string): Promise<void> {
  const path = proposalPath(dataDir, id);
  if (await fs.exists(path)) await fs.removeFile(path);
}
