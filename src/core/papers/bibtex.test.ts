import { describe, expect, it } from "vitest";
import { bibtexToPapers, citationKey, cleanValue, paperToBibtex, papersToBibtex, parseBibtex, splitAuthors } from "./bibtex";
import { newPaper } from "./queue";

const SAMPLE = `
% comment line
@comment{ignored}
@string{nips = "NeurIPS"}

@inproceedings{vaswani2017attention,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  booktitle = {Advances in Neural Information Processing Systems},
  year = 2017,
  url = "https://arxiv.org/abs/1706.03762",
  eprint = {1706.03762},
  archivePrefix = {arXiv},
  abstract = {The dominant sequence transduction models {are} based on complex recurrent
    or convolutional neural networks.}
}

@article(he2016deep,
  title={Deep Residual Learning for {Image} Recognition},
  author={Kaiming He and Xiangyu Zhang},
  journal={CVPR},
  year={2016},
  doi={https://doi.org/10.1109/CVPR.2016.90},
  note={読むべき理由}
)

@misc{notitle, author = {X}}
`;

describe("parseBibtex", () => {
  it("エントリを読み、コメントと @string は飛ばす", () => {
    const { entries, errors } = parseBibtex(SAMPLE);
    expect(errors).toEqual([]);
    expect(entries.map((e) => `${e.type}:${e.key}`)).toEqual(["inproceedings:vaswani2017attention", "article:he2016deep", "misc:notitle"]);
    expect(entries[0].fields.year).toBe("2017");
    expect(entries[0].fields.url).toBe("https://arxiv.org/abs/1706.03762");
    expect(entries[0].fields.archiveprefix).toBe("arXiv"); // フィールド名は小文字に
    expect(entries[0].raw.startsWith("@inproceedings{vaswani2017attention")).toBe(true);
    expect(entries[0].raw.endsWith("}")).toBe(true);
  });
  it("閉じていないエントリはエラー", () => {
    const { entries, errors } = parseBibtex("@article{a, title={x}");
    expect(entries).toEqual([]);
    expect(errors[0]).toMatch(/閉じ括弧/);
  });
});

describe("値の整形", () => {
  it("中括弧・TeX の飾り・改行を落とす", () => {
    expect(cleanValue("Deep Residual Learning for {Image} Recognition")).toBe("Deep Residual Learning for Image Recognition");
    expect(cleanValue("Sch\\\"{o}n and \\textit{fast}\n  nets")).toBe("Schon and fast nets");
  });
  it("著者を First Last に揃える", () => {
    expect(splitAuthors("Vaswani, Ashish and Shazeer, Noam")).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(splitAuthors("Kaiming He and Xiangyu Zhang")).toEqual(["Kaiming He", "Xiangyu Zhang"]);
    expect(splitAuthors("{van der Berg}, Jan")).toEqual(["Jan van der Berg"]);
    expect(splitAuthors("山田 太郎 AND Smith, John")).toEqual(["山田 太郎", "John Smith"]);
  });
});

describe("bibtexToPapers", () => {
  it("Paper の列に対応づけ、arXiv の PDF と DOI を補う", () => {
    const { papers, errors } = bibtexToPapers(SAMPLE);
    expect(errors).toEqual(["title がありません: @misc{notitle}"]);
    expect(papers).toHaveLength(2);
    const [a, b] = papers;
    expect(a.title).toBe("Attention Is All You Need");
    expect(a.authors).toEqual(["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"]);
    expect(a.venue).toBe("Advances in Neural Information Processing Systems");
    expect(a.year).toBe(2017);
    expect(a.pdf_url).toBe("https://arxiv.org/pdf/1706.03762");
    expect(a.url).toBe("https://arxiv.org/abs/1706.03762");
    expect(a.abstract).toBe("The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.");
    expect(a.source).toBe("import");
    expect(a.bibtex).toContain("@inproceedings{vaswani2017attention");
    expect(b.doi).toBe("10.1109/CVPR.2016.90");
    expect(b.venue).toBe("CVPR");
    expect(b.reason).toBe("読むべき理由");
    expect(b.url).toBeNull();
  });
  it("空なら分かるエラー", () => {
    expect(bibtexToPapers("nothing here").errors).toEqual(["BibTeX のエントリが見つかりませんでした"]);
  });
});

describe("書き出し", () => {
  it("引用キーは 姓+年+最初の語 を ASCII で", () => {
    expect(citationKey({ authors: ["Ashish Vaswani"], year: 2017, title: "Attention Is All You Need" })).toBe("vaswani2017attention");
    expect(citationKey({ authors: ["Müller, Kai"], year: null, title: "The Ölçüm of things" })).toBe("mullerolcum");
    expect(citationKey({ authors: [], year: 2020, title: "" })).toBe("anon2020");
  });
  it("bibtex 列があればそのまま、無ければ生成する", () => {
    const kept = newPaper({ title: "T", bibtex: "@misc{k, title={T}}" }, [], "t");
    expect(paperToBibtex(kept)).toBe("@misc{k, title={T}}");
    const gen = newPaper({ title: "Deep Residual Learning", authors: ["Kaiming He", "Xiangyu Zhang"], year: 2016, venue: "CVPR", doi: "10.1109/CVPR.2016.90", abstract: "a {b}" }, [], "t");
    expect(paperToBibtex(gen)).toBe(
      [
        "@article{he2016deep,",
        "  title = {{Deep Residual Learning}},", // 二重の中括弧は大文字小文字を守るための BibTeX の慣習
        "  author = {He, Kaiming and Zhang, Xiangyu},",
        "  year = {2016},",
        "  journal = {CVPR},",
        "  doi = {10.1109/cvpr.2016.90},",
        "  url = {https://doi.org/10.1109/cvpr.2016.90},",
        "  abstract = {a b}",
        "}",
      ].join("\n"),
    );
  });
  it("arXiv の DOI は eprint にし、会議名は booktitle にする", () => {
    const p = newPaper({ title: "Attention", authors: ["Ashish Vaswani"], year: 2017, venue: "Proceedings of NeurIPS", doi: "10.48550/arXiv.1706.03762" }, [], "t");
    const b = paperToBibtex(p);
    expect(b.startsWith("@inproceedings{vaswani2017attention,")).toBe(true);
    expect(b).toContain("booktitle = {Proceedings of NeurIPS}");
    expect(b).toContain("eprint = {1706.03762}");
    expect(b).toContain("archiveprefix = {arXiv}");
    expect(b).not.toContain("url =");
  });
  it("複数件はキーが重ならないようにする。往復で同じ内容が読める", () => {
    const p1 = newPaper({ title: "Same Title", authors: ["A B"], year: 2020 }, [], "t");
    const p2 = newPaper({ title: "Same Title", authors: ["A B"], year: 2020 }, [], "t");
    const text = papersToBibtex([p1, p2]);
    expect(text).toContain("@misc{b2020same,");
    expect(text).toContain("@misc{b2020samea,");
    const back = bibtexToPapers(text).papers;
    expect(back.map((p) => p.title)).toEqual(["Same Title", "Same Title"]);
    expect(back[0].authors).toEqual(["A B"]);
  });
});
