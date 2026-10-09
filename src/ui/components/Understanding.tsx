// 理解の見える化(仕様 7.5)。メモ画面の「自己評価 → AI のフィードバック → ゼミの予行演習」と、ホームの「つもりの差」
import "./understanding.css";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PageProps } from "../App";
import { apiUsable, loadAiOutputs } from "@/core/app";
import type { GradeOutput, Memo, Paper, SummaryOutput } from "@/core/types";
import { GRADE_ITEMS } from "@/core/llm/tasks";
import {
  AXES,
  AXIS_LABELS,
  VERDICT_LABELS,
  asHandoffPrompt,
  buildAnswerRequest,
  buildQuestionsRequest,
  calibrationGap,
  parseAnswer,
  parseQuestions,
  questionMaterial,
  stages,
  type CalibrationPoint,
  type Stages,
  type UnderstandingRecord,
  type Verdict,
} from "@/core/understanding";
import { addAttempt, askQuestions, judgeAnswer, loadCalibration, loadRecord, saveSelfRating, setQuestions } from "@/core/understanding/actions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 要素の幅。図を実寸で描いて、文字が縮まないようにする */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || fallback));
    ro.observe(el);
    setW(el.clientWidth || fallback);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w] as const;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---- メモ画面 ----

/**
 * AiPanel を包む。採点の前に自己評価を聞き(飛ばせる)、採点のあとに図とゼミの予行演習を出す。
 * 自己評価は採点を見る前でないと意味が無いので、まだなら AiPanel を出さない
 */
export function UnderstandingFlow({ state, memo, paper, children }: { state: PageProps["state"]; memo: Memo; paper: Paper; children: ReactNode }) {
  const [rec, setRec] = useState<UnderstandingRecord | null>(null);
  const [ai, setAi] = useState<{ summary: SummaryOutput | null; grade: GradeOutput | null } | null>(null);

  useEffect(() => {
    loadRecord(paper.id).then(setRec);
  }, [paper.id]);
  // AiPanel が採点を保存すると state.memos が新しくなる。そのたびに読み直す
  useEffect(() => {
    loadAiOutputs(paper.id).then((o) => setAi({ summary: o.summary, grade: o.grade }));
  }, [paper.id, state.memos]);

  if (!rec || !ai) return null;
  const needSelf = !ai.grade && !rec.self && !rec.self_skipped;
  return (
    <>
      {needSelf ? <SelfCheck onSave={async (self) => setRec(await saveSelfRating(rec, self))} /> : children}
      {ai.grade && <SeminarPanel state={state} memo={memo} paper={paper} rec={rec} setRec={setRec} grade={ai.grade} summary={ai.summary} />}
    </>
  );
}

export function SelfCheck({ onSave }: { onSave: (self: number[] | null) => Promise<void> }) {
  const [scores, setScores] = useState<(number | null)[]>([null, null, null, null]);
  const [saving, setSaving] = useState(false);
  const done = scores.every((s) => s !== null);
  const save = async (v: number[] | null) => {
    setSaving(true);
    try {
      await onSave(v);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>AI に見せる前に: どのくらいわかった?</h2>
      <p className="muted">AI の採点と同じ 4 項目です。あとで採点と並べて、「わかったつもり」との差を図にします。</p>
      {AXES.map((a) => (
        <div className="u-self-row" key={a}>
          <div className="u-self-label">{AXIS_LABELS[a]}<span className="muted">{GRADE_ITEMS[a]}</span></div>
          <div className="u-seg" role="radiogroup" aria-label={AXIS_LABELS[a]}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={scores[a] === n} className={scores[a] === n ? "on" : ""} onClick={() => setScores(scores.map((s, i) => (i === a ? n : s)))}>{n}</button>
            ))}
          </div>
        </div>
      ))}
      <p className="muted u-scale">1 = ほとんどわからない … 5 = 人に説明できる</p>
      <div className="row">
        <button className="btn" disabled={!done || saving} onClick={() => save(scores as number[])}>記録して、AI に見てもらう</button>
        <button className="link" disabled={saving} onClick={() => save(null)}>今回は飛ばす</button>
      </div>
    </div>
  );
}

