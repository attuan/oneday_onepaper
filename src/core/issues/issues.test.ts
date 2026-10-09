import { describe, expect, it } from "vitest";
import { newPaper } from "@/core/papers/queue";
import { applyProposals, buildGraph, currentView, emptyIssues, issuesForPrompt, layoutGraph, normalizeIssues, recallSeries, removeIssue, updateIssue, type AcceptedProposals, type IssuesFile } from "./model";
import { buildIssuesPrompt, buildIssuesRequest, issueRefs, parseIssueProposals } from "./llm";

const T1 = "2026-10-01T00:00:00Z";
const T2 = "2026-10-02T00:00:00Z";
const T3 = "2026-10-03T00:00:00Z";

function ids() {
  let n = 0;
  return () => `q${++n}`;
}

const none: AcceptedProposals = { links: [], new_issues: [] };

/** 論文 a が論点 q1 を立て、論文 b がそれを支持した台帳 */
function seeded(): IssuesFile {
  const f1 = applyProposals(emptyIssues(), "a", { ...none, new_issues: [{ question: "注意機構は長い系列に効くか?", stance: "raises", note: "n", in_memo: true, view: "効くらしい", use: true }] }, T1, ids());
  return applyProposals(f1, "b", { ...none, links: [{ issue_id: "q1", stance: "supports", note: "長さ 4k で改善", in_memo: false, new_view: "4k までは効く", use: true, useView: true }] }, T2, ids());
}

describe("applyProposals", () => {
  it("新しい論点を立て、既存の論点につなぎ、理解を更新する", () => {
    const f = seeded();
    expect(f.issues).toHaveLength(1);
    expect(f.issues[0].views.map((v) => [v.paper_id, v.text])).toEqual([["a", "効くらしい"], ["b", "4k までは効く"]]);
    expect(currentView(f.issues[0])).toBe("4k までは効く");
    expect(f.links.map((l) => [l.paper_id, l.stance, l.existed, l.in_memo])).toEqual([["a", "raises", false, true], ["b", "supports", true, false]]);
  });
  it("選ばなかった提案・理解の書き換えは入れない。同じ論文でやり直したら置き換える", () => {
    const f = applyProposals(seeded(), "b", { ...none, links: [{ issue_id: "q1", stance: "challenges", note: "やり直し", in_memo: true, new_view: "効かない", use: true, useView: false }] }, T3, ids());
    expect(f.links.filter((l) => l.paper_id === "b").map((l) => [l.stance, l.note, l.existed])).toEqual([["challenges", "やり直し", true]]);
    expect(currentView(f.issues[0])).toBe("4k までは効く");
    const g = applyProposals(seeded(), "c", { links: [{ issue_id: "q1", stance: "challenges", note: "x", in_memo: true, new_view: "", use: false, useView: false }], new_issues: [{ question: "q", stance: "raises", note: "", in_memo: false, view: "", use: false }] }, T3, ids());
    expect(g).toEqual(seeded());
  });
  it("無い論点へのつながりは捨てる", () => {
    const f = applyProposals(emptyIssues(), "a", { ...none, links: [{ issue_id: "nope", stance: "supports", note: "x", in_memo: true, new_view: "", use: true, useView: true }] }, T1, ids());
    expect(f.links).toEqual([]);
  });
});

describe("編集", () => {
  it("理解を手で書き直すと履歴に残る。決着にすると LLM に見せる順が後ろになる", () => {
    let f = updateIssue(seeded(), "q1", { view: "手で直した", status: "settled" }, T3);
    expect(f.issues[0].views.at(-1)).toEqual({ at: T3, paper_id: null, text: "手で直した" });
    f = applyProposals(f, "c", { ...none, new_issues: [{ question: "新しい問い", stance: "raises", note: "", in_memo: false, view: "", use: true }] }, T1, () => "q9");
    expect(issuesForPrompt(f).map((i) => i.id)).toEqual(["q9", "q1"]);
  });
  it("論点を消すとつながりも消える", () => {
    expect(removeIssue(seeded(), "q1")).toEqual({ version: 1, issues: [], links: [] });
  });
  it("壊れたファイルでも読める", () => {
    expect(normalizeIssues(null)).toEqual(emptyIssues());
    const f = normalizeIssues({ issues: [{ id: "x", question: "q", status: "?", views: null }], links: [{ issue_id: "x", paper_id: "a", stance: "bad" }, { issue_id: "gone", paper_id: "a", stance: "supports" }] });
    expect(f.issues[0]).toMatchObject({ status: "open", views: [] });
    expect(f.links).toEqual([]);
  });
});

