import { describe, expect, it } from "vitest";
import { applyDayLogs, meatForRead, meatStage, newPrisoner } from "./logic";
import type { DayLog } from "@/core/types";

const L = (date: string, kind: DayLog["kind"], streak: number): DayLog => ({ date, kind, paper_ids: [], streak });

describe("death logic", () => {
  it("missed で死に、肉は半減、墓に前日の streak", () => {
    const r = applyDayLogs({ prisoner: newPrisoner("2026-09-01", 100), logs: [L("2026-09-02", "missed", 0)], streakBefore: 7, enabledOn: "2026-09-01" });
    expect(r.prisoner).toEqual({ state: "dead", meat: 50, born_at: "2026-09-02" });
    expect(r.graves).toEqual([{ died_on: "2026-09-02", streak: 7, meat: 100 }]);
  });
  it("死んだまま missed が続いても墓は増えない。read で復活", () => {
    const r = applyDayLogs({
      prisoner: newPrisoner("2026-09-01", 100),
      logs: [L("2026-09-02", "missed", 0), L("2026-09-03", "missed", 0), L("2026-09-04", "read", 1)],
      streakBefore: 3,
      enabledOn: "2026-09-01",
    });
    expect(r.graves).toHaveLength(1);
    expect(r.prisoner.state).toBe("alive");
    expect(r.prisoner.born_at).toBe("2026-09-04");
    expect(r.prisoner.meat).toBe(50);
  });
  it("grace は warning、read で alive に戻る。rest は無視", () => {
    const r = applyDayLogs({ prisoner: newPrisoner("x"), logs: [L("2026-09-02", "rest", 3), L("2026-09-03", "grace", 3), L("2026-09-04", "read", 4)], streakBefore: 3, enabledOn: "2026-09-01" });
    expect(r.prisoner.state).toBe("alive");
    expect(r.graves).toEqual([]);
  });
  it("有効化前の missed は無視", () => {
    const r = applyDayLogs({ prisoner: newPrisoner("x"), logs: [L("2026-09-02", "missed", 0)], streakBefore: 3, enabledOn: "2026-09-03" });
    expect(r.prisoner.state).toBe("alive");
  });
  it("meat", () => {
    expect(meatForRead(250)).toBe(12);
    expect(meatStage(0)).toBe(0);
    expect(meatStage(199)).toBe(1);
    expect(meatStage(5000)).toBe(4);
  });
});