function SeminarPanel({ state, memo, paper, rec, setRec, grade, summary }: { state: PageProps["state"]; memo: Memo; paper: Paper; rec: UnderstandingRecord; setRec: (r: UnderstandingRecord) => void; grade: GradeOutput; summary: SummaryOutput | null }) {
  const [useApi, setUseApi] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const material = questionMaterial(paper, summary);
  const st = stages(rec, grade);

  useEffect(() => {
    const via = state.settings.llm.summary_via;
    if (via === "api") setUseApi(true);
    else if (via === "auto") apiUsable(state.settings).then(setUseApi);
    else setUseApi(false);
  }, [state.settings]);

  const run = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const questionsReq = () => buildQuestionsRequest(paper, material, memo.body, grade, state.settings.language);
  const gotQuestions = async (qs: Awaited<ReturnType<typeof askQuestions>>) => setRec(await setQuestions(rec, qs));

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>理解の変化</h2>
      <UnderstandingChart st={st} />
      {st.self && <GapLine self={st.self} grade={grade} />}
      <h2>ゼミの予行演習</h2>
      {rec.questions.length === 0 ? (
        <>
          <p className="muted">指導教員役の AI が 3 問だけ聞きます。答えると、聞かれた項目の点が答えの点に置き換わり、上の図が動きます。</p>
          {useApi !== null && (
            <Ask
              useApi={useApi}
              label="質問してもらう"
              busy={busy === "q"}
              prompt={() => asHandoffPrompt(questionsReq(), "questions")}
              onApi={() => run("q", async () => gotQuestions(await askQuestions(state, paper, material, memo.body, grade)))}
              onPasted={(text) => run("q", async () => gotQuestions(parseQuestions(text)))}
            />
          )}
        </>
      ) : (
        <>
          {rec.questions.map((x, i) => (
            <QuestionCard
              key={i}
              n={i + 1}
              item={x}
              useApi={!!useApi}
              busy={busy === `a${i}`}
              prompt={(answer) => asHandoffPrompt(buildAnswerRequest(paper, material, x.q, answer, state.settings.language), "answer")}
              onApi={(answer) => run(`a${i}`, async () => setRec(await addAttempt(rec, i, await judgeAnswer(state, paper, material, x.q, answer))))}
              onPasted={(answer, text) => run(`a${i}`, async () => setRec(await addAttempt(rec, i, parseAnswer(text, answer))))}
            />
          ))}
          <button className="btn secondary small" disabled={!!busy} onClick={() => run("reset", async () => setRec(await setQuestions(rec, [])))}>別の質問にする</button>
        </>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}

function GapLine({ self, grade }: { self: number[]; grade: GradeOutput }) {
  const gap = calibrationGap(self, grade);
  const s = self.reduce((a, b) => a + b, 0);
  const text = gap >= 3 ? "わかったつもりが大きめです。点の低い項目から、質問で確かめましょう" : gap <= -3 ? "思っているより読めています" : "自己評価と採点がほぼ一致しています";
  return (
    <p className="u-gap">
      <strong>つもりの差 {gap > 0 ? `+${gap}` : gap} 点</strong>
      <span className="muted">(自己評価 {s} / 採点 {grade.total}、20 点満点)。{text}</span>
    </p>
  );
}

const VERDICT_ICON: Record<Verdict, string> = { ok: "✓", partial: "△", miss: "✗" };

export function QuestionCard({ n, item, useApi, busy, prompt, onApi, onPasted }: {
  n: number;
  item: UnderstandingRecord["questions"][number];
  useApi: boolean;
  busy: boolean;
  prompt: (answer: string) => string;
  onApi: (answer: string) => Promise<void>;
  onPasted: (answer: string, text: string) => Promise<void>;
}) {
  const last = item.attempts[item.attempts.length - 1];
  const [answer, setAnswer] = useState("");
  const [retry, setRetry] = useState(false);
  const open = !last || retry;
  const submit = async (f: () => Promise<void>) => {
    await f();
    setRetry(false);
    setAnswer("");
  };
  return (
    <div className={`u-q ${last ? `v-${last.verdict}` : ""}`}>
      <div className="u-q-head">
        <span className="u-axis">{AXIS_LABELS[item.q.axis]}</span>
        <span className="muted">Q{n}</span>
        {last && <span className="u-verdict">{VERDICT_ICON[last.verdict]} {VERDICT_LABELS[last.verdict]}({last.score}/5)</span>}
      </div>
      <p className="u-q-text">{item.q.question}</p>
      {item.attempts.length > 1 && (
        <div className="u-trail" aria-label="答えた回ごとの点">
          {item.attempts.map((a, i) => <span key={i} className={`v-${a.verdict}`}>{i > 0 && "→ "}{a.score}</span>)}
        </div>
      )}
      {last && !retry && (
        <>
          <blockquote className="u-answer">{last.answer}</blockquote>
          {last.feedback && <p className="u-feedback">{last.feedback}</p>}
          {item.q.look_for && <p className="muted"><strong>よい答えに入っているべきこと</strong> {item.q.look_for}</p>}
          {last.verdict !== "ok" && <button className="btn secondary small" onClick={() => setRetry(true)}>論文を読み直して、もう一度答える</button>}
        </>
      )}
      {open && (
        <>
          <textarea className="u-input" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="ゼミで答えるつもりで、自分の言葉で" />
          <Ask
            useApi={useApi}
            label="答える"
            busy={busy}
            disabled={!answer.trim()}
            prompt={() => prompt(answer)}
            onApi={() => submit(() => onApi(answer))}
            onPasted={(text) => submit(() => onPasted(answer, text))}
          />
          {retry && <button className="link" onClick={() => setRetry(false)}>やめる</button>}
        </>
      )}
    </div>
  );
}

/** API なら 1 ボタン。キーが無ければ、プロンプトをコピー → 好きな AI → 回答を貼り付け */
function Ask({ useApi, label, busy, disabled, prompt, onApi, onPasted }: {
  useApi: boolean;
  label: string;
  busy: boolean;
  disabled?: boolean;
  prompt: () => string;
  onApi: () => Promise<void>;
  onPasted: (text: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  if (useApi) return <button className="btn small" disabled={busy || disabled} onClick={onApi}>{busy ? "考え中…" : label}</button>;
  const p = prompt();
  return (
    <div className="u-ask">
      <button className="btn small" disabled={busy || disabled} onClick={async () => setCopied((await copyText(p)) ? p : "")}>1. プロンプトをコピー({label})</button>
      {copied === "" && <textarea rows={3} readOnly value={p} onClick={(e) => e.currentTarget.select()} />}
      {copied !== null && (
        <>
          <p className="muted">{copied ? "コピーしました。" : "コピーできませんでした。上の欄を全選択してコピーしてください。"}ChatGPT や Claude などに貼り、返ってきた JSON をここに貼ってください。</p>
          <textarea rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="{ ... }" />
          <button className="btn small" disabled={busy || !pasted.trim()} onClick={async () => { await onPasted(pasted); setPasted(""); setCopied(null); }}>2. 読み込む</button>
        </>
      )}
    </div>
  );
}

// ---- 図: 項目ごとの点(自己評価 → メモ → 質問後) ----

const LEGEND: [string, string][] = [["self", "自己評価(つもり)"], ["memo", "メモの採点"], ["after", "質問に答えたあと"]];

export function UnderstandingChart({ st }: { st: Stages }) {
  const [ref, width] = useWidth<HTMLDivElement>(280);
  const [hover, setHover] = useState<number | null>(null);
  const labelW = 64;
  const padR = 14;
  const rowH = 34;
  const top = 18;
  const h = top + rowH * 4 + 4;
  const x = (v: number) => labelW + ((v - 1) / 4) * (width - labelW - padR);
  const y = (a: number) => top + rowH * a + rowH / 2;
  const anyAsked = st.asked.some(Boolean);

  return (
    <div className="u-chart" ref={ref}>
      <div className="u-legend">
        {LEGEND.filter(([k]) => (k === "self" ? !!st.self : k === "after" ? anyAsked : true)).map(([k, l]) => (
          <span key={k}><i className={`key ${k}`} />{l}</span>
        ))}
      </div>
      <svg width={width} height={h} role="img" aria-label="項目ごとの理解度(1〜5)">
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={top - 4} y2={h - 4} className="grid" />
            <text x={x(v)} y={10} className="tick" textAnchor="middle">{v}</text>
          </g>
        ))}
        {AXES.map((a) => {
          const m = st.memo[a];
          const af = st.after[a];
          const moved = st.asked[a] && af !== m;
          return (
            <g key={a} onMouseEnter={() => setHover(a)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={y(a) - rowH / 2} width={width} height={rowH} className={hover === a ? "hit on" : "hit"} />
              <text x={0} y={y(a) + 4} className="label">{AXIS_LABELS[a]}</text>
              {moved && <line x1={x(m)} x2={x(af) - Math.sign(x(af) - x(m)) * 9} y1={y(a)} y2={y(a)} className={af > m ? "move up" : "move down"} markerEnd={`url(#u-arrow-${af > m ? "up" : "down"})`} />}
              <circle cx={x(m)} cy={y(a)} r={6} className="dot memo" />
              {st.asked[a] && <circle cx={x(af)} cy={y(a)} r={6} className="dot after" />}
              {st.self && <circle cx={x(st.self[a])} cy={y(a)} r={7} className="dot self" />}
            </g>
          );
        })}
        <defs>
          {(["up", "down"] as const).map((d) => (
            <marker key={d} id={`u-arrow-${d}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`arrow ${d}`} />
            </marker>
          ))}
        </defs>
      </svg>
      {hover !== null && (
        <div className="u-tip" style={{ top: top + 26 + rowH * (hover + 1) }}>
          <strong>{GRADE_ITEMS[hover]}</strong>
          {st.self && <div><i className="key self" />自己評価 {st.self[hover]}</div>}
          <div><i className="key memo" />メモの採点 {st.memo[hover]}</div>
          {st.asked[hover] && <div><i className="key after" />質問のあと {st.after[hover]}</div>}
        </div>
      )}
    </div>
  );
}

// ---- ホーム: つもりの差の推移 ----

export function CalibrationCard({ state }: { state: PageProps["state"] }) {
  const [points, setPoints] = useState<CalibrationPoint[] | null>(null);
  useEffect(() => {
    loadCalibration(state).then(setPoints).catch(() => setPoints([]));
  }, [state.memos]); // eslint-disable-line react-hooks/exhaustive-deps
  return points?.length ? <CalibrationView points={points} /> : null;
}

export function CalibrationView({ points }: { points: CalibrationPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const [hover, setHover] = useState<number | null>(null);
  const shown = points.slice(-12);
  const recent = shown.slice(-5);
  const avg = recent.reduce((a, p) => a + p.gap, 0) / recent.length;
  const before = points.slice(-10, -5);
  const avgBefore = before.length ? before.reduce((a, p) => a + p.gap, 0) / before.length : null;
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

  const h = 150;
  const padL = 30;
  const top = 10;
  const bottom = 10;
  const lim = Math.max(4, ...shown.map((p) => Math.abs(p.gap)));
  const y = (v: number) => top + ((lim - v) / (2 * lim)) * (h - top - bottom);
  const slot = (width - padL) / shown.length;
  const barW = Math.min(24, slot - 6);

  return (
    <div className="card">
      <div className="muted">わかったつもり度(自己評価 − AI の採点)</div>
      <p className="title">直近 {recent.length} 本の平均 {fmt(avg)} 点{avgBefore !== null && <span className="muted u-delta"> その前の 5 本は {fmt(avgBefore)} 点</span>}</p>
      <div className="u-chart" ref={ref}>
        <svg width={width} height={h} role="img" aria-label="論文ごとのつもりの差">
          {[lim, 0, -lim].map((v) => (
            <g key={v}>
              <line x1={padL} x2={width} y1={y(v)} y2={y(v)} className={v === 0 ? "zero" : "grid"} />
              <text x={padL - 6} y={y(v) + 4} className="tick" textAnchor="end">{v > 0 ? `+${v}` : v}</text>
            </g>
          ))}
          {shown.map((p, i) => {
            const cx = padL + slot * i + slot / 2;
            return (
              <g key={p.paper_id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={cx - slot / 2} y={0} width={slot} height={h} className={hover === i ? "hit on" : "hit"} />
                {p.gap !== 0 ? <path d={barPath(cx - barW / 2, barW, y(0), y(p.gap))} className={p.gap > 0 ? "bar over" : "bar under"} /> : <rect x={cx - barW / 2} y={y(0) - 1} width={barW} height={2} className="bar even" />}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div className="u-tip" style={{ top: h + 4, left: Math.min(Math.max(0, padL + slot * hover - 60), Math.max(0, width - 220)) }}>
            <strong>{shown[hover].title}</strong>
            <div>自己評価 {shown[hover].self} / 採点 {shown[hover].actual}(差 {fmt(shown[hover].gap)})</div>
          </div>
        )}
      </div>
      <div className="u-legend">
        <span><i className="key over" />上: わかったつもり(自己評価が高い)</span>
        <span><i className="key under" />下: 思ったより読めていた</span>
      </div>
      <details>
        <summary className="muted">表で見る</summary>
        <table>
          <thead><tr><th>論文</th><th>自己評価</th><th>採点</th><th>差</th></tr></thead>
          <tbody>{[...shown].reverse().map((p) => <tr key={p.paper_id}><td>{p.title}</td><td>{p.self}</td><td>{p.actual}</td><td>{fmt(p.gap)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

/** 0 の線から伸びる棒。先端だけ角を丸める */
function barPath(x: number, w: number, y0: number, y1: number): string {
  const r = Math.min(4, Math.abs(y1 - y0), w / 2);
  if (y1 < y0) return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}
