import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MATH_MARK, looksLikeStub, texToText } from "./tex";
import { verifyEvidence } from "@/core/llm/tasks";

type Fixture = { paper_id: string; title: string; abstract: string; primary_category: string; tex: string };
const FIXTURES: Fixture[] = JSON.parse(readFileSync(new URL("../scholar/fixtures/arxiv-sample.json", import.meta.url), "utf8"));

describe("texToText", () => {
  it("コメント・プリアンブル・図・数式を落とし、見出しと文を残す", () => {
    const tex = String.raw`\documentclass{article}
\usepackage{amsmath}
\newcommand{\foo}{bar}
\begin{document}
\title{A \\ Title}
\maketitle
\begin{abstract}
We study $x$. % コメント
\end{abstract}
\section{Intro}
\label{s-intro}
Prior work~\cite{a,b} shows 50\% gains \emph{quickly}
across lines.
\begin{figure}[t]
\includegraphics{x.pdf}
\caption{The setup.}
\end{figure}
\begin{equation}
E = mc^2
\end{equation}
See Section~\ref{s-intro} and C{\'e}gielski et al.\ \cite{c}.
\begin{itemize}
\item one
\item two
\end{itemize}
\end{document}
\section{Ignored}`;
    const t = texToText(tex);
    expect(t).toContain("# A Title");
    expect(t).toContain("## Abstract\n\nWe study x.");
    expect(t).toContain("## Intro\n\nPrior work shows 50% gains quickly across lines.");
    expect(t).toContain("(図表: The setup.)");
    expect(t).toContain(MATH_MARK);
    expect(t).not.toContain("E = mc");
    expect(t).toContain("See Section and Cegielski et al..");
    expect(t).toContain("- one\n- two");
    expect(t).not.toMatch(/\\|\{|\}|Ignored|コメント|usepackage/);
  });

  it("実物の arXiv TeX(5 本)が、コマンドの残骸なしの本文になる", () => {
    for (const f of FIXTURES) {
      const t = texToText(f.tex);
      expect(t.length, f.paper_id).toBeGreaterThan(5000);
      expect(looksLikeStub(t)).toBe(false);
      expect(t, f.paper_id).not.toMatch(/\\(begin|end|cite|ref|label|section|textbf|emph)\b/);
      expect((t.match(/[{}]/g) ?? []).length, f.paper_id).toBe(0);
      // 抄録の最初の文が本文の側にも(ほぼそのまま)残っている
      const first = f.abstract.split(/(?<=\.)\s/)[0].replace(/\s+/g, " ").slice(0, 60);
      expect(t.replace(/\s+/g, " "), `${f.paper_id}: ${first}`).toContain(first.slice(0, 40));
    }
  });

  it("変換後の本文から抜いた引用が、根拠の照合で見つかる", () => {
    const f = FIXTURES[0];
    const text = texToText(f.tex);
    const sentence = text.slice(text.indexOf("## Introduction")).split(/(?<=\.)\s/)[1];
    expect(sentence.length).toBeGreaterThan(30);
    const out = verifyEvidence({ problem: "", method: "", results: "", limitations: "", evidence: [{ field: "problem", quote: sentence, found: false }, { field: "method", quote: "この文は無い", found: true }] }, text);
    expect(out.evidence?.map((e) => e.found)).toEqual([true, false]);
  });

  it("取り下げの断り書きだけのものを見分ける", () => {
    expect(looksLikeStub("This paper has been withdrawn by the author due to a crucial error.")).toBe(true);
    expect(looksLikeStub("x".repeat(1000))).toBe(false);
  });
});
