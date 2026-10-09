import { describe, expect, it } from "vitest";
import type { Memo, Paper } from "@/core/types";
import { newProposal, normalizeProposal } from "./model";
import { buildQuestionPrompt, buildQuestionRequest, normalizeQuestions, parseQuestionAnswer, questionForCoach, questionMaterial, toExploreCandidate } from "./explore";
import { buildCoachRequest } from "./coach";

const cand = (id: string, title: string, abstract: string | null = "An abstract.") => toExploreCandidate({ id, title, authors: ["A Author"], year: 2020, abstract, cited_by: 3, reason: "" });

function withCandidates() {
  const p = newProposal("thesis", { curiosity: "SNS のデマはなぜ広がるのか" }, new Date("2026-10-09T00:00:00Z"));
  p.exploration.candidates = [cand("10.1/x", "Spread of false news"), cand("10.1/y", "Correction effects"), cand("10.1/z", "No abstract", null)];
  return p;
}

const readPaper = { id: "10.1/r", title: "Read one", authors: ["R"], year: 2019, status: "read", added_at: "1" } as Paper;
const memo: Memo = { path: "", body: "## ひとこと\n訂正は効きにくい", frontmatter: { paper_id: "10.1/r", date: "2026-10-01", chars: 9, completed: true, level: 1, summary_input: "none", score_total: null } };

describe("問いの材料", () => {
  it("印が無ければ候補の上から、読んだ論文はメモつきで、P 番号で渡す", () => {
    const m = questionMaterial(withCandidates(), [readPaper], [memo]);
    expect([...m.refs.entries()]).toEqual([["P1", "10.1/x"], ["P2", "10.1/y"], ["P3", "10.1/z"], ["P4", "10.1/r"]]);
    expect(m.text).toContain("[P3] No abstract");
    expect(m.text).toContain("アブストなし");
    expect(m.text).toContain("本人のメモ: ひとこと 訂正は効きにくい");
  });

  it("印を付けたものだけを候補として渡す", () => {
    const p = withCandidates();
    p.exploration.picked = ["10.1/y"];
    expect([...questionMaterial(p, [], []).refs.values()]).toEqual(["10.1/y"]);
  });

  it("関心と一覧が頼む文面に入る", () => {
    const { request } = buildQuestionRequest(withCandidates(), [], [], "ja");
    expect(request.user).toContain("[学生の関心] SNS のデマはなぜ広がるのか");
    expect(request.user).toContain("[P2] Correction effects");
  });
});

describe("問いの候補を読む", () => {
  const refs = new Map([["P1", "10.1/x"], ["P2", "10.1/y"]]);

  it("P 番号を ID に戻し、一覧に無い番号と空の問いを捨てる", () => {
    const qs = normalizeQuestions(
      { questions: [{ question: "訂正はどれくらい効くか?", why: "w", unknown: "u", approach: "a", refs: ["P2", "p1", "P9", "P2"], first_read: "[P2]" }, { question: "  ", refs: [] }, { question: "Q2", refs: ["P7"], first_read: "P7" }] },
      refs,
    );
    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ question: "訂正はどれくらい効くか?", paper_ids: ["10.1/y", "10.1/x"], first_read: "10.1/y" });
    expect(qs[1]).toMatchObject({ paper_ids: [], first_read: null });
  });

  it("貼り戻したものを読む。プロンプトのままや空は断る", () => {
    const { prompt } = buildQuestionPrompt(withCandidates(), [], [], "ja");
    expect(() => parseQuestionAnswer(prompt, refs)).toThrow(/プロンプトのまま/);
    expect(() => parseQuestionAnswer('{"questions": []}', refs)).toThrow(/見つかりません/);
    expect(parseQuestionAnswer('はい\n```json\n{"questions":[{"question":"Q?","refs":["P1"],"first_read":"P1"}]}\n```', refs)[0].first_read).toBe("10.1/x");
  });
});

describe("自分の問い", () => {
  it("自分の言葉で書いたものを優先し、節を見るときの前提に入れる", () => {
    const p = withCandidates();
    expect(questionForCoach(p)).toBe("");
    p.exploration.questions = [{ id: "q1", question: "AI の問い?", why: "", unknown: "", approach: "", paper_ids: [], first_read: null }];
    p.exploration.chosen = "q1";
    expect(questionForCoach(p)).toContain("AI が出した候補から本人が選んだもの");
    p.exploration.my_question = "自分の問い";
    expect(questionForCoach(p)).toBe("自分の問い");
    p.sections[0].body = "背景を書いた。".repeat(5);
    expect(buildCoachRequest(p, p.sections[0].id, [], [], "ja").user).toContain("[本人の問い] 自分の問い");
  });

  it("はじめの一歩を入れる前のファイルも開ける", () => {
    const p = normalizeProposal({ id: "old", title: "t" } as never);
    expect(p.exploration).toMatchObject({ curiosity: "", candidates: [], chosen: null });
  });
});
