// BibTeX の取り込みと書き出し(仕様 4.2 / 11 v2)。
//
// 取り込み: @article{key, field = {...}, ...} を読み、Paper の列に対応づける。元のエントリは bibtex 列に残す。
// 書き出し: bibtex 列があればそのまま、無ければ書誌情報から生成する。
// 文字列の連結(#)や @string の展開は扱わない(論文管理ツールの出力には現れない)

import type { Paper } from "@/core/types";
import type { CsvPaperInput } from "./csv";

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
  /** 元のテキスト */
  raw: string;
}

/** 対になる閉じ括弧の位置。無ければ -1 */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** {…} または "…" または裸の値を読む。返す位置は値の直後 */
function readValue(body: string, i: number): { value: string; end: number } {
  while (i < body.length && /\s/.test(body[i])) i++;
  if (body[i] === "{") {
    const close = matchBrace(body, i);
    if (close < 0) return { value: body.slice(i + 1), end: body.length };
    return { value: body.slice(i + 1, close), end: close + 1 };
  }
  if (body[i] === '"') {
    let j = i + 1;
    let depth = 0;
    for (; j < body.length; j++) {
      const c = body[j];
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === '"' && depth === 0) break;
    }
    return { value: body.slice(i + 1, j), end: Math.min(j + 1, body.length) };
  }
  let j = i;
  while (j < body.length && body[j] !== "," && body[j] !== "\n") j++;
  return { value: body.slice(i, j).trim(), end: j };
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const m = /^\s*,?\s*([A-Za-z][\w:-]*)\s*=/.exec(body.slice(i));
    if (!m) break;
    const name = m[1].toLowerCase();
    i += m[0].length;
    const { value, end } = readValue(body, i);
    fields[name] = value;
    i = end;
    // 次の "," まで飛ばす(値の後ろに余計なものがあっても壊れない)
    while (i < body.length && body[i] !== ",") i++;
  }
  return fields;
}

export function parseBibtex(text: string): { entries: BibEntry[]; errors: string[] } {
  const entries: BibEntry[] = [];
  const errors: string[] = [];
  const re = /@([A-Za-z]+)\s*([{(])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    const open = m.index + m[0].length - 1;
    const close = m[2] === "{" ? matchBrace(text, open) : text.indexOf(")", open);
    if (close < 0) {
      errors.push(`閉じ括弧がありません: @${m[1]}`);
      break;
    }
    re.lastIndex = close + 1;
    if (type === "comment" || type === "preamble" || type === "string") continue;
    const inner = text.slice(open + 1, close);
    const comma = inner.indexOf(",");
    const key = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fields = comma < 0 ? {} : parseFields(inner.slice(comma + 1));
    entries.push({ type, key, fields, raw: text.slice(m.index, close + 1) });
  }
  return { entries, errors };
}

/** 中括弧と TeX の飾りを落として 1 行にする */
export function cleanValue(v: string): string {
  return v
    .replace(/\\[`'^"~=.]\{?([A-Za-z])\}?/g, "$1") // \'{e} → e
    .replace(/\\([A-Za-z]+)\s*/g, (_, cmd: string) => (cmd === "and" ? "and " : "")) // \textit など
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Last, First and First Last" → ["First Last", ...] */
export function splitAuthors(v: string): string[] {
  return v
    .split(/\s+and\s+/i)
    .map((a) => cleanValue(a))
    .filter(Boolean)
    .map((a) => {
      const comma = a.indexOf(",");
      if (comma < 0) return a;
      const last = a.slice(0, comma).trim();
      const first = a.slice(comma + 1).replace(/,.*$/, "").trim(); // "Last, Jr., First" の Jr. は落とす
      return first ? `${first} ${last}` : last;
    });
}

export function entryToPaper(e: BibEntry): CsvPaperInput | null {
  const f = e.fields;
  const title = f.title ? cleanValue(f.title) : "";
  if (!title) return null;
  const yearStr = f.year ? cleanValue(f.year) : "";
  const year = /^\d{4}/.test(yearStr) ? Number(yearStr.slice(0, 4)) : null;
  const venue = [f.journal, f.booktitle, f.publisher, f.school, f.howpublished].find((x) => x && cleanValue(x));
  const doi = f.doi ? cleanValue(f.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") : null;
  const eprint = f.eprint && /arxiv/i.test(f.archiveprefix ?? f.eprinttype ?? "arXiv") ? cleanValue(f.eprint).replace(/^arxiv:/i, "") : null;
  let url = f.url ? cleanValue(f.url) : null;
  let pdfUrl = null as string | null;
  if (eprint) {
    url = url ?? `https://arxiv.org/abs/${eprint}`;
    pdfUrl = `https://arxiv.org/pdf/${eprint}`;
  } else if (url && /\.pdf($|\?)/i.test(url)) {
    pdfUrl = url;
  }
  return {
    title,
    authors: f.author ? splitAuthors(f.author) : [],
    year,
    venue: venue ? cleanValue(venue) : null,
    doi: doi || null,
    url,
    pdf_url: pdfUrl,
    abstract: f.abstract ? cleanValue(f.abstract) : null,
    reason: f.note ? cleanValue(f.note) : null,
    bibtex: e.raw,
    source: "import",
  };
}

export function bibtexToPapers(text: string): { papers: CsvPaperInput[]; errors: string[] } {
  const { entries, errors } = parseBibtex(text);
  if (!entries.length && !errors.length) return { papers: [], errors: ["BibTeX のエントリが見つかりませんでした"] };
  const papers: CsvPaperInput[] = [];
  for (const e of entries) {
    const p = entryToPaper(e);
    if (p) papers.push(p);
    else errors.push(`title がありません: @${e.type}{${e.key || "(キーなし)"}}`);
  }
  return { papers, errors };
}

// ---- 書き出し ----

function ascii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^A-Za-z0-9]/g, "");
}

