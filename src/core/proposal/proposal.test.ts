import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import type { Memo, Paper, Proposal } from "@/core/types";
import { referenceText, bodyBlocks, checkProposal, citeKeys, defaultScheduleRows, insertCitationAfter, memoQuestions, newProposal, normalizeProposal, numberCitations, papersByKey, renderCitations, sectionChars } from "./model";
import { ganttSvg, mapSvg } from "./figures";
import { buildDocx } from "./docx";
import { buildLatex, buildLatexZip, escTex } from "./latex";
import { buildCoachPrompt, buildCoachRequest, normalizeCoach, parseCoachAnswer } from "./coach";
import { classify } from "@/core/archive";

const paper = (id: string, title: string, authors: string[], year: number, added: string, extra: Partial<Paper> = {}): Paper => ({
  id,
  title,
  authors,
  year,
  venue: null,
  doi: null,
  url: null,
  pdf_url: null,
  abstract: null,
  reason: null,
  source: "manual",
  status: "read",
  queue_order: 0,
  added_at: added,
  read_at: null,
  skip_count: 0,
  bibtex: null,
  fulltext_tokens: null,
  ...extra,
});

const PAPERS = [
  paper("a", "Attention Is All You Need", ["Ashish Vaswani", "Noam Shazeer"], 2017, "2026-09-01T00:00:00Z", { venue: "NeurIPS", doi: "10.5555/attn" }),
  paper("b", "Deep Residual Learning", ["Kaiming He"], 2016, "2026-09-02T00:00:00Z"),
  paper("c", "Attention Is Not Explanation", ["Sarthak Vaswani"], 2017, "2026-09-03T00:00:00Z"),
];

function sample(): Proposal {
  const p = newProposal("thesis", { title: "注意機構の解釈 & 評価", purpose: "卒研の着手時に研究室へ" }, new Date("2026-10-09T00:00:00Z"));
  p.author = "山田 太郎";
  p.sections[0].body = "Transformer は広く使われている[@vaswani2017attention]。\n\n- 解釈が難しい[@vaswani2017attentiona; @he2016deep]\n- **重要**な課題である";
  p.sections[1].body = "注意の重みが説明になるかを確かめる[@nobody2020x]。";
  return p;
}

