// コース(仕様 8.1)。無限のキューではなく「このテーマの入門 N 本」。終わりと進捗が見えるようにする。
// コースは papers.json の各論文の course 列だけで表す(別ファイルを持たない)。純粋関数

import type { CourseStage, Paper } from "@/core/types";

export const STAGE_LABELS: Record<CourseStage, string> = { survey: "全体像", classic: "基礎", recent: "最近" };

const SURVEY_RE = /\b(survey|review|overview|tutorial|primer|introduction to)\b|サーベイ|レビュー|総説|解説|展望|入門/i;

export interface CourseCandidate {
  id: string;
  title: string;
  year?: number | null;
}

export function stageOf(c: CourseCandidate, nowYear: number): CourseStage {
  if (SURVEY_RE.test(c.title)) return "survey";
  return c.year != null && c.year >= nowYear - 2 ? "recent" : "classic";
}

/**
 * 順位の付いた候補から、全体像 → 基礎 → 最近 の順に size 本を選ぶ。LLM が無くても組めるようにするためのもの。
 * 全体像は 2 本まで、残りの半分を基礎(古い順)、あとは最近。足りない段階の枠は順位の高い残りで埋める
 */
export function buildCourse<T extends CourseCandidate>(ranked: T[], size: number, nowYear: number): (T & { stage: CourseStage })[] {
  const staged = ranked.map((c) => ({ ...c, stage: stageOf(c, nowYear) }));
  const take = (stage: CourseStage, n: number) => staged.filter((c) => c.stage === stage).slice(0, Math.max(0, n));
  const surveys = take("survey", Math.min(2, size));
  const classics = take("classic", Math.ceil((size - surveys.length) / 2));
  const recents = take("recent", size - surveys.length - classics.length);
  const picked = new Set([...surveys, ...classics, ...recents].map((c) => c.id));
  const fill = staged.filter((c) => !picked.has(c.id)).slice(0, size - picked.size);
  const all = [...surveys, ...classics, ...recents, ...fill];
  const order: CourseStage[] = ["survey", "classic", "recent"];
  return order.flatMap((stage) => {
    const xs = all.filter((c) => c.stage === stage);
    // 基礎は古いものから。積み上がった順に読むほうが分かりやすい
    return stage === "classic" ? [...xs].sort((a, b) => (a.year ?? 0) - (b.year ?? 0)) : xs;
  });
}

export interface CourseProgress {
  id: string;
  title: string;
  total: number;
  read: number;
  /** 次に読む 1 本。読み終えていれば null */
  next: Paper | null;
}

export function courseProgress(papers: Paper[]): CourseProgress[] {
  const byId = new Map<string, Paper[]>();
  for (const p of papers) {
    if (!p.course || p.status === "removed") continue;
    byId.set(p.course.id, [...(byId.get(p.course.id) ?? []), p]);
  }
  return [...byId.entries()].map(([id, ps]) => {
    const sorted = [...ps].sort((a, b) => a.course!.step - b.course!.step);
    return { id, title: sorted[0].course!.title, total: sorted.length, read: sorted.filter((p) => p.status === "read").length, next: sorted.find((p) => p.status === "unread") ?? null };
  });
}
