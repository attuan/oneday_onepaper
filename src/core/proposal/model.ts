// 研究計画書(仕様 13)の形と、本文の読み方。どれも純粋関数
//
// 本文は平文で持つ。空行で段落、行頭の「- 」か「・」で箇条書き、**太字**、[@引用キー] で引用。
// 引用キーは論文リストから作る(citeKeys)。リストに無いキーは書き出しで [?] になり、警告に出る

import type { Memo, Paper, Proposal, ProposalSection, ScheduleRow } from "@/core/types";
import { citationKey } from "@/core/papers/bibtex";
import { pad2 } from "@/core/schedule/logicalDay";

export interface ProposalTemplate {
  id: string;
  label: string;
  description: string;
  sections: { heading: string; hint: string }[];
}

// 節の名前と分量は提出先ごとに違うので、どれもあとから変えられる前提の叩き台
export const PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  {
    id: "thesis",
    label: "卒業研究・修士研究",
    description: "研究室や指導教員に出す計画書。研究の中身を一通り書く形",
    sections: [
      { heading: "研究の背景", hint: "この研究が扱う問題と、それがなぜ大事か。分野の外の人にも分かるように" },
      { heading: "研究の目的", hint: "この研究で何を明らかにする / 実現するか。1〜2 文で言えるように" },
      { heading: "先行研究と本研究の位置づけ", hint: "これまでに何が分かっていて、何がまだ分かっていないか。本研究はそのどこを埋めるか" },
      { heading: "研究の方法", hint: "目的をどうやって達成するか。データ・実験・評価のしかた" },
      { heading: "研究計画", hint: "いつ何をするか。うまくいかなかったときの代わりの手" },
      { heading: "期待される成果", hint: "うまくいったら何が言えるか。分野や社会にとっての意味" },
    ],
  },
  {
    id: "admission",
    label: "大学院入試",
    description: "出願や面接で出す計画書。志望先でその研究をする理由も書くことが多い",
    sections: [
      { heading: "研究の背景", hint: "関心を持ったきっかけと、扱う問題がなぜ大事か" },
      { heading: "研究の目的", hint: "大学院で何を明らかにしたいか。1〜2 文で言えるように" },
      { heading: "関連研究", hint: "これまでの研究で分かっていること、まだ分かっていないこと" },
      { heading: "研究の方法と計画", hint: "どうやって進めるか。修了までのおおまかな予定" },
      { heading: "期待される成果と意義", hint: "うまくいったら何が言えるか" },
      { heading: "この研究室で行う理由", hint: "志望先の研究や環境と、自分の計画がどうつながるか" },
    ],
  },
  {
    id: "grant",
    label: "研究費・奨学金の申請",
    description: "審査される申請書によくある構成。実際の様式の見出しと分量に合わせて直す",
    sections: [
      { heading: "研究の背景と位置づけ", hint: "分野の現状と、本研究がどこに位置するか" },
      { heading: "研究の目的", hint: "期間内に何を明らかにするか" },
      { heading: "研究の特色・独創的な点", hint: "先行研究と比べて何が新しいか" },
      { heading: "研究の方法と計画", hint: "年度ごとに何をするか。うまくいかなかったときの代わりの手" },
      { heading: "期待される成果と波及効果", hint: "成果が分野や社会にもたらすもの" },
      { heading: "これまでの研究と準備状況", hint: "すでにやったこと、使えるデータや設備" },
    ],
  },
  {
    id: "blank",
    label: "白紙",
    description: "指定の様式がある人向け。節を自分で作る",
    sections: [{ heading: "はじめに", hint: "" }],
  },
];

export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newSection(heading: string, hint = ""): ProposalSection {
  return { id: newId("s"), heading, hint, body: "", limit: null, feedback: null };
}

export function newProposal(templateId: string, input: { title?: string; purpose?: string }, now: Date): Proposal {
  const t = PROPOSAL_TEMPLATES.find((x) => x.id === templateId) ?? PROPOSAL_TEMPLATES[0];
  const sections = t.sections.map((s) => newSection(s.heading, s.hint));
  const iso = now.toISOString();
  return {
    version: 1,
    id: newId("p"),
    title: input.title?.trim() ?? "",
    author: "",
    affiliation: "",
    purpose: input.purpose?.trim() ?? "",
    template: t.id,
    sections,
    references_heading: "参考文献",
    schedule: { enabled: false, caption: "研究スケジュール", after_section: guessSection(sections, /計画|スケジュール/), rows: [] },
    map: {
      enabled: false,
      caption: "先行研究における本研究の位置づけ",
      after_section: guessSection(sections, /先行|関連|位置づけ|独創/),
      x_axis: { low: "", high: "" },
      y_axis: { low: "", high: "" },
      points: [{ id: newId("m"), paper_id: null, label: "本研究", x: 0.8, y: 0.8 }],
    },
    created_at: iso,
    updated_at: iso,
  };
}