describe("引用キー", () => {
  it("追加した順に割り当て、重なれば a, b を付ける", () => {
    const keys = citeKeys(PAPERS);
    expect(keys.get("a")).toBe("vaswani2017attention");
    expect(keys.get("c")).toBe("vaswani2017attentiona");
    expect(keys.get("b")).toBe("he2016deep");
  });

  it("出てきた順に番号を付け、リストに無いキーは unknown にする", () => {
    const p = sample();
    const { numbers, ordered, unknown } = numberCitations(p, papersByKey(PAPERS));
    expect(ordered.map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(unknown).toEqual(["nobody2020x"]);
    expect(renderCitations(p.sections[0].body, numbers)).toContain("[2, 3]");
    expect(renderCitations(p.sections[1].body, numbers)).toContain("[?]");
  });

  it("文の句点の前に引用を入れる", () => {
    expect(insertCitationAfter("A です。B です。", "A です。", "k")).toBe("A です[@k]。B です。");
    expect(insertCitationAfter("A です。", "無い文", "k")).toBeNull();
  });
});

describe("字数と本文", () => {
  it("空白・記号を除き、引用は [1] として数える", () => {
    expect(sectionChars("あい う\n\n- え **お**[@x]")).toBe("あいうえお[1]".length);
  });

  it("段落と箇条書きに分ける", () => {
    expect(bodyBlocks("一行目\n二行目\n\n- い\n・ろ\n後ろ")).toEqual([
      { kind: "para", text: "一行目\n二行目" },
      { kind: "bullet", text: "い" },
      { kind: "bullet", text: "ろ" },
      { kind: "para", text: "後ろ" },
    ]);
  });

  it("書き出す前の確認", () => {
    const p = sample();
    p.sections[0].limit = 10;
    const c = checkProposal(p, papersByKey(PAPERS));
    expect(c.unknownKeys).toEqual(["nobody2020x"]);
    expect(c.overLimit[0].heading).toBe("研究の背景");
    expect(c.empty).toContain("研究の方法");
  });

  it("欠けたファイルでも開ける", () => {
    const p = normalizeProposal({ id: "x", title: "t", sections: [{ id: "s", heading: "h", body: "b" }] } as never);
    expect(p.sections[0].limit).toBeNull();
    expect(p.map.points.some((m) => m.paper_id === null)).toBe(true);
  });
});

describe("メモの疑問", () => {
  it("「疑問・批判」の節だけを拾う", () => {
    const memo = (paper_id: string, body: string): Memo => ({ path: "", body, frontmatter: { paper_id, date: "2026-10-01", chars: 0, completed: true, level: 3, summary_input: "none", score_total: null } });
    const qs = memoQuestions(PAPERS, [memo("a", "# t\n\n## 疑問・批判\n\n長い文では?\n\n## 次\nx"), memo("b", "## 疑問・批判\n\n"), memo("c", "## 疑問・批判\n最後の節")]);
    expect(qs.map((q) => q.text)).toEqual(["長い文では?", "最後の節"]);
  });
});

describe("図", () => {
  it("ガントチャートは読める行だけ描く", () => {
    expect(ganttSvg([{ id: "1", label: "x", start: "", end: "" }])).toBeNull();
    const g = ganttSvg(defaultScheduleRows("2026-10-09"))!;
    expect(g.svg).toContain("文献調査");
    expect(g.svg.match(/<rect [^>]*fill="#1e5fb8"/g)).toHaveLength(4);
  });

  it("マップはラベルをエスケープする", () => {
    const p = sample();
    p.map.points.push({ id: "m2", paper_id: "a", label: "A<&>", x: 0.2, y: 0.3 });
    expect(mapSvg(p.map).svg).toContain("A&lt;&amp;&gt;");
  });
});

const TINY_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

describe("Word", () => {
  it("見出し・番号つき引用・参考文献・図が入る", () => {
    const p = sample();
    p.schedule.enabled = true;
    const files = unzipSync(buildDocx(p, papersByKey(PAPERS), { schedule: { png: TINY_PNG, width: 720, height: 200 } }));
    const doc = new TextDecoder().decode(files["word/document.xml"]);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "word/styles.xml", "word/_rels/document.xml.rels", "word/media/figure1.png"]));
    expect(doc).toContain("注意機構の解釈 &amp; 評価");
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
    expect(doc).toContain("広く使われている[1]。");
    expect(doc).toContain("・解釈が難しい[2, 3]");
    expect(doc).toContain("<w:b/>");
    expect(doc).toContain("図 1　研究スケジュール");
    expect(doc).toContain("Ashish Vaswani, Noam Shazeer. Attention Is All You Need. NeurIPS. 2017. https://doi.org/10.5555/attn");
    expect(referenceText({ ...PAPERS[0], authors: ["A", "B", "C", "D"] })).toBe("A, B, C, et al. Attention Is All You Need. NeurIPS. 2017. https://doi.org/10.5555/attn");
    // 図は「研究計画」の節の後ろ
    expect(doc.indexOf("figure1.png")).toBeGreaterThan(doc.indexOf(">研究計画<"));
    expect(doc.indexOf("figure1.png")).toBeLessThan(doc.indexOf(">期待される成果<"));
  });

  it("図を出さない設定なら画像を入れない", () => {
    const files = unzipSync(buildDocx(sample(), papersByKey(PAPERS), { schedule: { png: TINY_PNG, width: 720, height: 200 } }));
    expect(files["word/media/figure1.png"]).toBeUndefined();
  });
});

