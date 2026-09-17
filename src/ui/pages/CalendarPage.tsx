import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "../App";
import { apiUsable, calendarLogs, draftRelatedWork, exportMonthDigest, relatedWorkPrompt } from "@/core/app";
import type { DayLog } from "@/core/types";
import { pad2 } from "@/core/schedule/logicalDay";

export function CalendarPage({ state, go }: PageProps) {
  const [ym, setYm] = useState(state.today.slice(0, 7));
  const [logs, setLogs] = useState<DayLog[]>([]);
  const [y, m] = ym.split("-").map(Number);
  const first = `${ym}-01`;
  const daysInMonth = new Date(y, m, 0).getDate();
  const last = `${ym}-${pad2(daysInMonth)}`;

  useEffect(() => {
    calendarLogs(first, last).then(setLogs);
  }, [first, last, state.memos]);

  const byDate = useMemo(() => {
    const map = new Map<string, DayLog>();
    for (const l of logs) map.set(l.date, l);
    return map;
  }, [logs]);

  const memosByDate = useMemo(() => {
    const map = new Map<string, { paperId: string; title: string; score: number | null; level: number }[]>();
    for (const mm of state.memos) {
      if (!mm.frontmatter.completed) continue;
      const p = state.papers.find((x) => x.id === mm.frontmatter.paper_id);
      (map.get(mm.frontmatter.date) ?? map.set(mm.frontmatter.date, []).get(mm.frontmatter.date)!).push({ paperId: mm.frontmatter.paper_id, title: p?.title ?? mm.frontmatter.paper_id, score: mm.frontmatter.score_total, level: mm.frontmatter.level });
    }
    return map;
  }, [state.memos, state.papers]);

  const [digestMsg, setDigestMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const monthCount = [...memosByDate.entries()].filter(([d]) => d.startsWith(ym)).reduce((n, [, xs]) => n + xs.length, 0);

  const act = async (fn: () => Promise<string>, show: (text: string) => void) => {
    setBusy(true);
    setDigestMsg(null);
    try {
      show(await fn());
    } catch (e) {
      setDigestMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** API が使えればその場で下書きを作る。無ければ頼む文面をコピーして、好きな AI に貼ってもらう */
  const relatedWork = () =>
    act(async () => {
      if (await apiUsable(state.settings)) return draftRelatedWork(state, ym);
      await navigator.clipboard.writeText(relatedWorkPrompt(state, ym));
      return "";
    }, (text) => (text ? setDraft(text) : setDigestMsg("頼む文面をコピーしました。ChatGPT や Claude などに貼ってください。")));

  const shift = (n: number) => {
    setDraft(null);
    setDigestMsg(null);
    const d = new Date(y, m - 1 + n, 1);
    setYm(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  };
  const startDow = new Date(y, m - 1, 1).getDay();
  const cells: (string | null)[] = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${ym}-${pad2(i + 1)}`)];

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>カレンダー</h1>
        <div className="row">
          <button className="btn secondary small" onClick={() => shift(-1)}>←</button>
          <strong>{y} 年 {m} 月</strong>
          <button className="btn secondary small" onClick={() => shift(1)}>→</button>
        </div>
      </div>
      <div className="calendar">
        {["日", "月", "火", "水", "木", "金", "土"].map((d) => <div className="dow" key={d}>{d}</div>)}
        {cells.map((date, i) => {
          if (!date) return <div className="day empty" key={`e${i}`} />;
          const log = byDate.get(date);
          const reads = memosByDate.get(date) ?? [];
          const kind = log?.kind ?? (reads.length ? "read" : "");
          const cls = ["day", kind, date === state.today ? "today" : "", date > state.today ? "future" : ""].join(" ");
          return (
            <div className={cls} key={date} title={date}>
              <div className="n">{Number(date.slice(8))}</div>
              {reads.map((r, j) => (
                <button key={j} type="button" className="cal-entry" title={`${r.title} のメモを開く`} onClick={() => go({ name: "editor", paperId: r.paperId })}>
                  <div className="t">{r.title}</div>
                  <div className="s">Lv{r.level}{r.score !== null && ` ・ ${r.score} 点`}</div>
                </button>
              ))}
              {kind === "missed" && <div className="muted">未読{log && log.streak > 0 && "(記録は継続)"}</div>}
              {kind === "rest" && <div className="muted">休み</div>}
              {kind === "grace" && <div className="muted">猶予</div>}
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <strong>{y} 年 {m} 月のまとめ({monthCount} 本)</strong>
        <p className="muted">読んだものとメモを 1 つにまとめます。輪講の資料や、卒論の関連研究の材料に。</p>
        <div className="row">
          <button className="btn secondary" disabled={busy || !monthCount} onClick={() => act(() => exportMonthDigest(state, ym), (where) => setDigestMsg(`書き出しました: ${where}`))}>Markdown で書き出す</button>
          <button className="btn secondary" disabled={busy || !monthCount} onClick={relatedWork}>{busy ? "作成中…" : "「関連研究」の下書きを作る"}</button>
        </div>
        {digestMsg && <p className="muted">{digestMsg}</p>}
        {draft && (
          <div className="field" style={{ marginTop: 8 }}>
            <label>下書き(材料はあなたのメモだけです。引用する前に必ず論文で確かめてください)</label>
            <textarea rows={14} readOnly value={draft} onFocus={(e) => e.target.select()} />
          </div>
        )}
      </div>
    </>
  );
}
