import { describe, expect, it } from "vitest";
import { buildCourse, courseProgress, stageOf } from "./course";
import { markRead, newPaper } from "./queue";

describe("stageOf", () => {
  it("題名でサーベイ、年で最近、ほかは基礎", () => {
    expect(stageOf({ id: "a", title: "A Survey of Transformers", year: 2025 }, 2026)).toBe("survey");
    expect(stageOf({ id: "b", title: "深層学習の展望", year: 2010 }, 2026)).toBe("survey");
    expect(stageOf({ id: "c", title: "New Model", year: 2024 }, 2026)).toBe("recent");
    expect(stageOf({ id: "d", title: "Old Model", year: 2017 }, 2026)).toBe("classic");
    expect(stageOf({ id: "e", title: "No Year" }, 2026)).toBe("classic");
  });
});

describe("buildCourse", () => {
  const c = (id: string, title: string, year: number) => ({ id, title, year });
  const ranked = [c("c1", "Classic B", 2017), c("r1", "Recent A", 2025), c("s1", "A Survey", 2022), c("c2", "Classic A", 2014), c("s2", "Review X", 2020), c("s3", "Overview Y", 2019), c("r2", "Recent B", 2026), c("c3", "Classic C", 2019)];
  it("全体像 → 基礎(古い順)→ 最近 に並べ、全体像は 2 本まで", () => {
    expect(buildCourse(ranked, 6, 2026).map((x) => x.id)).toEqual(["s1", "s2", "c2", "c1", "r1", "r2"]);
  });
  it("足りない段階の枠は順位の高い残りで埋める", () => {
    const onlyClassics = [c("a", "A", 2001), c("b", "B", 2000), c("d", "D", 2002)];
    expect(buildCourse(onlyClassics, 3, 2026).map((x) => x.id)).toEqual(["b", "a", "d"]);
    expect(buildCourse(ranked, 20, 2026)).toHaveLength(ranked.length);
  });
});

describe("courseProgress", () => {
  it("コースごとに本数・読了数・次の 1 本", () => {
    const course = (step: number) => ({ id: "k1", title: "RAG 入門", step, stage: "classic" as const });
    let papers = [newPaper({ title: "P2", id: "p2", course: course(2) }, [], "t"), newPaper({ title: "P1", id: "p1", course: course(1) }, [], "t"), newPaper({ title: "free", id: "f" }, [], "t")];
    papers = markRead(papers, "p1", "t");
    expect(courseProgress(papers)).toMatchObject([{ id: "k1", title: "RAG 入門", total: 2, read: 1, next: { id: "p2" } }]);
  });
});
