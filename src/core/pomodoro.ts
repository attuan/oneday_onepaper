// ポモドーロ(仕様 11 v2、「作ってから要否判断」)。純粋な状態遷移だけ持ち、タイマーは UI が回す。
// 作業 → 休憩 を繰り返す。終了は時刻で判定するので、タブが眠っていても計算がずれない

export type Phase = "work" | "break";

export interface PomodoroState {
  phase: Phase;
  /** 動いていれば、この時刻に今のフェーズが終わる(エポックミリ秒)。止まっていれば null */
  endsAt: number | null;
  /** 止めたときの残り(ミリ秒)。動いていれば無視 */
  remainingMs: number;
  /** 終えた作業の回数 */
  completedWork: number;
}

export interface PomodoroConfig {
  work_minutes: number;
  break_minutes: number;
}

const ms = (min: number) => Math.max(1, min) * 60_000;

export function initial(cfg: PomodoroConfig): PomodoroState {
  return { phase: "work", endsAt: null, remainingMs: ms(cfg.work_minutes), completedWork: 0 };
}

export function start(s: PomodoroState, now: number): PomodoroState {
  if (s.endsAt !== null) return s;
  return { ...s, endsAt: now + s.remainingMs };
}

export function pause(s: PomodoroState, now: number): PomodoroState {
  if (s.endsAt === null) return s;
  return { ...s, endsAt: null, remainingMs: Math.max(0, s.endsAt - now) };
}

/** 今のフェーズを最初からにする(回数は保つ) */
export function reset(s: PomodoroState, cfg: PomodoroConfig): PomodoroState {
  return { ...s, endsAt: null, remainingMs: ms(s.phase === "work" ? cfg.work_minutes : cfg.break_minutes) };
}

export function remaining(s: PomodoroState, now: number): number {
  return s.endsAt === null ? s.remainingMs : Math.max(0, s.endsAt - now);
}

/** 次のフェーズへ(止まった状態で返す)。作業を終えたら回数を増やす */
export function advance(s: PomodoroState, cfg: PomodoroConfig): PomodoroState {
  const next: Phase = s.phase === "work" ? "break" : "work";
  return { phase: next, endsAt: null, remainingMs: ms(next === "work" ? cfg.work_minutes : cfg.break_minutes), completedWork: s.completedWork + (s.phase === "work" ? 1 : 0) };
}

/**
 * タイマーの 1 tick。フェーズが終わっていれば次のフェーズに切り替えて finished を返す。
 * 休憩の終わりは自動で作業を始めず、止まった状態にする(作業に戻るのはユーザーの意思で)
 */
export function tick(s: PomodoroState, cfg: PomodoroConfig, now: number): { state: PomodoroState; finished: Phase | null } {
  if (s.endsAt === null || now < s.endsAt) return { state: s, finished: null };
  const finished = s.phase;
  const next = advance(s, cfg);
  // 作業が終わったら休憩は自動で始める
  return { state: finished === "work" ? start(next, now) : next, finished };
}

export function format(msLeft: number): string {
  const total = Math.ceil(msLeft / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
