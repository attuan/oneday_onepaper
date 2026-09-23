#!/usr/bin/env node
// arXiv の実データを Hugging Face の secemp9/arxiv-complete から少しだけ取り、テストと LLM 評価の材料にする。
//
//   node scripts/fetch-arxiv-sample.mjs [--n 5] [--prefix cs.] [--max-chars 60000]
//
// 出力: src/core/scholar/fixtures/arxiv-sample.json
// Parquet は読まない。datasets-server の JSON API(/rows, /filter)だけを使うので依存が要らない。
// `sample` config(991 本)から primary_category が prefix で始まるものを、カテゴリが重ならないように n 本選ぶ。
// 本文(TeX)は max-chars で切る。書誌情報(著者・年・カテゴリ・DOI)は metadata config から補う(取れなければ省く)。

import { writeFile } from "node:fs/promises";

const DATASET = "secemp9/arxiv-complete";
const API = "https://datasets-server.huggingface.co";
const OUT = new URL("../src/core/scholar/fixtures/arxiv-sample.json", import.meta.url);

const args = Object.fromEntries(process.argv.slice(2).map((a, i, xs) => (a.startsWith("--") ? [a.slice(2), xs[i + 1]] : [])).filter((x) => x.length));
const N = Number(args.n ?? 5);
const PREFIX = args.prefix ?? "cs.";
const MAX_CHARS = Number(args["max-chars"] ?? 60_000);

async function getJson(url, timeoutMs = 120_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function* sampleRows() {
  for (let offset = 0; ; offset += 100) {
    const j = await getJson(`${API}/rows?dataset=${DATASET}&config=sample&split=train&offset=${offset}&length=100`);
    for (const r of j.rows) yield r.row;
    if (offset + 100 >= j.num_rows_total) return;
  }
}

/** 書誌情報(著者・年・カテゴリ・DOI)。metadata config の /filter は索引が無いと 500 を返すので、だめなら arXiv API に聞く */
async function metadataFor(paperId) {
  try {
    const where = encodeURIComponent(`"paper_id"='${paperId}'`);
    const j = await getJson(`${API}/filter?dataset=${DATASET}&config=metadata&split=train&where=${where}&length=1`, 30_000);
    const r = j.rows[0]?.row;
    if (r) return { authors: r.authors, year: Number(String(r.first_version_date).slice(0, 4)) || null, categories: r.categories, doi: r.doi !== "None" ? r.doi : null, journal_ref: r.journal_ref !== "None" ? r.journal_ref : null };
  } catch (e) {
    console.warn(`metadata config から取れませんでした (${paperId}): ${e.message}。arXiv API に聞きます`);
  }
  try {
    const res = await fetch(`https://export.arxiv.org/api/query?id_list=${paperId}`, { signal: AbortSignal.timeout(60_000) });
    const xml = await res.text();
    const tag = (name) => new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)?.[1].trim() ?? null;
    const authors = [...xml.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => m[1].trim()).join(", ");
    const categories = [...xml.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]).join(" ");
    const doi = tag("arxiv:doi");
    return { authors: authors || null, year: Number((tag("published") ?? "").slice(0, 4)) || null, categories: categories || null, doi, journal_ref: tag("arxiv:journal_ref") };
  } catch (e) {
    console.warn(`arXiv API からも取れませんでした (${paperId}): ${e.message}`);
    return null;
  }
}

const seenCats = new Set();
const picked = [];
for await (const row of sampleRows()) {
  if (picked.length >= N) break;
  const cat = row.primary_category ?? "";
  if (!cat.startsWith(PREFIX) || seenCats.has(cat)) continue;
  const text = row.text ?? "";
  if (row.resolution !== "single" || text.length < 15_000 || text.length > 200_000) continue;
  if (/withdrawn/i.test(text.slice(0, 3000))) continue;
  seenCats.add(cat);
  picked.push(row);
  console.error(`選択: ${row.paper_id} [${cat}] ${row.title}`);
}

const out = [];
for (const row of picked) {
  const m = await metadataFor(row.paper_id);
  out.push({
    paper_id: row.paper_id,
    title: row.title,
    abstract: row.abstract,
    primary_category: row.primary_category,
    categories: m?.categories ?? row.primary_category,
    authors: m?.authors ?? null,
    year: m?.year ?? null,
    doi: m?.doi ?? null,
    journal_ref: m?.journal_ref ?? null,
    license: row.license,
    tex_chars: row.text.length,
    tex: row.text.slice(0, MAX_CHARS),
  });
}

await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
console.error(`${out.length} 本を ${OUT.pathname} に書きました`);
