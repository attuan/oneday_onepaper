// ショートカットに出かけている間はページが閉じることがあるので、「どの論文の、どの入力で頼んだか」を残しておく。
// この端末だけの一時的な印なので localStorage でよい。使えない環境では何もしない

import type { PaperContext } from "@/core/llm/tasks";

const KEY = "ai_handoff_pending";

export interface HandoffPending {
  paperId: string;
  inputKind: PaperContext["inputKind"];
}

export function loadPending(paperId: string): HandoffPending | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as HandoffPending | null;
    return p && p.paperId === paperId ? p : null;
  } catch {
    return null;
  }
}

export function savePending(p: HandoffPending): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 残せなくても、貼り付けはできる */
  }
}

export function clearPending(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
}
