// メモ形式(仕様 4.3): frontmatter + Markdown 本文

import type { Memo, MemoFrontmatter, Paper } from "@/core/types";

export const TEMPLATE_HEADINGS = [
  "何を解いた / 論じた問題か",
  "手法の要点",
  "結果・主張",
  "自分の言葉で言うと / 自分の研究との関係",
  "疑問・批判",
];

export function memoTemplate(paper: Paper): string {
  return [`# ${paper.title}`, "", ...TEMPLATE_HEADINGS.flatMap((h) => [`## ${h}`, "", ""])].join("\n");
}

export function memoFileName(date: string, paperId: string): string {
  const safe = paperId.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${date}_${safe}.md`;
}

/** 見出し行と空行を除いた本文の文字数(仕様 4.3) */
export function countMemoChars(body: string): number {
  return body
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s+/g, ""))
    .join("").length;
}

export function serializeMemo(fm: MemoFrontmatter, body: string): string {
  const lines = [
    "---",
    `paper_id: ${JSON.stringify(fm.paper_id)}`,
    `date: ${fm.date}`,
    `chars: ${fm.chars}`,
    `completed: ${fm.completed}`,
    `summary_input: ${JSON.stringify(fm.summary_input)}`,
    `score_total: ${fm.score_total === null ? "null" : fm.score_total}`,
    "---",
    "",
  ];
  return lines.join("\n") + body.replace(/^\n+/, "");
}

export function parseMemo(path: string, text: string): Memo | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fmRaw: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv) fmRaw[kv[1]] = kv[2];
  }
  const unq = (v: string | undefined) => {
    if (v === undefined) return "";
    const t = v.trim();
    if (t.startsWith('"')) {
      try {
        return JSON.parse(t) as string;
      } catch {
        return t.slice(1, -1);
      }
    }
    return t;
  };
  const paper_id = unq(fmRaw.paper_id);
  if (!paper_id) return null;
  const score = fmRaw.score_total?.trim();
  const fm: MemoFrontmatter = {
    paper_id,
    date: unq(fmRaw.date),
    chars: Number(fmRaw.chars) || 0,
    completed: fmRaw.completed?.trim() === "true",
    summary_input: (unq(fmRaw.summary_input) || "none") as MemoFrontmatter["summary_input"],
    score_total: !score || score === "null" ? null : Number(score),
  };
  return { path, frontmatter: fm, body: m[2] };
}