describe("LaTeX", () => {
  it("エスケープ・\\cite・参考文献", () => {
    const { tex, bib } = buildLatex(sample(), papersByKey(PAPERS));
    expect(tex).toContain("\\title{注意機構の解釈 \\& 評価}");
    expect(tex).toContain("\\cite{vaswani2017attentiona,he2016deep}");
    expect(tex).toContain("\\textbf{重要}");
    expect(tex).toContain("確かめる[?]");
    expect(tex).toContain("\\begin{itemize}");
    expect(bib).toContain("@article{vaswani2017attention,");
    expect(bib).toContain("@misc{vaswani2017attentiona,");
    expect(escTex("100% a_b \\x ~")).toBe("100\\% a\\_b \\textbackslash{}x \\textasciitilde{}");
  });

  it("書誌情報から作るエントリは TeX の記号を逃がし、アブストラクトを落とす。リストに無いキーは [?] を残す", () => {
    const ps = [paper("x", "Fast & Cheap_Models at 50%", ["A B"], 2020, "1", { abstract: "uses $x$ & y" })];
    const p = sample();
    p.sections = [{ ...p.sections[0], body: "x[@b2020fast; @nobody]" }];
    const { tex, bib } = buildLatex(p, papersByKey(ps));
    expect(tex).toContain("\\cite{b2020fast}[?]");
    expect(bib).toContain("title = {{Fast \\& Cheap\\_Models at 50\\%}}");
    expect(bib).not.toContain("abstract");
    expect(bib.trim().endsWith("}\n}") || bib.trim().endsWith("}")).toBe(true);
    expect(bib).not.toMatch(/,\n\}/);
  });

  it("取り込んだ BibTeX のキーを計画書のキーに揃える", () => {
    const ps = [{ ...PAPERS[1], bibtex: "@article{orig_key,\n  title = {Deep Residual Learning}\n}" }];
    const p = sample();
    p.sections = [{ ...p.sections[0], body: "x[@he2016deep]" }];
    expect(buildLatex(p, papersByKey(ps)).bib).toContain("@article{he2016deep,");
  });

  it("引用が無ければ参考文献を出さず、ZIP に refs.bib を入れない", () => {
    const p = newProposal("blank", {}, new Date());
    p.sections[0].body = "本文";
    const files = unzipSync(buildLatexZip(p, papersByKey(PAPERS)));
    expect(Object.keys(files)).toEqual(["main.tex"]);
    expect(new TextDecoder().decode(files["main.tex"])).not.toContain("\\bibliography");
  });
});

describe("AI のコメント", () => {
  const known = new Set(papersByKey(PAPERS).keys());
  const body = "Transformer は広く使われている。解釈は難しい。";

  it("手元に無いキー・本文に無い文・引用済みの論文を落とす", () => {
    const fb = normalizeCoach(
      {
        good_points: ["a", "b", "c", "d"],
        missing_points: ["x"],
        questions: [],
        needs_citation: [
          { sentence: "Transformer は広く使われている。", keys: ["vaswani2017attention", "made2099up"] },
          { sentence: "本文に無い文です。", keys: [] },
        ],
        suggested: [{ key: "he2016deep", reason: "r" }, { key: "made2099up", reason: "r" }, { key: "he2016deep", reason: "dup" }],
        next_step: "n",
      },
      known,
      body,
    );
    expect(fb.good_points).toHaveLength(3);
    expect(fb.needs_citation).toEqual([{ sentence: "Transformer は広く使われている。", keys: ["vaswani2017attention"] }]);
    expect(fb.suggested).toEqual([{ key: "he2016deep", reason: "r" }]);
    expect(fb.body_seen).toBe(body);
  });

  it("頼む文面には節と手元の論文が入り、貼り戻したものを読める", () => {
    const p = sample();
    const req = buildCoachRequest(p, p.sections[0].id, PAPERS, [], "ja");
    expect(req.user).toContain("key=he2016deep");
    expect(req.user).toContain("[見てほしい節] 研究の背景");
    const prompt = buildCoachPrompt(p, p.sections[0].id, PAPERS, [], "ja");
    expect(() => parseCoachAnswer(prompt, known, body)).toThrow(/頼む文面のまま/);
    const fb = parseCoachAnswer('はい。\n```json\n{"good_points":["よい"],"missing_points":[],"questions":["なぜ?"],"needs_citation":[],"suggested":[],"next_step":"次"}\n```', known, body);
    expect(fb.questions).toEqual(["なぜ?"]);
  });
});

describe("書き出しの ZIP", () => {
  it("proposals/*.json を受け付ける", () => {
    expect(classify("proposals/p1.json")).toBe("proposal");
    expect(classify("proposals/x.md")).toBeNull();
  });
});
