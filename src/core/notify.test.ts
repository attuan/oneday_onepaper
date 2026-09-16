import { describe, expect, it } from "vitest";
import { dueNotifications } from "./notify";
import { DEFAULT_SETTINGS } from "./types";
import { newPaper } from "./papers/queue";

const settings = { ...DEFAULT_SETTINGS, data_dir: "" };
const paper = newPaper({ title: "P" }, [], "t");

describe("dueNotifications", () => {
  it("朝より前は何もない", () => {
    expect(dueNotifications({ settings, today: "2026-09-07", todaysPaper: paper, readToday: false, now: new Date(2026, 8, 7, 7, 0) })).toEqual([]);
  });
  it("朝の通知", () => {
    const d = dueNotifications({ settings, today: "2026-09-07", todaysPaper: paper, readToday: false, now: new Date(2026, 8, 7, 9, 0) });
    expect(d.map((x) => x.key)).toEqual(["morning:2026-09-07"]);
  });
  it("夜、未読なら 2 件。読了済みなら朝だけ", () => {
    const base = { settings, today: "2026-09-07", todaysPaper: paper, now: new Date(2026, 8, 7, 21, 0) };
    expect(dueNotifications({ ...base, readToday: false }).map((x) => x.key)).toEqual(["morning:2026-09-07", "evening:2026-09-07"]);
    expect(dueNotifications({ ...base, readToday: true }).map((x) => x.key)).toEqual(["morning:2026-09-07"]);
  });
  it("最終通知は境界 4 時の 60 分前から", () => {
    const d = dueNotifications({ settings, today: "2026-09-07", todaysPaper: paper, readToday: false, now: new Date(2026, 8, 8, 3, 30) });
    const lc = d.find((x) => x.key.startsWith("lastcall"));
    expect(lc?.title).toBe("締切まで 30 分");
    expect(lc?.body).toBe("P");
  });
  it("休みの日は出さない", () => {
    expect(dueNotifications({ settings: { ...settings, rest_weekdays: [1] }, today: "2026-09-07", todaysPaper: paper, readToday: false, now: new Date(2026, 8, 7, 21, 0) })).toEqual([]);
  });
});
