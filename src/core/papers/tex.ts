// LaTeX ソースを、人と LLM が読める本文に落とす。
//
// 用途: arXiv の投稿元 TeX(secemp9/arxiv-complete の paper_text など)を要約・採点の入力に使うとき。
// 完全な TeX 処理系ではない。狙いは「文章が残り、コマンド・図表・数式の残骸で LLM が迷わない」こと。
// 要約の根拠(evidence)は原文からの引用で照合するので(llm/tasks.ts の verifyEvidence)、
// 文の並びと語はできるだけ変えない。数式は中身を残さず [数式] に置き換える(引用の対象にならないため)。

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 図表など。丸ごと落とし、キャプションだけ残す */
const FLOAT_ENVS = ["figure", "figure*", "table", "table*", "algorithm", "algorithm*", "wrapfigure", "wraptable", "sidewaysfigure", "sidewaystable", "subfigure", "subtable"];
/** 本文と無関係なので丸ごと落とす */
const DROP_ENVS = ["tikzpicture", "pgfpicture", "thebibliography", "comment", "filecontents", "filecontents*", "picture", "tabular", "tabular*", "tabularx", "longtable", "lstlisting", "minted"];
/** 別行立ての数式 */
const MATH_ENVS = ["equation", "equation*", "align", "align*", "alignat", "alignat*", "gather", "gather*", "multline", "multline*", "eqnarray", "eqnarray*", "displaymath", "flalign", "flalign*", "math", "split", "subequations"];
/** 引数ごと落とすコマンド */
const DROP_WITH_ARG = [
  "label", "cite", "citep", "citet", "citealp", "citealt", "citeauthor", "citeyear", "nocite", "ref", "eqref", "pageref", "autoref", "cref", "Cref", "vref",
  "vspace", "vspace*", "hspace", "hspace*", "includegraphics", "input", "include", "bibliographystyle", "bibliography", "usepackage", "documentclass",
  "newcommand", "renewcommand", "providecommand", "newenvironment", "def", "setlength", "addtolength", "pagestyle", "thispagestyle", "hyphenation", "setcounter", "addtocounter",
  "numberwithin", "graphicspath", "affiliation", "affil", "address", "email", "thanks", "fntext", "cortext", "date", "keywords", "PACS", "pacs", "subjclass", "acks", "ccsdesc", "authornote",
  "newtheorem", "theoremstyle", "DeclareMathOperator", "bibitem", "index", "glossary", "marginpar", "phantom", "hphantom", "vphantom", "rule", "titlerunning", "authorrunning", "institute",
  "orcid", "orcidlink", "fancyhead", "fancyfoot", "lhead", "rhead", "chead", "lfoot", "rfoot", "cfoot", "setstretch", "linespread", "color", "textcolor", "pdfbookmark", "hypersetup", "captionsetup",
];
const HEADINGS: Record<string, string> = { title: "#", part: "#", chapter: "#", section: "##", subsection: "###", subsubsection: "####", paragraph: "#####", subparagraph: "#####" };

function envRegex(name: string): RegExp {
  const n = esc(name);
  return new RegExp(`\\\\begin\\{${n}\\}(?:\\[[^\\]]*\\])?([\\s\\S]*?)\\\\end\\{${n}\\}`, "g");
}

/** 対応する閉じ括弧までを取る(入れ子対応)。start は "{" の位置。閉じが無ければ末尾まで */
function balancedArg(s: string, start: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { inner: s.slice(start + 1, i), end: i + 1 };
    }
  }
  return { inner: s.slice(start + 1), end: s.length };
}

/**
 * `\cmd[opt]{arg}` を見つけて置き換える。arg は入れ子の括弧に対応する。
 * replace が null を返したらコマンドごと消す。arg が無い(引数を取らない書き方の)ときは触らない
 */
function replaceCommand(s: string, names: string[], replace: (name: string, arg: string) => string | null): string {
  const re = new RegExp(`\\\\(${names.map(esc).join("|")})(?![A-Za-z])(?:\\[[^\\]]*\\])*\\s*(?=\\{)`, "g");
  let out = "";
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const { inner, end } = balancedArg(s, m.index + m[0].length);
    out += s.slice(last, m.index) + (replace(m[1], inner) ?? "");
    last = end;
    re.lastIndex = end;
  }
  return out + s.slice(last);
}

function stripComments(s: string): string {
  return s.replace(/(^|[^\\])%[^\n]*/g, "$1");
}

function captionsOf(inner: string): string {
  const caps: string[] = [];
  replaceCommand(inner, ["caption", "caption*"], (_, arg) => {
    caps.push(arg);
    return "";
  });
  return caps.length ? `\n\n${caps.map((c) => `(図表: ${c})`).join("\n")}\n\n` : "\n\n";
}

/** 数式のプレースホルダ。要約の根拠にはならないので中身は残さない */
export const MATH_MARK = "[数式]";