function guessSection(sections: ProposalSection[], re: RegExp): string | null {
  return sections.find((s) => re.test(s.heading))?.id ?? null;
}

/** 古い・手で直したファイルでも開けるように、欠けたところを埋める */
export function normalizeProposal(raw: Partial<Proposal> & { id: string }): Proposal {
  const base = newProposal("blank", {}, new Date(raw.created_at ?? Date.now()));
  return {
    ...base,
    ...raw,
    sections: Array.isArray(raw.sections) ? raw.sections.map((s) => ({ ...newSection(""), ...s })) : base.sections,
    schedule: { ...base.schedule, ...(raw.schedule ?? {}), rows: raw.schedule?.rows ?? [] },
    map: { ...base.map, ...(raw.map ?? {}), points: raw.map?.points ?? base.map.points },
  };
}

/** 研究スケジュールを初めて出したときの叩き台。今月から始める */
export function defaultScheduleRows(today: string): ScheduleRow[] {
  const [y, m] = today.split("-").map(Number);
  const ym = (offset: number) => {
    const d = new Date(y, m - 1 + offset, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  };
  return [
    { id: newId("r"), label: "文献調査", start: ym(0), end: ym(2) },
    { id: newId("r"), label: "手法の検討・準備", start: ym(1), end: ym(4) },
    { id: newId("r"), label: "実験・評価", start: ym(4), end: ym(8) },
    { id: newId("r"), label: "論文執筆・発表準備", start: ym(8), end: ym(10) },
  ];
}

// ---- 引用 ----

/**
 * 論文 ID → 引用キー。追加した順に割り当てるので、あとから論文を足しても既存のキーは変わらない。
 * 外した論文も含める(計画書に残っている引用を壊さないため)。同じキーは 2 つ目から a, b, … を付ける(BibTeX の書き出しと同じ)
 */
export function citeKeys(papers: Paper[]): Map<string, string> {
  const sorted = [...papers].sort((a, b) => (a.added_at === b.added_at ? (a.id < b.id ? -1 : 1) : a.added_at < b.added_at ? -1 : 1));
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const p of sorted) {
    let key = citationKey(p);
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    if (n > 0) key += String.fromCharCode(96 + n);
    out.set(p.id, key);
  }
  return out;
}

/** 引用キー → 論文 */
export function papersByKey(papers: Paper[]): Map<string, Paper> {
  const keys = citeKeys(papers);
  return new Map(papers.map((p) => [keys.get(p.id)!, p]));
}

/** [@a] / [@a; @b] / [@a, @b] */
export const CITE_RE = /\[@([^\]\s][^\]]*)\]/g;

export function parseCiteGroup(inner: string): string[] {
  return inner
    .split(/[;,]/)
    .map((k) => k.trim().replace(/^@/, ""))
    .filter(Boolean);
}

/** 本文に出てくる引用キー(出てくる順、重複なし) */
export function citedKeys(bodies: string[]): string[] {
  const seen = new Set<string>();
  for (const b of bodies) for (const m of b.matchAll(CITE_RE)) for (const k of parseCiteGroup(m[1])) seen.add(k);
  return [...seen];
}

/** 番号付け。本文に最初に出てきた順に 1, 2, … 。リストに無いキーは unknown に */
export function numberCitations(p: Proposal, byKey: Map<string, Paper>): { numbers: Map<string, number>; ordered: Paper[]; unknown: string[] } {
  const numbers = new Map<string, number>();
  const ordered: Paper[] = [];
  const unknown: string[] = [];
  for (const k of citedKeys(p.sections.map((s) => s.body))) {
    const paper = byKey.get(k);
    if (!paper) {
      unknown.push(k);
      continue;
    }
    numbers.set(k, ordered.length + 1);
    ordered.push(paper);
  }
  return { numbers, ordered, unknown };
}

/** [@a; @b] → [1, 2]。無いキーは ? */
export function renderCitations(body: string, numbers: Map<string, number>): string {
  return body.replace(CITE_RE, (_, inner: string) => `[${parseCiteGroup(inner).map((k) => numbers.get(k) ?? "?").join(", ")}]`);
}

/** 字数。空白・改行・**・行頭の箇条書き記号を除き、引用は [1] の形にしてから数える */
export function sectionChars(body: string): number {
  const text = body
    .replace(CITE_RE, (_, inner: string) => `[${parseCiteGroup(inner).map(() => "1").join(", ")}]`)
    .replace(/^\s*(?:-\s|・)/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, "");
  return [...text].length;
}

