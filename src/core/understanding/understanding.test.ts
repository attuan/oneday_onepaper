import { describe, expect, it } from "vitest";
import type { GradeOutput } from "@/core/types";
import { newPaper } from "@/core/papers/queue";
import { asHandoffPrompt, buildQuestionsRequest, calibrationGap, calibrationSeries, emptyRecord, parseAnswer, parseQuestions, stages, verdictOf, type UnderstandingRecord } from "./index";

const grade = (scores: number[]): GradeOutput => ({ items: scores.map((score, i) => ({ name: `i${i}`, score, comment: "" })), total: scores.reduce((a, b) => a + b, 0), overall_comment: "" });
const attempt = (score: number) => ({ answer: "a", score, verdict: verdictOf(score), feedback: "", at: "2026-10-09T00:00:00Z" });

describe("stages", () => {
  it("質問が無ければ質問後はメモの点のまま", () => {
    const s = stages(null, grade([3, 2, 4, 1]));
    expect(s).toEqual({ self: null, memo: [3, 2, 4, 1], after: [3, 2, 4, 1], asked: [false, false, false, false] });
  });
  it("聞かれた項目は最後の答えの点で置き換え、同じ項目の 2 問は平均", () => {
    const rec: UnderstandingRecord = {
      ...emptyRecord("p"),
      self: [5, 5, 5, 5],
      questions: [
        { q: { axis: 1, question: "q1", look_for: "" }, attempts: [attempt(2), attempt(5)] },
        { q: { axis: 3, question: "q2", look_for: "" }, attempts: [attempt(2)] },
        { q: { axis: 3, question: "q3", look_for: "" }, attempts: [attempt(3)] },
        { q: { axis: 0, question: "まだ答えていない", look_for: "" }, attempts: [] },
      ],
    };
    const s = stages(rec, grade([3, 2, 4, 1]));
    expect(s.after).toEqual([3, 5, 4, 2.5]);
    expect(s.asked).toEqual([false, true, false, true]);
    expect(s.self).toEqual([5, 5, 5, 5]);
  });
});

describe("calibration", () => {
  it("自己評価が高いと正", () => {
    expect(calibrationGap([4, 4, 4, 4], grade([3, 2, 4, 1]))).toBe(6);
  });
  it("自己評価のある論文だけを古い順に", () => {
    const papers = [newPaper({ title: "A", id: "a" }, [], "t"), newPaper({ title: "B", id: "b" }, [], "t")];
    const rows = [
      { rec: { ...emptyRecord("b"), self: [2, 2, 2, 2], self_at: "2026-10-02" }, grade: grade([3, 3, 3, 3]) },
      { rec: { ...emptyRecord("a"), self: [5, 5, 5, 5], self_at: "2026-10-01" }, grade: grade([3, 3, 3, 3]) },
      { rec: { ...emptyRecord("c"), self_skipped: true }, grade: grade([3, 3, 3, 3]) },
    ];
    expect(calibrationSeries(rows, papers).map((p) => [p.title, p.gap])).toEqual([["A", 8], ["B", -4]]);
  });
});

describe("parse", () => {
  it("質問は 3 問まで、項目番号が外れたものは捨てる", () => {
    const text = JSON.stringify({ questions: [{ axis: 1, question: "なぜ?", look_for: "x" }, { axis: 9, question: "bad", look_for: "" }, { axis: "2", question: " b ", look_for: "" }, { axis: 0, question: "c", look_for: "" }, { axis: 3, question: "d", look_for: "" }] });
    expect(parseQuestions(text).map((q) => [q.axis, q.question])).toEqual([[1, "なぜ?"], [2, "b"], [0, "c"]]);
  });
  it("質問が無ければエラー", () => {
    expect(() => parseQuestions('{"questions": []}')).toThrow();
  });
  it("答えの点は 1〜5 に丸め、判定は点から決める", () => {
    expect(parseAnswer('```json\n{"score": 7, "feedback": " よい "}\n```', "ans")).toMatchObject({ answer: "ans", score: 5, verdict: "ok", feedback: "よい" });
    expect(parseAnswer('{"score": 3, "feedback": ""}', "a").verdict).toBe("partial");
    expect(parseAnswer('{"score": 0}', "a")).toMatchObject({ score: 1, verdict: "miss" });
  });
});

describe("prompts", () => {
  it("貼り付け用のプロンプトに質問の材料と JSON の形が入る", () => {
    const p = newPaper({ title: "Paper T", id: "t" }, [], "t");
    const req = buildQuestionsRequest(p, "[アブストラクト]\nabs", "メモ本文", { ...grade([1, 2, 3, 4]), missing_points: ["抜け X"] }, "ja");
    const text = asHandoffPrompt(req, "questions");
    for (const s of ["Paper T", "abs", "メモ本文", "抜け X", "メモの点 1/5", '"questions"']) expect(text).toContain(s);
  });
});
