// 記録を資産にする(仕様 9.1)。ヒートマップ・読み返し・月のまとめ。どれも memos と papers から作る純粋関数

import type { Memo, Paper, ReadLevel } from "@/core/types";
import { addDays, parseDate } from "@/core/schedule/logicalDay";
import { firstMemoLine } from "@/core/share";

export interface HeatCell {
  date: string;
  /** その日に届いた一番上の段階。読んでいなければ 0 */
  level: ReadLevel;
  future: boolean;
}

/** 日曜始まりの週を古い順に weeks 個。最後の週が today を含む */
export function heatmap(memos: Memo[], today: string, weeks: number): HeatCell[][] {
  const best = new Map<string, ReadLevel>();
  for (const m of memos) {
    if (!m.frontmatter.completed) continue;
    best.set(m.frontmatter.date, Math.max(best.get(m.frontmatter.date) ?? 0, m.frontmatter.level) as ReadLevel);
  }
  const start = addDays(today, -parseDate(today).getDay() - 7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      return { date, level: best.get(date) ?? 0, future: date > today };
    }),
  );
}

export interface ReviewItem {
  paper: Paper;
  memo: Memo;
  /** 何日前に読んだか */
  daysAgo: number;
  /** そのとき自分が書いた最初の 1 行 */
  oneLiner: string;
}

/** 読み返しの間隔(日)。毎日は開かない人のために、それぞれ 3 日の幅を持たせる */
export const REVIEW_AFTER = [7, 30];
const REVIEW_WINDOW = 3;

export function reviewKey(paperId: string, after: number): string {
  return `reviewed:${after}:${paperId}`;
}

/** 1 週間前・1 か月前に読んだもの。done は済ませた(reviewKey の)集合 */
export function reviewsDue(papers: Paper[], memos: Memo[], today: string, done: Set<string>): (ReviewItem & { after: number })[] {
  const out: (ReviewItem & { after: number })[] = [];
  for (const memo of memos) {
    if (!memo.frontmatter.completed) continue;
    const paper = papers.find((p) => p.id === memo.frontmatter.paper_id && p.status !== "removed");
    if (!paper) continue;
    const daysAgo = Math.round((parseDate(today).getTime() - parseDate(memo.frontmatter.date).getTime()) / 86_400_000);
    const after = REVIEW_AFTER.find((a) => daysAgo >= a && daysAgo < a + REVIEW_WINDOW);
    if (after === undefined || done.has(reviewKey(paper.id, after))) continue;
    out.push({ paper, memo, daysAgo, after, oneLiner: firstMemoLine(memo.body) });
  }
  return out.sort((a, b) => a.daysAgo - b.daysAgo);
}
