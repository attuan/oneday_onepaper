import { describe, expect, it } from "vitest";
import { alreadyListed, buildChatPapersPrompt, buildHandoffPrompt, buildRankPrompt, buildRecommendPrompt, handoffReturnPaperId, handoffReturnUrl, parseChatPapersAnswer, parseHandoffResult, parseRankAnswer, parseRecommendAnswer, shortcutRunUrl } from "./handoff";
import { newPaper } from "@/core/papers/queue";

const paper = newPaper({ title: "Attention Is All You Need", id: "10.1/x y", authors: ["Vaswani"] }, [], "t");

describe("buildHandoffPrompt", () => {
  it("論文・メモ・返す形が入る", () => {
    const p = buildHandoffPrompt({ paper, text: "We propose the Transformer.", inputKind: "abstract" }, "注意機構だけで翻訳", "ja");
    expect(p).toContain("Attention Is All You Need");
    expect(p).toContain("We propose the Transformer.");
    expect(p).toContain("注意機構だけで翻訳");
    expect(p).toContain('"limitations"');
    expect(p).toContain("misreadings");
  });
});

describe("parseHandoffResult", () => {
  const summary = { problem: "p", method: "m", results: "r", limitations: "l" };
  it("要約と採点。点は 1〜5 に丸め、合計は数え直す", () => {
    const text = "```json\n" + JSON.stringify({ summary, grade: { items: [{ name: "a", score: 9, comment: "c" }, { name: "b", score: 2, comment: "" }], total: 99, overall_comment: "o" } }) + "\n```";
    const r = parseHandoffResult(text, "");
    expect(r.summary).toEqual({ ...summary, evidence: [] });
    expect(r.grade?.items.map((i) => i.score)).toEqual([5, 2]);
    expect(r.grade?.total).toBe(7);
    expect(r.grade?.missing_points).toEqual([]);
  });
  it("要約だけ・包まれていない・欠けた項目は「不明」", () => {
    const r = parseHandoffResult('はい。{"problem":"p","method":"m","evidence":[{"field":"method","quote":"based solely on  attention"},{"field":"method","quote":"made up sentence"}]}', "The Transformer is based solely on\nattention mechanisms.");
    expect(r.summary).toEqual({ problem: "p", method: "m", results: "不明", limitations: "不明", evidence: [{ field: "method", quote: "based solely on  attention", found: true }, { field: "method", quote: "made up sentence", found: false }] });
    expect(r.grade).toBeNull();
  });
  it("要約が無ければエラー", () => {
    expect(() => parseHandoffResult('{"foo":1}', "")).toThrow(/要約が見つかりません/);
    expect(() => parseHandoffResult("ただの文章", "")).toThrow();
    expect(() => parseHandoffResult(" ", "")).toThrow(/空/);
    const prompt = buildHandoffPrompt({ paper, text: "x", inputKind: "abstract" }, "m", "ja");
    expect(() => parseHandoffResult(prompt, "")).toThrow(/プロンプトのまま/);
    expect(() => parseHandoffResult('{"summary": {"problem": "p"', "")).toThrow(/途中で切れて/);
    expect(() => parseHandoffResult("[1]", "")).toThrow(/要約が見つかりません/);
  });
});

describe("ショートカットの URL", () => {
  it("戻り先は今のページ + 論文 ID。往復で取り出せる", () => {
    const back = handoffReturnUrl("https://u.github.io/repo/?old=1#x", paper.id);
    expect(back).toBe("https://u.github.io/repo/?ai_return=10.1%2Fx+y");
    expect(handoffReturnPaperId(back)).toBe("10.1/x y");
    expect(handoffReturnPaperId("https://u.github.io/repo/")).toBeNull();
  });
  it("名前と戻り先を載せる", () => {
    const u = shortcutRunUrl("One Day", "https://a/b?ai_return=1");
    expect(u.startsWith("shortcuts://x-callback-url/run-shortcut?name=One%20Day&x-success=https%3A%2F%2Fa%2Fb%3Fai_return%3D1")).toBe(true);
  });
});