/** 文の後ろに引用を入れる。文末の句点の前に入れる。文が見つからなければ null */
export function insertCitationAfter(body: string, sentence: string, key: string): string | null {
  const s = sentence.trim();
  const at = body.indexOf(s);
  if (!s || at < 0) return null;
  let end = at + s.length;
  if (/[。．.]$/.test(s)) end -= 1;
  return `${body.slice(0, end)}[@${key}]${body.slice(end)}`;
}

/** 参考文献の 1 行(番号は付けない) */
export function referenceText(p: Paper): string {
  const ja = /[぀-ヿ一-鿿]/.test(p.title + p.authors.join(""));
  const authors = p.authors.length > 3 ? `${p.authors.slice(0, 3).join(", ")}${ja ? " ほか" : ", et al."}` : p.authors.join(", ");
  const link = p.doi && !/^10\.48550\//i.test(p.doi) ? `https://doi.org/${p.doi}` : (p.url ?? (p.doi ? `https://doi.org/${p.doi}` : ""));
  const parts = [authors, p.title, p.venue, p.year ? String(p.year) : null].map((x) => (x ?? "").trim().replace(/\.$/, "")).filter(Boolean);
  return parts.join(". ") + "." + (link ? ` ${link}` : "");
}

/** マップの点やリストに出す短い名前。「姓 年」 */
export function shortLabel(p: Paper): string {
  const first = p.authors[0] ?? "";
  const family = first.includes(",") ? first.split(",")[0] : /[぀-ヿ一-鿿]/.test(first) ? first.split(/\s+/)[0] : (first.split(/\s+/).pop() ?? "");
  const head = family || p.title.slice(0, 12);
  return p.year ? `${head} ${p.year}` : head;
}

// ---- 材料 ----

/** メモの「疑問・批判」の節。研究の問いの種になる */
export function memoQuestions(papers: Paper[], memos: Memo[]): { paper: Paper; text: string; date: string }[] {
  const out: { paper: Paper; text: string; date: string }[] = [];
  for (const m of memos) {
    const paper = papers.find((p) => p.id === m.frontmatter.paper_id);
    if (!paper) continue;
    const match = /^##\s*疑問・批判\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(m.body);
    const text = match?.[1].trim();
    if (text) out.push({ paper, text, date: m.frontmatter.date });
  }
  return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

export interface ProposalCheck {
  /** 論文リストに無い引用キー */
  unknownKeys: string[];
  /** 字数の上限を超えた節 */
  overLimit: { heading: string; chars: number; limit: number }[];
  /** 空の節 */
  empty: string[];
}

/** 書き出す前に見せる確認 */
export function checkProposal(p: Proposal, byKey: Map<string, Paper>): ProposalCheck {
  return {
    unknownKeys: numberCitations(p, byKey).unknown,
    overLimit: p.sections.flatMap((s) => {
      const chars = sectionChars(s.body);
      return s.limit && chars > s.limit ? [{ heading: s.heading, chars, limit: s.limit }] : [];
    }),
    empty: p.sections.filter((s) => !s.body.trim()).map((s) => s.heading || "(見出しなし)"),
  };
}

export interface Block {
  kind: "para" | "bullet";
  /** 段落は改行を残す(行の中の改行) */
  text: string;
}

/** 本文を段落と箇条書きに分ける。書き出し(Word / LaTeX)で共通 */
export function bodyBlocks(body: string): Block[] {
  const out: Block[] = [];
  for (const chunk of body.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    let para: string[] = [];
    const flush = () => {
      if (para.length) out.push({ kind: "para", text: para.join("\n") });
      para = [];
    };
    for (const line of chunk.split("\n")) {
      const b = /^\s*(?:-\s+|・\s*)(.*)$/.exec(line);
      if (b) {
        flush();
        out.push({ kind: "bullet", text: b[1] });
      } else if (line.trim()) para.push(line.trim());
    }
    flush();
  }
  return out;
}

/** **太字** を切り分ける */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

/** 図を置く場所。節の id → その後ろに置く図。null は参考文献の前 */
export function figurePlacement(p: Proposal, available: { schedule: boolean; map: boolean }): Map<string | null, ("schedule" | "map")[]> {
  const out = new Map<string | null, ("schedule" | "map")[]>();
  const ids = new Set(p.sections.map((s) => s.id));
  const put = (where: string | null, f: "schedule" | "map") => {
    const k = where && ids.has(where) ? where : null;
    out.set(k, [...(out.get(k) ?? []), f]);
  };
  if (p.schedule.enabled && available.schedule) put(p.schedule.after_section, "schedule");
  if (p.map.enabled && available.map) put(p.map.after_section, "map");
  return out;
}

export function safeFileName(title: string, fallback: string): string {
  const t = title.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").trim().slice(0, 60);
  return t || fallback;
}
