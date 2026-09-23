// arXiv の手元の索引(デスクトップ版)。
//
// Hugging Face の secemp9/arxiv-complete(arXiv 全体のスナップショット)の metadata config から、
// 選んだカテゴリだけを SQLite に入れておき、レート制限もネットも無しにタイトル・抄録を検索する。
// 索引の作成と検索の実体は Rust(src-tauri/src/arxiv_index.rs)。ここは候補への変換と、似た論文を探す問い合わせ。
// スナップショットは静的なので新着は入らない。新しいものはライブの arXiv API(arxiv.ts)が受け持つ。

import type { Paper } from "@/core/types";
import type { ArxivIndexBackend, ArxivIndexHit, ArxivIndexQuery, ArxivIndexStats } from "@/core/store/backend";
import { joinPath } from "@/core/store/backend";
import type { Candidate } from "./types";

/** metadata config の Parquet(1.6 GB、1 ファイル)。カード: https://huggingface.co/datasets/secemp9/arxiv-complete */
export const ARXIV_METADATA_URL = "https://huggingface.co/datasets/secemp9/arxiv-complete/resolve/main/metadata/train-00000-of-00001.parquet";
export const ARXIV_METADATA_BYTES = 1_643_927_530;
/** 入ったばかりの人向けの既定。機械学習・NLP・CV・IR あたり */
export const DEFAULT_INDEX_CATEGORIES = ["cs.CL", "cs.LG", "cs.AI", "cs.CV", "cs.IR", "stat.ML"];

export function arxivIndexPath(dataDir: string): string {
  return joinPath(dataDir, "arxiv-index.sqlite");
}

export function arxivParquetPath(dataDir: string): string {
  return joinPath(dataDir, "cache", "arxiv-metadata.parquet");
}

/** "cs.CL, cs.LG stat.ML" → ["cs.CL", "cs.LG", "stat.ML"] */
export function parseCategories(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((c) => c.trim().replace(/\.$/, "")).filter(Boolean))];
}

/** "A. Author, B. Author and C. Author" → 配列。arXiv のメタデータは ", " と " and " が混ざる */
export function splitAuthors(s: string): string[] {
  return s
    .split(/,\s*|\s+and\s+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

export function hitToCandidate(h: ArxivIndexHit): Candidate {
  const doi = `10.48550/arxiv.${h.id}`;
  return {
    id: doi,
    doi,
    title: h.title,
    authors: splitAuthors(h.authors),
    year: h.year,
    venue: h.journal_ref ?? "arXiv",
    url: `https://arxiv.org/abs/${h.id}`,
    pdf_url: `https://arxiv.org/pdf/${h.id}`,
    abstract: h.abstract || null,
    cited_by: 0,
    sources: ["arxiv_local"],
  };
}

export async function searchArxivLocal(index: ArxivIndexBackend, path: string, query: string, max = 15): Promise<Candidate[]> {
  const hits = await index.search(path, { query, mode: "all", limit: max });
  return hits.map(hitToCandidate);
}

const STOPWORDS = new Set(["a", "an", "the", "of", "for", "and", "or", "in", "on", "to", "with", "via", "from", "by", "at", "is", "are", "as", "its", "using", "based", "towards", "toward", "into", "over", "under", "vs", "versus", "new", "approach", "method", "methods", "study", "analysis", "paper", "note"]);

/** 似た論文を探すための語。タイトルから短い語と一般語を除く */
export function titleWords(title: string, max = 8): string[] {
  const words = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, max);
}

export function arxivIdOf(paper: Pick<Paper, "id" | "doi" | "url">): string | null {
  const m = /10\.48550\/arxiv\.(.+)$/i.exec(paper.doi ?? paper.id) ?? /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i.exec(paper.url ?? "");
  return m ? m[1].replace(/v\d+$/, "") : null;
}

/** 読んだ論文に近いもの。同じ頃(±3 年)で、タイトルの語のどれかを含むものを bm25 順に */
export async function similarInIndex(index: ArxivIndexBackend, path: string, paper: Pick<Paper, "id" | "doi" | "url" | "title" | "year">, max = 5): Promise<Candidate[]> {
  const words = titleWords(paper.title);
  if (words.length < 2) return [];
  const q: ArxivIndexQuery = { query: words.join(" "), mode: "any", limit: max + 1, yearFrom: paper.year ? paper.year - 3 : null, yearTo: paper.year ? paper.year + 3 : null };
  const self = arxivIdOf(paper);
  return (await index.search(path, q))
    .filter((h) => h.id !== self)
    .slice(0, max)
    .map(hitToCandidate);
}

export function describeIndex(s: ArxivIndexStats): string {
  const mb = Math.round(s.bytes / 1024 / 1024);
  const cats = s.categories.length ? s.categories.join(", ") : "全カテゴリ";
  return `${s.papers.toLocaleString()} 本(${cats})、${mb} MB、作成 ${s.built_at.slice(0, 10)}${s.snapshot ? `、収録は ${s.snapshot} まで` : ""}`;
}