describe("論文を探す: 貼り付けでのクエリ生成と順位付け", () => {
  const cands = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];
  it("クエリ: プロンプトにキーワードと返す形。回答はフェンス付きでも読む", () => {
    const p = buildRecommendPrompt("RAG 評価", "修論", "ja", true);
    expect(p).toContain("RAG 評価");
    expect(p).toContain("queries_ja");
    expect(parseRecommendAnswer('どうぞ\n```json\n{"queries":["rag evaluation"," "],"queries_ja":["検索拡張生成"]}\n```', p)).toEqual({ queries: ["rag evaluation"], queries_ja: ["検索拡張生成"] });
  });
  it("クエリ: プロンプトのまま・空は断る", () => {
    const p = buildRecommendPrompt("x", "", "ja", false);
    expect(() => parseRecommendAnswer(p, p)).toThrow("プロンプトのまま");
    expect(() => parseRecommendAnswer('{"queries":[]}', p)).toThrow("見つかりません");
  });
  it("順位: 知らない id は捨て、抜けた候補は末尾に", () => {
    const p = buildRankPrompt(cands, "目的", "基準", "ja");
    expect(p).toContain("id=b");
    const r = parseRankAnswer('{"items":[{"id":"c","rank":1,"reason":"r1"},{"id":"zzz","rank":2,"reason":"x"},{"id":"a","rank":"3","reason":"r3"}]}', p, cands);
    expect(r.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(r[2].reason).toBe("");
  });
  it("順位: id が 1 つも合わなければ断る", () => {
    const p = buildRankPrompt(cands, "目的", "基準", "ja");
    expect(() => parseRankAnswer('{"items":[{"id":"1","rank":1,"reason":"r"}]}', p, cands)).toThrow("id が候補と合いません");
    expect(() => parseRankAnswer("ごめんなさい", p, cands)).toThrow("JSON として読めません");
  });
});

describe("AI チャットから論文を追加", () => {
  it("プロンプトに返す形が入る", () => {
    const p = buildChatPapersPrompt("ja");
    expect(p).toContain("ここまでの会話");
    expect(p).toContain('"arxiv_id"');
  });
  it("arXiv ID から DOI・URL・PDF を作る。null や「不明」は空にする", () => {
    const r = parseChatPapersAnswer("```json\n" + JSON.stringify({ papers: [{ title: "Attention Is All You Need", authors: ["Vaswani", "不明"], year: "2017年", venue: "null", doi: null, arxiv_id: "arXiv:1706.03762v5", url: null, reason: "Transformer の原典" }] }) + "\n```");
    expect(r).toEqual([{ title: "Attention Is All You Need", authors: ["Vaswani"], year: 2017, venue: null, doi: "10.48550/arxiv.1706.03762", url: "https://arxiv.org/abs/1706.03762", pdf_url: "https://arxiv.org/pdf/1706.03762", reason: "Transformer の原典", source: "import" }]);
  });
  it("配列だけでもよい。DOI は URL 形式でも読む。重複とタイトルの無いものは落とす。記事は記事として入る", () => {
    const r = parseChatPapersAnswer(JSON.stringify([
      { title: "Deep Residual Learning", authors: "He; Zhang", doi: "https://doi.org/10.1109/CVPR.2016.90" },
      { title: "deep residual learning!", doi: "10.1109/cvpr.2016.90" },
      { title: "" },
      { title: "Transformer 解説", kind: "article", url: "https://zenn.dev/x/articles/y?utm_source=a" },
    ]));
    expect(r.map((p) => [p.title, p.doi, p.authors])).toEqual([["Deep Residual Learning", "10.1109/cvpr.2016.90", ["He", "Zhang"]], ["Transformer 解説", undefined, undefined]]);
    expect(r[0].url).toBe("https://doi.org/10.1109/cvpr.2016.90");
    expect(r[1]).toMatchObject({ kind: "article", id: "url:https://zenn.dev/x/articles/y", source: "import" });
  });
  it("読めなければエラー", () => {
    expect(() => parseChatPapersAnswer(" ")).toThrow(/空/);
    expect(() => parseChatPapersAnswer(buildChatPapersPrompt("ja"))).toThrow(/プロンプトのまま/);
    expect(() => parseChatPapersAnswer('{"papers": []}')).toThrow(/論文が見つかりません/);
    expect(() => parseChatPapersAnswer('{"papers": [{"title": "a"')).toThrow(/途中で切れて/);
  });
  it("リストにあるかは DOI かタイトルで見る。日本語のタイトルどうしを取り違えない", () => {
    const papers = [newPaper({ title: "Attention Is All You Need", doi: "10.48550/arXiv.1706.03762" }, [], "t"), newPaper({ title: "深層学習入門" }, [], "t")];
    expect(alreadyListed({ title: "x", doi: "10.48550/arxiv.1706.03762" }, papers)).toBe(true);
    expect(alreadyListed({ title: "attention is all you need." }, papers)).toBe(true);
    expect(alreadyListed({ title: "深層学習入門" }, papers)).toBe(true);
    expect(alreadyListed({ title: "強化学習入門" }, papers)).toBe(false);
  });
});
