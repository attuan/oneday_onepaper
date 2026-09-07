// CSV インポート(仕様 4.2)。列名は Paper のフィールド名に対応。authors は ";" 区切り

import type { Paper } from "@/core/types";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

export type CsvPaperInput = Partial<Paper> & { title: string };

export function csvToPapers(text: string): { papers: CsvPaperInput[]; errors: string[] } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { papers: [], errors: ["空のファイルです"] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  if (idx("title") < 0) return { papers: [], errors: ["title 列がありません"] };
  const papers: CsvPaperInput[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const get = (name: string) => {
      const j = idx(name);
      return j >= 0 ? (r[j] ?? "").trim() : "";
    };
    const title = get("title");
    if (!title) {
      errors.push(`${i + 2} 行目: title が空`);
      return;
    }
    const yearStr = get("year");
    papers.push({
      title,
      authors: get("authors") ? get("authors").split(/;|\|/).map((a) => a.trim()).filter(Boolean) : [],
      year: yearStr ? Number(yearStr) || null : null,
      venue: get("venue") || null,
      doi: get("doi") || null,
      url: get("url") || null,
      pdf_url: get("pdf_url") || null,
      abstract: get("abstract") || null,
      reason: get("reason") || null,
      bibtex: get("bibtex") || null,
      source: "import",
    });
  });
  return { papers, errors };
}
