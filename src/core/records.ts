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

// ---- 月のまとめ ----

/** テンプレートのうち書かなかった見出しと、先頭のタイトル行を落とす */
export function compactMemoBody(body: string): string {
  const lines = body.split("\n").filter((l) => !/^#\s/.test(l));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,}\s/.test(lines[i])) {
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (!next || /^#{2,}\s/.test(next)) continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cite(p: Paper): string {
  const authors = p.authors.length > 2 ? `${p.authors[0]} ほか` : p.authors.join(", ");
  return [authors, p.year, p.venue].filter(Boolean).join(", ");
}

/** ym(YYYY-MM)に読了したもの。読んだ順 */
export function monthReads(papers: Paper[], memos: Memo[], ym: string): { paper: Paper; memo: Memo }[] {
  return memos
    .filter((m) => m.frontmatter.completed && m.frontmatter.date.startsWith(ym))
    .sort((a, b) => (a.frontmatter.date < b.frontmatter.date ? -1 : 1))
    .flatMap((memo) => {
      const paper = papers.find((p) => p.id === memo.frontmatter.paper_id);
      return paper ? [{ paper, memo }] : [];
    });
}

/** その月に読んだものとメモを 1 つの Markdown に。輪講の資料や卒論の材料としてそのまま持ち出せる形 */
export function monthDigest(papers: Paper[], memos: Memo[], ym: string): string {
  const reads = monthReads(papers, memos, ym);
  const head = `# ${ym} に読んだもの(${reads.length} 本)\n`;
  const items = reads.map(({ paper, memo }) => {
    const link = paper.url ?? (paper.doi ? `https://doi.org/${paper.doi}` : "");
    return [`## ${paper.title}`, [cite(paper), link].filter(Boolean).join(" / "), `読了: ${memo.frontmatter.date}(Lv${memo.frontmatter.level})`, "", demote(compactMemoBody(memo.body)) || "(メモなし)"].join("\n");
  });
  return [head, ...items].join("\n") + "\n";
}

/** メモの中の見出しを、論文の見出し(##)より下げる */
function demote(body: string): string {
  return body.replace(/^(#{2,})\s/gm, "#$1 ");
}

/** 手元の arXiv 索引から引いた、近いが未読の論文(関連研究の材料ではなく「まだ読んでいない観点」の材料) */
export interface NearbyPaper {
  id: string;
  title: string;
  authors?: string[];
  year?: number | null;
}

/**
 * 月のメモから「関連研究」の節の下書きを作らせる。材料はメモだけ。メモに無いことを足させない。
 * nearby(手元の索引で見つけた未読の論文)は本文には入れさせず、最後の「まだ読んでいなさそうな観点」にだけ使わせる
 */
export function buildRelatedWorkRequest(papers: Paper[], memos: Memo[], ym: string, language: string, nearby: NearbyPaper[] = []): { system: string; user: string } {
  const lang = language === "en" ? "English" : "日本語";
  const reads = monthReads(papers, memos, ym);
  const list = reads.map(({ paper, memo }, i) => `[${i + 1}] ${paper.title}(${cite(paper)})\n${compactMemoBody(memo.body) || "(メモなし)"}`).join("\n\n");
  const nearbyRule = nearby.length ? "「まだ読んでいなさそうな観点」には、下の「近いが未読の論文」を [A 番号] で挙げてよい(タイトルしか分かっていないので、内容を断定しない)。ただし関連研究の本文にはこれらを入れないこと。" : "";
  const nearbyList = nearby.length
    ? `\n\n近いが未読の論文(手元の arXiv 索引から。本文は読んでいない):\n${nearby.map((n, i) => `[A${i + 1}] ${n.title}(${[n.authors?.length ? (n.authors.length > 2 ? `${n.authors[0]} ほか` : n.authors.join(", ")) : null, n.year].filter(Boolean).join(", ")}) ${n.id}`).join("\n")}`
    : "";
  return {
    system: `あなたは研究室の先輩です。後輩が 1 か月で読んだ論文のメモから、卒論・修論の「関連研究」の節の下書きを作ってください。材料はメモに書かれていることだけです。メモに無い内容や、読んでいない論文を足さないでください。論文は [番号] で引用し、似たものをまとめて流れを作り、最後に「この後輩がまだ読んでいなさそうな観点」を 2〜3 個、箇条書きで挙げてください。${nearbyRule}出力は${lang}の Markdown で。`,
    user: `読んだ論文とメモ(${ym}):\n\n${list}${nearbyList}`,
  };
}
