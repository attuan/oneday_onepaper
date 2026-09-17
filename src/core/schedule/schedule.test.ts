import { describe, expect, it } from "vitest";
import { logicalDate, isRestDay, addDays, dateRange } from "./logicalDay";
import { judgeMissingDays } from "./judge";

describe("logicalDate", () => {
  it("境界前は前日扱い", () => {
    expect(logicalDate(new Date(2026, 8, 8, 3, 59), 4)).toBe("2026-09-07");
    expect(logicalDate(new Date(2026, 8, 8, 4, 0), 4)).toBe("2026-09-08");
  });
  it("境界 0 時なら通常の日付", () => {
    expect(logicalDate(new Date(2026, 8, 8, 0, 30), 0)).toBe("2026-09-08");
  });
});

describe("isRestDay", () => {
  it("曜日と期間", () => {
    const s = { rest_weekdays: [0, 6], rest_periods: [{ from: "2026-12-28", to: "2027-01-03" }] };
    expect(isRestDay("2026-09-05", s)).toBe(true); // 土
    expect(isRestDay("2026-09-07", s)).toBe(false); // 月
    expect(isRestDay("2026-12-30", s)).toBe(true);
    expect(isRestDay("2027-01-04", s)).toBe(false);
  });
});

describe("addDays / dateRange", () => {
  it("月跨ぎ", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(dateRange("2026-08-30", "2026-09-01")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });
});

describe("judgeMissingDays", () => {
  const base = {
    lastStreak: 3,
    graceDays: 0,
    firstUseDate: "2026-09-01",
    settings: { rest_weekdays: [] as number[], rest_periods: [], grace: { enabled: false, per_month: 0 } },
  };

  it("読了で streak が伸びる", () => {
    const r = judgeMissingDays({
      ...base,
      lastLoggedDate: "2026-09-05",
      today: "2026-09-07",
      readsByDate: { "2026-09-06": ["p1"] },
    });
    expect(r.newLogs).toEqual([{ date: "2026-09-06", kind: "read", paper_ids: ["p1"], streak: 4 }]);
    expect(r.streak).toBe(4);
  });

  it("読まなかったら missed で 0", () => {
    const r = judgeMissingDays({ ...base, lastLoggedDate: "2026-09-05", today: "2026-09-07", readsByDate: {} });
    expect(r.newLogs[0].kind).toBe("missed");
    expect(r.streak).toBe(0);
  });

  it("休みは維持", () => {
    const r = judgeMissingDays({
      ...base,
      settings: { ...base.settings, rest_weekdays: [0, 6] },
      lastLoggedDate: "2026-09-04",
      today: "2026-09-07",
      readsByDate: {},
    });
    expect(r.newLogs.map((l) => l.kind)).toEqual(["rest", "rest"]);
    expect(r.streak).toBe(3);
  });

  it("1 日だけの未読は大目に見る。2 日続けたら切れる。休みは数えない", () => {
    const settings = { ...base.settings, rest_weekdays: [1], forgive_single_miss: true }; // 月曜休み。2026-09-07 は月曜
    const run = (readsByDate: Record<string, string[]>, missedOnce = false) =>
      judgeMissingDays({ ...base, settings, missedOnce, lastLoggedDate: "2026-09-05", today: "2026-09-10", readsByDate }).newLogs.map((l) => `${l.kind}:${l.streak}`);
    expect(run({ "2026-09-08": ["p"] })).toEqual(["missed:3", "rest:3", "read:4", "missed:4"]);
    expect(run({})).toEqual(["missed:3", "rest:3", "missed:0", "missed:0"]);
    expect(run({ "2026-09-08": ["p"] }, true)[0]).toBe("missed:0");
  });
  it("猶予が有効なら消費して維持、切れたら missed", () => {
    const r = judgeMissingDays({
      ...base,
      graceDays: 1,
      settings: { ...base.settings, grace: { enabled: true, per_month: 2 } },
      lastLoggedDate: "2026-09-04",
      today: "2026-09-07",
      readsByDate: {},
    });
    expect(r.newLogs.map((l) => l.kind)).toEqual(["grace", "missed"]);
    expect(r.graceDays).toBe(0);
    expect(r.streak).toBe(0);
  });

  it("今日は判定しない・未処理なしなら空", () => {
    const r = judgeMissingDays({ ...base, lastLoggedDate: "2026-09-06", today: "2026-09-07", readsByDate: {} });
    expect(r.newLogs).toEqual([]);
  });

  it("初回は firstUseDate から", () => {
    const r = judgeMissingDays({ ...base, lastStreak: 0, lastLoggedDate: null, firstUseDate: "2026-09-06", today: "2026-09-07", readsByDate: { "2026-09-06": ["a"] } });
    expect(r.newLogs).toHaveLength(1);
    expect(r.streak).toBe(1);
  });
});
