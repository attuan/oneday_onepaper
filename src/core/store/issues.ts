import { emptyIssues, normalizeIssues, type IssuesFile } from "@/core/issues/model";
import { fs, joinPath } from "./backend";

// 論点の台帳(仕様 7.6)。issues.json 1 ファイル。自分で育てる中身なので state.sqlite ではなくファイルに置く

export function issuesPath(dataDir: string): string {
  return joinPath(dataDir, "issues.json");
}

export async function loadIssues(dataDir: string): Promise<IssuesFile> {
  const p = issuesPath(dataDir);
  if (!(await fs.exists(p))) return emptyIssues();
  try {
    return normalizeIssues(JSON.parse(await fs.readText(p)));
  } catch {
    // 壊れていても上書きで消さないよう、読めないときは投げる
    throw new Error("issues.json が JSON として読めません。データフォルダのファイルを確かめてください");
  }
}

export async function saveIssues(dataDir: string, file: IssuesFile): Promise<void> {
  await fs.writeText(issuesPath(dataDir), JSON.stringify(file, null, 2));
}
