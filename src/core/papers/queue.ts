// キュー操作(仕様 5.3)。純粋関数。papers 配列を受け取り新しい配列を返す

import type { Paper } from "@/core/types";

export function queue(papers: Paper[]): Paper[] {
  return papers.filter((p) => p.status === "unread").sort((a, b) => a.queue_order - b.queue_order);
}

export function todaysPaper(papers: Paper[]): Paper | null {
  return queue(papers)[0] ?? null;
}

/** 今日の論文を末尾に回す */
export function skipPaper(papers: Paper[], id: string): Paper[] {
  const q = queue(papers);
  const maxOrder = q.length ? Math.max(...q.map((p) => p.queue_order)) : 0;
  return papers.map((p) =>
    p.id === id ? { ...p, queue_order: maxOrder + 1, skip_count: p.skip_count + 1 } : p,
  );
}

/** id の並びで queue_order を振り直す。渡されなかった unread は末尾に元の順で残す */
export function reorderQueue(papers: Paper[], orderedIds: string[]): Paper[] {
  const q = queue(papers);
  const known = new Set(orderedIds);
  const rest = q.filter((p) => !known.has(p.id)).map((p) => p.id);
  const order = new Map<string, number>();
  [...orderedIds, ...rest].forEach((id, i) => order.set(id, i + 1));
  return papers.map((p) => (order.has(p.id) ? { ...p, queue_order: order.get(p.id)! } : p));
}

export function nextQueueOrder(papers: Paper[]): number {
  const q = queue(papers);
  return q.length ? Math.max(...q.map((p) => p.queue_order)) + 1 : 1;
}

export function markRead(papers: Paper[], id: string, readAt: string): Paper[] {
  return papers.map((p) => (p.id === id ? { ...p, status: "read", read_at: readAt } : p));
}

export function removePaper(papers: Paper[], id: string): Paper[] {
  return papers.map((p) => (p.id === id ? { ...p, status: "removed" } : p));
}

/** DOI を正規化して id にする。なければ local:<random> */
export function makePaperId(doi: string | null): string {
  if (doi) return normalizeDoi(doi);
  return `local:${randomId()}`;
}

export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase();
}

function randomId(): string {
  const chars = "0123456789abcdefghjkmnpqrstvwxyz";
  let s = "";
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function newPaper(input: Partial<Paper> & { title: string }, papers: Paper[], now: string): Paper {
  return {
    id: input.id ?? makePaperId(input.doi ?? null),
    title: input.title,
    authors: input.authors ?? [],
    year: input.year ?? null,
    venue: input.venue ?? null,
    doi: input.doi ? normalizeDoi(input.doi) : null,
    url: input.url ?? null,
    pdf_url: input.pdf_url ?? null,
    abstract: input.abstract ?? null,
    reason: input.reason ?? null,
    source: input.source ?? "manual",
    status: "unread",
    queue_order: nextQueueOrder(papers),
    added_at: now,
    read_at: null,
    skip_count: 0,
    bibtex: input.bibtex ?? null,
    fulltext_tokens: null,
  };
}
