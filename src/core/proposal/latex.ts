// 計画書を LaTeX にする(仕様 13。任意)。main.tex・refs.bib・図の PNG を 1 つの ZIP にまとめる。
// 日本語が通るよう LuaLaTeX + ltjsarticle を前提にする(Overleaf でもコンパイラを LuaLaTeX にすれば通る)

import { zipSync, type Zippable } from "fflate";
import type { Paper, Proposal } from "@/core/types";
import { paperToBibtex } from "@/core/papers/bibtex";
import type { ProposalImages } from "./docx";
import { CITE_RE, bodyBlocks, boldRuns, figurePlacement, numberCitations, parseCiteGroup } from "./model";

const FIG_FILE = { schedule: "fig-schedule.png", map: "fig-map.png" } as const;

export function escTex(s: string): string {
  return s
    .replace(/\\/g, "\u0000")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/\u0000/g, "\\textbackslash{}");
}

/** 引用以外をエスケープし、[@a; @b] を \cite{a,b} にする。リストに無いキーは [?] にする */
function texInline(text: string, known: Set<string>): string {
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE_RE)) {
    out.push(texBold(text.slice(last, m.index)));
    const keys = parseCiteGroup(m[1]);
    const ok = keys.filter((k) => known.has(k));
    out.push((ok.length ? `\\cite{${ok.join(",")}}` : "") + (ok.length < keys.length ? "[?]" : ""));
    last = m.index! + m[0].length;
  }
  out.push(texBold(text.slice(last)));
  return out.join("");
}

function texBold(text: string): string {
  return boldRuns(text)
    .map((r) => {
      const s = escTex(r.text).replace(/\n/g, "\\\\\n");
      return r.bold ? `\\textbf{${s}}` : s;
    })
    .join("");
}

/** BibTeX のエントリのキーを、計画書で使っているキーに揃える(取り込んだ元のエントリは別のキーを持っていることがある) */
function bibWithKey(p: Paper, key: string): string {
  const entry = paperToBibtex(p, key).replace(/^(@\w+\s*\{)\s*[^,\s]*\s*,/, `$1${key},`);
  if (p.bibtex?.trim()) return entry; // 文献管理ツールの出力は TeX として正しい前提でそのまま
  // 書誌情報から作ったものは、TeX で通らない記号を逃がし、要らないアブストラクトを落とす
  return entry
    .split("\n")
    .filter((l) => !/^\s*abstract\s*=/.test(l))
    .map((l) => (/^\s*(title|author|journal|booktitle)\s*=/.test(l) ? l.replace(/(?<!\\)([&%#_$])/g, "\\$1") : l))
    .join("\n")
    .replace(/,\n\}$/, "\n}");
}

export function buildLatex(p: Proposal, byKey: Map<string, Paper>, images: ProposalImages = {}): { tex: string; bib: string } {
  const { ordered, numbers } = numberCitations(p, byKey);
  const known = new Set(numbers.keys());
  const placement = figurePlacement(p, { schedule: !!images.schedule, map: !!images.map });
  const out: string[] = [
    "% LuaLaTeX でコンパイルしてください(Overleaf: Menu → Compiler → LuaLaTeX)。",
    "% 参考文献は refs.bib。lualatex → bibtex → lualatex → lualatex の順で番号が付きます。",
    "\\documentclass[a4paper,11pt]{ltjsarticle}",
    "\\usepackage[margin=25mm]{geometry}",
    "\\usepackage{graphicx}",
    "\\usepackage{url}",
    `\\title{${escTex(p.title.trim() || "研究計画書")}}`,
    `\\author{${[p.affiliation.trim(), p.author.trim()].filter(Boolean).map(escTex).join(" \\\\ ")}}`,
    "\\date{}",
    "\\begin{document}",
    "\\maketitle",
    "",
  ];
  const figures = (where: string | null) => {
    for (const f of placement.get(where) ?? []) {
      const caption = f === "schedule" ? p.schedule.caption : p.map.caption;
      out.push("\\begin{figure}[htbp]", "  \\centering", `  \\includegraphics[width=0.95\\linewidth]{${FIG_FILE[f]}}`, `  \\caption{${escTex(caption.trim())}}`, "\\end{figure}", "");
    }
  };
  for (const s of p.sections) {
    if (s.heading.trim()) out.push(`\\section{${escTex(s.heading.trim())}}`);
    let inList = false;
    for (const b of bodyBlocks(s.body)) {
      if (b.kind === "bullet" && !inList) out.push("\\begin{itemize}");
      if (b.kind !== "bullet" && inList) out.push("\\end{itemize}", "");
      inList = b.kind === "bullet";
      out.push(b.kind === "bullet" ? `  \\item ${texInline(b.text, known)}` : `${texInline(b.text, known)}\n`);
    }
    if (inList) out.push("\\end{itemize}", "");
    figures(s.id);
  }
  figures(null);
  if (ordered.length) {
    out.push(`\\renewcommand{\\refname}{${escTex(p.references_heading.trim() || "参考文献")}}`, "\\bibliographystyle{unsrt}", "\\bibliography{refs}");
  }
  out.push("\\end{document}", "");
  const keyOf = new Map([...byKey.entries()].map(([k, paper]) => [paper.id, k]));
  const bib = ordered.map((paper) => bibWithKey(paper, keyOf.get(paper.id)!)).join("\n\n");
  return { tex: out.join("\n"), bib: bib ? bib + "\n" : "" };
}

export function buildLatexZip(p: Proposal, byKey: Map<string, Paper>, images: ProposalImages = {}): Uint8Array {
  const { tex, bib } = buildLatex(p, byKey, images);
  const enc = (s: string) => new TextEncoder().encode(s);
  const files: Zippable = { "main.tex": enc(tex) };
  if (bib) files["refs.bib"] = enc(bib);
  for (const f of ["schedule", "map"] as const) {
    const img = images[f];
    if (img && (f === "schedule" ? p.schedule.enabled : p.map.enabled)) files[FIG_FILE[f]] = [img.png, { level: 0 }];
  }
  return zipSync(files);
}