const STOP = new Set(["a", "an", "the", "on", "of", "in", "for", "to", "and", "with", "toward", "towards", "is", "are", "at", "by"]);

/** 引用キー: 筆頭著者の姓 + 年 + タイトルの最初の意味のある語。ASCII に落とす */
export function citationKey(p: Pick<Paper, "authors" | "year" | "title">): string {
  const first = p.authors[0] ?? "";
  const last = ascii(first.includes(",") ? first.split(",")[0] : (first.split(/\s+/).pop() ?? ""));
  const word = p.title
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => ascii(w).toLowerCase())
    .find((w) => w && !STOP.has(w)) ?? "";
  return `${last.toLowerCase() || "anon"}${p.year ?? ""}${word}` || "paper";
}

function esc(v: string): string {
  return v.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** "First Last" → "Last, First"。区切りの無い(日本語などの)名前はそのまま */
function bibAuthor(a: string): string {
  const t = a.trim();
  if (t.includes(",") || !t.includes(" ")) return t;
  const parts = t.split(/\s+/);
  const last = parts.pop()!;
  return `${last}, ${parts.join(" ")}`;
}

export function paperToBibtex(p: Paper, key = citationKey(p)): string {
  if (p.bibtex?.trim()) return p.bibtex.trim();
  const type = p.venue && /proc|conf|workshop|symposium|会議|研究会/i.test(p.venue) ? "inproceedings" : p.venue ? "article" : "misc";
  const venueField = type === "inproceedings" ? "booktitle" : "journal";
  const arxiv = /^10\.48550\/arxiv\.(.+)$/i.exec(p.doi ?? "");
  const fields: [string, string | null][] = [
    ["title", `{${esc(p.title)}}`],
    ["author", p.authors.length ? p.authors.map(bibAuthor).join(" and ") : null],
    ["year", p.year ? String(p.year) : null],
    [venueField, p.venue ? esc(p.venue) : null],
    ["doi", p.doi ?? null],
    ["url", p.url ?? (p.doi && !arxiv ? `https://doi.org/${p.doi}` : null)],
    ["eprint", arxiv ? arxiv[1] : null],
    ["archiveprefix", arxiv ? "arXiv" : null],
    ["abstract", p.abstract ? esc(p.abstract) : null],
  ];
  const body = fields.filter((f): f is [string, string] => !!f[1]).map(([k, v]) => `  ${k} = {${v}}`);
  return `@${type}{${key},\n${body.join(",\n")}\n}`;
}

/** 複数件。引用キーが重ならないように末尾に a, b, … を付ける */
export function papersToBibtex(papers: Paper[]): string {
  const used = new Map<string, number>();
  const out: string[] = [];
  for (const p of papers) {
    let key = citationKey(p);
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    if (n > 0) key += String.fromCharCode(96 + n); // 2 つ目は a、3 つ目は b…
    out.push(paperToBibtex(p, key));
  }
  return out.join("\n\n") + "\n";
}
