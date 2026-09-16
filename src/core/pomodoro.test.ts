import { describe, expect, it } from "vitest";
import { advance, format, initial, pause, remaining, reset, start, tick } from "./pomodoro";

const cfg = { work_minutes: 25, break_minutes: 5 };
const MIN = 60_000;

describe("pomodoro", () => {
  it("開始・一時停止・再開で残りが保たれる", () => {
    let s = initial(cfg);
    expect(remaining(s, 0)).toBe(25 * MIN);
    s = start(s, 1000);
    expect(remaining(s, 1000 + 10 * MIN)).toBe(15 * MIN);
    s = pause(s, 1000 + 10 * MIN);
    expect(s.endsAt).toBeNull();
    expect(remaining(s, 999_999_999)).toBe(15 * MIN);
    s = start(s, 50_000);
    expect(s.endsAt).toBe(50_000 + 15 * MIN);
  });
  it("作業が終わると休憩が自動で始まり、休憩が終わると止まる", () => {
    let s = start(initial(cfg), 0);
    expect(tick(s, cfg, 25 * MIN - 1).finished).toBeNull();
    const r1 = tick(s, cfg, 25 * MIN);
    expect(r1.finished).toBe("work");
    expect(r1.state.phase).toBe("break");
    expect(r1.state.completedWork).toBe(1);
    expect(r1.state.endsAt).toBe(30 * MIN);
    const r2 = tick(r1.state, cfg, 30 * MIN + 5);
    expect(r2.finished).toBe("break");
    expect(r2.state.phase).toBe("work");
    expect(r2.state.endsAt).toBeNull();
    expect(r2.state.remainingMs).toBe(25 * MIN);
    s = r2.state;
    expect(tick(s, cfg, 999 * MIN).finished).toBeNull(); // 止まっていれば何も起きない
  });
  it("reset は今のフェーズを最初から。advance は手で次へ", () => {
    const s = pause(start(initial(cfg), 0), 3 * MIN);
    expect(reset(s, cfg).remainingMs).toBe(25 * MIN);
    const b = advance(s, cfg);
    expect(b.phase).toBe("break");
    expect(b.completedWork).toBe(1);
    expect(advance(b, cfg).completedWork).toBe(1);
  });
  it("表示は m:ss。0 分でも最低 1 分にする", () => {
    expect(format(5 * MIN)).toBe("5:00");
    expect(format(61_000)).toBe("1:01");
    expect(format(500)).toBe("0:01");
    expect(initial({ work_minutes: 0, break_minutes: 0 }).remainingMs).toBe(MIN);
  });
});