describe("recallSeries", () => {
  it("すでにあった論点へのつながりだけを、論文ごとに数える", () => {
    const f = applyProposals(seeded(), "c", { ...none, links: [{ issue_id: "q1", stance: "refines", note: "x", in_memo: true, new_view: "", use: true, useView: false }] }, T3, ids());
    expect(recallSeries(f).map((p) => [p.paper_id, p.linked, p.noticed])).toEqual([["b", 1, 0], ["c", 1, 1]]);
  });
});

describe("graph", () => {
  it("決着した論点は既定で出さない。論文は論点につながっているものだけ", () => {
    const f = updateIssue(applyProposals(seeded(), "c", { ...none, new_issues: [{ question: "別", stance: "raises", note: "", in_memo: false, view: "", use: true }] }, T3, () => "q2"), "q2", { status: "settled" }, T3);
    const g = buildGraph(f, { includeSettled: false });
    expect(g.nodes.map((n) => [n.id, n.degree])).toEqual([["i:q1", 2], ["p:a", 1], ["p:b", 1]]);
    expect(buildGraph(f, { includeSettled: true }).nodes).toHaveLength(5);
  });
  it("配置は枠の中に収まり、同じデータなら同じ配置。固定したノードは動かない", () => {
    const g = buildGraph(seeded(), { includeSettled: true });
    const a = layoutGraph(g.nodes, g.edges, 400, 300, new Map([["p:a", { x: 50, y: 60 }]]));
    const b = layoutGraph(g.nodes, g.edges, 400, 300, new Map([["p:a", { x: 50, y: 60 }]]));
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.get("p:a")).toEqual({ x: 50, y: 60 });
    for (const p of a.values()) {
      expect(p.x).toBeGreaterThanOrEqual(24);
      expect(p.x).toBeLessThanOrEqual(376);
    }
  });
});

describe("llm", () => {
  const paper = newPaper({ title: "Long Attention", id: "c" }, [], "t");
  it("台帳の論点は q 番号で渡し、答えの番号を ID に戻す。知らない番号・重複・空のメモは捨てる", () => {
    const f = seeded();
    const refs = issueRefs(f.issues);
    const prompt = buildIssuesPrompt(buildIssuesRequest(paper, "[アブストラクト]\nabs", "メモ", f.issues, "ja"));
    for (const s of ["Long Attention", "q1. 注意機構は長い系列に効くか?", "今の理解: 4k までは効く", "メモ", '"new_issues"']) expect(prompt).toContain(s);
    const text = JSON.stringify({
      links: [{ issue: "Q1", stance: "challenges", note: "16k では効かない", in_memo: true, new_view: "4k までは効く" }, { issue: "q1", stance: "supports", note: "dup", in_memo: false, new_view: "" }, { issue: "q7", stance: "supports", note: "x", in_memo: false, new_view: "" }],
      new_issues: [{ question: "位置符号は外挿できるか?", stance: "weird", note: "n", in_memo: "yes", view: "" }, { question: "  ", stance: "raises" }],
    });
    expect(parseIssueProposals(`前置き\n${text}`, refs)).toEqual({
      links: [{ issue_id: "q1", stance: "challenges", note: "16k では効かない", in_memo: true, new_view: "4k までは効く" }],
      new_issues: [{ question: "位置符号は外挿できるか?", stance: "raises", note: "n", in_memo: false, view: "" }],
    });
  });
  it("形が違えばエラー", () => {
    expect(() => parseIssueProposals('{"foo": 1}', new Map())).toThrow();
  });
});
