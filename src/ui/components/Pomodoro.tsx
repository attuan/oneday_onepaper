// メモを書く画面のポモドーロ(仕様 11 v2)。状態遷移は core/pomodoro.ts、ここは表示とタイマーだけ

import { useEffect, useRef, useState } from "react";
import { advance, format, initial, pause, remaining, reset, start, tick, type PomodoroConfig, type PomodoroState } from "@/core/pomodoro";
import { notifier } from "@/core/store/backend";

export function Pomodoro({ config }: { config: PomodoroConfig }) {
  const [s, setS] = useState<PomodoroState>(() => initial(config));
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState<string | null>(null);
  const cfgRef = useRef(config);
  cfgRef.current = config;

  // 動いている間だけ 1 秒ごとに進める
  useEffect(() => {
    if (s.endsAt === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setS((prev) => {
        const r = tick(prev, cfgRef.current, t);
        if (r.finished) {
          const text = r.finished === "work" ? `作業 ${cfgRef.current.work_minutes} 分が終わりました。休憩に入ります` : "休憩が終わりました。作業に戻りましょう";
          setNote(text);
          notifier
            .isPermissionGranted()
            .then((ok) => {
              if (ok) void notifier.send("ポモドーロ", text);
            })
            .catch(() => undefined);
        }
        return r.state;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [s.endsAt]);

  const running = s.endsAt !== null;
  const left = remaining(s, now);
  return (
    <div className={`card pomodoro ${s.phase}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="muted">{s.phase === "work" ? "作業" : "休憩"}{s.completedWork > 0 && ` · ${s.completedWork} 回目を終了`}</div>
          <p className="title mono">{format(left)}</p>
        </div>
        <div className="row">
          {running ? (
            <button className="btn secondary small" onClick={() => { setS(pause(s, Date.now())); }}>一時停止</button>
          ) : (
            <button className="btn small" onClick={() => { const t = Date.now(); setNow(t); setNote(null); setS(start(s, t)); }}>{left === remaining(initial(config), 0) && s.completedWork === 0 ? "開始" : "再開"}</button>
          )}
          <button className="btn secondary small" onClick={() => setS(reset(s, config))}>リセット</button>
          <button className="btn secondary small" onClick={() => { setNote(null); setS(advance(s, config)); }}>{s.phase === "work" ? "休憩へ" : "作業へ"}</button>
        </div>
      </div>
      {note && <p className="muted">{note}</p>}
    </div>
  );
}