export function texToText(tex: string): string {
  let s = tex.replace(/\r\n?/g, "\n");
  s = stripComments(s);

  const body = /\\begin\{document\}([\s\S]*?)(\\end\{document\}|$)/.exec(s);
  if (body) s = body[1];

  // 図表は落としてキャプションだけ残す。環境の入れ子(figure の中の subfigure)は内側から順に消える
  for (const env of [...FLOAT_ENVS].reverse()) for (let i = 0; i < 3; i++) s = s.replace(envRegex(env), (_, inner: string) => captionsOf(inner));
  for (const env of DROP_ENVS) s = s.replace(envRegex(env), "\n\n");
  for (const env of MATH_ENVS) s = s.replace(envRegex(env), ` ${MATH_MARK} `);
  s = s.replace(/\\\[[\s\S]*?\\\]/g, ` ${MATH_MARK} `).replace(/\$\$[\s\S]*?\$\$/g, ` ${MATH_MARK} `);
  // 行内数式は短いことが多く、文の一部として読める。$ だけ外す(\$ は通貨なので触らない)
  s = s.replace(/(^|[^\\])\$([^$\n]{1,300}?)\$/g, "$1$2");

  s = s.replace(/\\begin\{abstract\}/g, "\n\n## Abstract\n\n").replace(/\\end\{abstract\}/g, "\n\n");
  s = s.replace(/\\item(?![A-Za-z])(?:\[[^\]]*\])?\s*/g, "\n- ");
  s = replaceCommand(s, Object.keys(HEADINGS), (name, arg) => `\n\n${HEADINGS[name]} ${arg.replace(/\\\\/g, " ").trim()}\n\n`);
  s = replaceCommand(s, ["footnote", "footnotetext"], (_, arg) => ` (${arg.trim()})`);
  s = s.replace(/\\href\{[^}]*\}\s*\{([^}]*)\}/g, "$1"); // \href{url}{text} → text
  s = replaceCommand(s, ["url", "path"], (_, arg) => arg);
  s = replaceCommand(s, DROP_WITH_ARG, () => null);
  // \begin{...} / \end{...} の残り(itemize, theorem, proof など)は環境名だけ落として中身を残す
  s = s.replace(/\\(?:begin|end)\{[^}]*\}(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, "\n");

  // アクセント: \'e {\'e} \"{o} \c{c} → e o c
  s = s.replace(/\\[`'^"~=.uvHcdbt]\s*\{?([A-Za-z])\}?/g, "$1").replace(/\\(?:ae|oe|aa|ss|o|l|i|j)(?![A-Za-z])/g, (m) => m.slice(1));
  // 残った \cmd{arg}(\textbf, \emph, \mathrm, 自作マクロなど)は中身だけ残す。入れ子のため数回
  const passthrough = /\\[A-Za-z]+\*?(?:\[[^\]]*\])*\s*\{/;
  for (let i = 0; i < 4 && passthrough.test(s); i++) s = replaceCommand(s, ["[A-Za-z]+\\*?"], (_, arg) => arg).replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])*\s*\{/g, "{");
  s = s.replace(/\\(?:ldots|dots|cdots)(?![A-Za-z])/g, "…").replace(/\\\\(?:\[[^\]]*\])?/g, "\n").replace(/\\(?:newline|linebreak|par|noindent|maketitle|centering|hfill|hline|toprule|midrule|bottomrule|smallskip|medskip|bigskip|clearpage|newpage|relax|small|large|Large|footnotesize|scriptsize|tiny|normalsize|bf|it|em|rm|tt|sc|sl|indent|and|qquad|quad|left|right|,|;|!|:)(?![A-Za-z])/g, " ");
  // 残ったコマンドは落とす(\alpha, \tHalf など)。\% \& \_ \# \$ \{ \} は文字に戻す
  s = s.replace(/\\([%&_#$])/g, "$1").replace(/\\[{}]/g, "").replace(/\\[A-Za-z@]+\*?/g, "").replace(/\\(\s|$)/g, "$1");
  s = s.replace(/[{}]/g, "").replace(/~/g, " ");
  s = s.replace(/``|''/g, '"').replace(/`/g, "'").replace(/---/g, "—").replace(/--/g, "–");

  // TeX の 1 行改行は段落内の折り返し。段落の切れ目(空行)だけ残す
  s = s
    .split(/\n[ \t]*\n+/)
    .map((para) => para.replace(/[ \t]*\n[ \t]*/g, (m, off, str) => (/^\s*(#|-\s)/.test(str.slice(off + m.length, off + m.length + 6)) ? "\n" : " ")).replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  // 箇条書きは項目の間を空けない
  return s.replace(/\n\n(- )/g, "\n$1").replace(/ +([,.;:)])/g, "$1").replace(/\( /g, "(").trim();
}

/** 取り下げ(withdrawn)の断り書きだけ、といった本文になっていないもの */
export function looksLikeStub(text: string): boolean {
  return text.length < 800 || /^(this|the) (paper|article|manuscript) (has been|is|was) withdrawn/i.test(text.slice(0, 400));
}
