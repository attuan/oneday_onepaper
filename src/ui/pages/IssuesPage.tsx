// 論点マップ(仕様 7.6)。論点(丸)と論文(四角)を、支持・反する・条件を付ける・提起 の線でつないだネットワーク
import "../components/understanding.css";
import "../components/issues.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PageProps } from "../App";
import type { Paper } from "@/core/types";
import { newId, shortLabel } from "@/core/proposal/model";
import {
  STANCES,
  STANCE_LABELS,
  buildGraph,
  currentView,
  issueNodeId,
  layoutGraph,
  paperNodeId,
  recallSeries,
  removeIssue,
  removeLink,
  updateIssue,
  type Issue,
  type IssuesFile,
} from "@/core/issues/model";
import { editIssues, loadIssues } from "@/core/issues/actions";
import { NoticedBadge, StanceChip } from "../components/IssuesPanel";
import { ConfirmButton } from "../components/ConfirmButton";

const POS_KEY = "odop.issueMap.positions";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** ドラッグで置いた位置。見た目の好みなので、この端末のブラウザにだけ残す */
function loadPositions(): Map<string, { x: number; y: number }> {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(POS_KEY) ?? "{}")));
  } catch {
    return new Map();
  }
}
function savePositions(m: Map<string, { x: number; y: number }>) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    /* 保存できなくても困らない */
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const day = (iso: string) => iso.slice(0, 10);

type Selected = { kind: "issue"; id: string } | { kind: "paper"; id: string } | null;

export function IssuesPage({ state, go }: PageProps) {
  const [file, setFile] = useState<IssuesFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [includeSettled, setIncludeSettled] = useState(false);
  const [selected, setSelected] = useState<Selected>(null);
  const [newQuestion, setNewQuestion] = useState("");

  useEffect(() => {
    loadIssues(state).then(setFile, (e) => setErr(errText(e)));
  }, [state.settings.data_dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const papers = useMemo(() => new Map(state.papers.map((p) => [p.id, p])), [state.papers]);

  const edit = async (fn: (f: IssuesFile) => IssuesFile) => {
    setErr(null);
    try {
      setFile(await editIssues(state, fn));
    } catch (e) {
      setErr(errText(e));
    }
  };

  if (err && !file) return <p className="error">{err}</p>;
  if (!file) return <p className="muted">読み込み中…</p>;

  const addIssue = async () => {
    const q = newQuestion.trim();
    if (!q) return;
    const now = new Date().toISOString();
    const id = newId("q");
    await edit((f) => ({ ...f, issues: [...f.issues, { id, question: q, status: "open", created_at: now, updated_at: now, views: [] }] }));
    setNewQuestion("");
    setSelected({ kind: "issue", id });
  };

  const open = file.issues.filter((i) => i.status === "open").length;
  const linkedPapers = new Set(file.links.map((l) => l.paper_id)).size;

  return (
    <>
      <h1>論点マップ</h1>
      {file.issues.length === 0 ? (
        <div className="card hero">
          <p className="title">まだ論点がありません</p>
          <p className="muted">論文を読了したら、メモの画面の「論点」で「論点を探してもらう」を押してください。読んだ論文から分野の問いを拾って台帳にし、次の論文からは、その問いを支持するか、反するかでつないでいきます。下で自分で問いを立てることもできます。</p>
        </div>
      ) : (
        <>
          <div className="row">
            <div className="card" style={{ flex: 1 }}><div className="muted">論点</div><p className="title">{file.issues.length} 個</p><div className="muted">未解決 {open}・決着 {file.issues.length - open}</div></div>
            <div className="card" style={{ flex: 1 }}><div className="muted">つないだ論文</div><p className="title">{linkedPapers} 本</p></div>
            <RecallCard file={file} papers={papers} />
          </div>
          <div className="issue-map-layout">
            <div className="card issue-map-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <Legend />
                <label className="row muted"><input type="checkbox" checked={includeSettled} onChange={(e) => setIncludeSettled(e.target.checked)} /> 決着した論点も出す</label>
              </div>
              <IssueGraph file={file} papers={papers} includeSettled={includeSettled} selected={selected} onSelect={setSelected} />
            </div>
            <div className="issue-detail">
              {selected?.kind === "issue" && file.issues.some((i) => i.id === selected.id) && (
                <IssueDetail key={selected.id} issue={file.issues.find((i) => i.id === selected.id)!} file={file} papers={papers} go={go} edit={edit} onSelect={setSelected} />
              )}
              {selected?.kind === "paper" && <PaperDetail paperId={selected.id} file={file} papers={papers} go={go} onSelect={setSelected} />}
              {!selected && <div className="card muted">丸(論点)か四角(論文)を押すと、ここに詳しく出ます。ドラッグで動かせます。</div>}
            </div>
          </div>
        </>
      )}
      <div className="card">
        <div className="field">
          <label>自分で論点を立てる(「〜か?」の形で)</label>
          <div className="row">
            <input style={{ flex: 1, minWidth: 200 }} value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addIssue()} placeholder="例: 事前学習の規模を増やせば、少数ショットの性能は頭打ちにならないか?" />
            <button className="btn" disabled={!newQuestion.trim()} onClick={addIssue}>足す</button>
          </div>
        </div>
      </div>
      {file.issues.length > 0 && (
        <div className="card">
          <div className="muted">論点の一覧</div>
          <table>
            <thead><tr><th>論点</th><th>論文</th><th>状態</th><th>更新</th></tr></thead>
            <tbody>
              {[...file.issues].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((i) => (
                <tr key={i.id} className="clickable" onClick={() => setSelected({ kind: "issue", id: i.id })}>
                  <td>{i.question}</td>
                  <td>{file.links.filter((l) => l.issue_id === i.id).length}</td>
                  <td>{i.status === "open" ? "未解決" : "決着"}</td>
                  <td>{day(i.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </>
  );
}

function Legend() {
  return (
    <div className="u-legend issue-legend">
      {STANCES.map((s) => <span key={s}><i className={`edge-key s-${s}`} />{STANCE_LABELS[s]}</span>)}
      <span><i className="edge-key dashed" />AI だけが見つけた</span>
      <span><i className="node-key issue" />論点</span>
      <span><i className="node-key paper" />論文</span>
    </div>
  );
}

/** 「過去の論点を踏まえて書けたか」。直近 10 本 */
function RecallCard({ file, papers }: { file: IssuesFile; papers: Map<string, Paper> }) {
  const series = recallSeries(file).slice(-10);
  if (!series.length) return <div className="card" style={{ flex: 2 }}><div className="muted">過去の論点を踏まえて書けたか</div><p className="muted">2 本目以降の論文を台帳につなぐと出ます</p></div>;
  const linked = series.reduce((a, p) => a + p.linked, 0);
  const noticed = series.reduce((a, p) => a + p.noticed, 0);
  return (
    <div className="card" style={{ flex: 2 }}>
      <div className="muted">過去の論点を踏まえて書けたか(直近 {series.length} 本)</div>
      <p className="title">{noticed} / {linked} <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>つながりのうち、メモで自分から触れていた数</span></p>
      <div className="recall-strip" aria-label="論文ごと(古い順)">
        {series.map((p) => {
          const r = p.noticed / p.linked;
          return <span key={p.paper_id} className={r === 1 ? "all" : r > 0 ? "some" : "none"} title={`${papers.get(p.paper_id)?.title ?? p.paper_id}: ${p.noticed} / ${p.linked}`} />;
        })}
      </div>
    </div>
  );
}

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

function IssueGraph({ file, papers, includeSettled, selected, onSelect }: { file: IssuesFile; papers: Map<string, Paper>; includeSettled: boolean; selected: Selected; onSelect: (s: Selected) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const height = width < 500 ? 380 : 480;
  const graph = useMemo(() => buildGraph(file, { includeSettled }), [file, includeSettled]);
  const [pinned, setPinned] = useState(loadPositions);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 配置は構造と幅が変わったときだけ計算し直す。ドラッグ中は pinned だけを動かす
  const shape = graph.nodes.map((n) => n.id).join("|") + "#" + graph.edges.map((e) => e.source + e.target).join("|");
  const base = useMemo(() => {
    const inView = new Map([...pinned].filter(([, p]) => p.x <= width && p.y <= height));
    return layoutGraph(graph.nodes, graph.edges, width, height, inView);
  }, [shape, width, height]); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = (id: string) => pinned.get(id) ?? base.get(id) ?? { x: width / 2, y: height / 2 };

  const issues = new Map(file.issues.map((i) => [i.id, i]));
  const selId = selected ? (selected.kind === "issue" ? issueNodeId(selected.id) : paperNodeId(selected.id)) : null;
  const focus = hover ?? selId;
  const near = new Set<string>();
  if (focus) {
    near.add(focus);
    for (const e of graph.edges) {
      if (e.source === focus) near.add(e.target);
      if (e.target === focus) near.add(e.source);
    }
  }

  const toSvg = (ev: ReactPointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: Math.max(12, Math.min(width - 12, ev.clientX - r.left)), y: Math.max(12, Math.min(height - 12, ev.clientY - r.top)) };
  };
  const down = (id: string) => (ev: ReactPointerEvent) => {
    try {
      (ev.target as Element).setPointerCapture(ev.pointerId);
    } catch {
      /* 取れなくてもドラッグは svg の onPointerMove で追える */
    }
    drag.current = { id, moved: false };
  };
  const move = (ev: ReactPointerEvent) => {
    if (!drag.current) return;
    drag.current.moved = true;
    const p = toSvg(ev);
    setPinned((m) => new Map(m).set(drag.current!.id, p));
  };
  const up = (ev: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      setPinned((m) => {
        savePositions(m);
        return m;
      });
      return;
    }
    const n = graph.nodes.find((x) => x.id === d.id);
    if (n) onSelect({ kind: n.kind, id: n.id.slice(2) });
    ev.stopPropagation();
  };

  if (!graph.nodes.length) return <p className="muted">出せる論点がありません。「決着した論点も出す」を試してください。</p>;

  return (
    <div className="issue-graph" ref={ref}>
      <svg ref={svgRef} width={width} height={height} onPointerMove={move} onPointerUp={up} onClick={(e) => e.target === svgRef.current && onSelect(null)} role="img" aria-label="論点と論文のネットワーク">
        {graph.edges.map((e) => {
          const a = pos(e.source);
          const b = pos(e.target);
          const dim = focus && !(near.has(e.source) && near.has(e.target));
          return <line key={e.source + e.target} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`edge s-${e.link.stance}${e.link.in_memo ? "" : " dashed"}${dim ? " dim" : ""}`} />;
        })}
        {graph.nodes.map((n) => {
          const p = pos(n.id);
          const dim = focus && !near.has(n.id);
          const sel = n.id === selId;
          const common = {
            onPointerDown: down(n.id),
            onPointerEnter: () => setHover(n.id),
            onPointerLeave: () => setHover((h) => (h === n.id ? null : h)),
          };
          if (n.kind === "issue") {
            const issue = issues.get(n.id.slice(2));
            const r = 9 + Math.min(10, Math.sqrt(n.degree) * 3);
            const label = clip(issue?.question ?? "", 14);
            return (
              <g key={n.id} className={`node issue${issue?.status === "settled" ? " settled" : ""}${dim ? " dim" : ""}${sel ? " sel" : ""}`} {...common}>
                <circle cx={p.x} cy={p.y} r={r + 8} className="hit" />
                <circle cx={p.x} cy={p.y} r={r} />
                <text x={p.x} y={p.y + r + 13} textAnchor="middle">{label}</text>
              </g>
            );
          }
          const paper = papers.get(n.id.slice(2));
          const showLabel = sel || hover === n.id || (focus && near.has(n.id));
          return (
            <g key={n.id} className={`node paper${dim ? " dim" : ""}${sel ? " sel" : ""}`} {...common}>
              <rect x={p.x - 14} y={p.y - 14} width={28} height={28} className="hit" />
              <rect x={p.x - 6} y={p.y - 6} width={12} height={12} rx={2} />
              {showLabel && <text x={p.x} y={p.y - 11} textAnchor="middle">{paper ? shortLabel(paper) : "(削除した論文)"}</text>}
            </g>
          );
        })}
      </svg>
      {hover && <GraphTip id={hover} at={pos(hover)} width={width} issues={issues} papers={papers} />}
    </div>
  );
}

function GraphTip({ id, at, width, issues, papers }: { id: string; at: { x: number; y: number }; width: number; issues: Map<string, Issue>; papers: Map<string, Paper> }) {
  const issue = id.startsWith("i:") ? issues.get(id.slice(2)) : null;
  const paper = id.startsWith("p:") ? papers.get(id.slice(2)) : null;
  return (
    <div className="u-tip" style={{ left: Math.min(Math.max(0, at.x - 120), width - 250), top: at.y + 26 }}>
      {issue ? (
        <>
          <strong>{issue.question}</strong>
          {currentView(issue) && <span>{clip(currentView(issue), 120)}</span>}
        </>
      ) : (
        <strong>{paper?.title ?? "(削除した論文)"}</strong>
      )}
    </div>
  );
}

function IssueDetail({ issue, file, papers, go, edit, onSelect }: { issue: Issue; file: IssuesFile; papers: Map<string, Paper>; go: PageProps["go"]; edit: (fn: (f: IssuesFile) => IssuesFile) => Promise<void>; onSelect: (s: Selected) => void }) {
  const [question, setQuestion] = useState(issue.question);
  const [view, setView] = useState(currentView(issue));
  const links = file.links.filter((l) => l.issue_id === issue.id).sort((a, b) => a.at.localeCompare(b.at));
  const now = () => new Date().toISOString();
  const dirty = question.trim() !== issue.question || view.trim() !== currentView(issue);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="badge">{issue.status === "open" ? "未解決" : "決着"}</span>
        <button className="btn secondary small" onClick={() => edit((f) => updateIssue(f, issue.id, { status: issue.status === "open" ? "settled" : "open" }, now()))}>
          {issue.status === "open" ? "決着したことにする" : "未解決に戻す"}
        </button>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label>論点</label>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} />
      </div>
      <div className="field">
        <label>今の理解(自分の言葉で)</label>
        <textarea rows={4} value={view} onChange={(e) => setView(e.target.value)} />
      </div>
      <button className="btn small" disabled={!dirty} onClick={() => edit((f) => updateIssue(f, issue.id, { question, view }, now()))}>書き直す</button>

      <h2>つながっている論文</h2>
      {links.length === 0 && <p className="muted">まだありません</p>}
      {links.map((l) => {
        const p = papers.get(l.paper_id);
        return (
          <div key={l.paper_id} className="proposal-item">
            <div className="row"><StanceChip stance={l.stance} /><NoticedBadge link={l} /><span className="muted">{day(l.at)}</span></div>
            <button className="link q" onClick={() => onSelect({ kind: "paper", id: l.paper_id })}>{p?.title ?? "(削除した論文)"}</button>
            <p className="note">{l.note}</p>
            <div className="row">
              {p && <button className="btn secondary small" onClick={() => go({ name: "editor", paperId: p.id })}>メモを開く</button>}
              <ConfirmButton label="つながりを外す" confirmLabel="外す" className="btn secondary small" onConfirm={() => edit((f) => removeLink(f, issue.id, l.paper_id))} />
            </div>
          </div>
        );
      })}

      {issue.views.length > 0 && (
        <>
          <h2>理解の移り変わり</h2>
          <ol className="view-history">
            {issue.views.map((v, i) => (
              <li key={i} className={i === issue.views.length - 1 ? "current" : ""}>
                <div className="muted">{day(v.at)}・{v.paper_id ? (papers.get(v.paper_id) ? shortLabel(papers.get(v.paper_id)!) : "(削除した論文)") + " を読んで" : "自分で書き直し"}</div>
                {v.text}
              </li>
            ))}
          </ol>
        </>
      )}
      <div style={{ marginTop: 12 }}>
        <ConfirmButton label="この論点を消す" confirmLabel="消す(つながりも消えます)" onConfirm={async () => { await edit((f) => removeIssue(f, issue.id)); onSelect(null); }} />
      </div>
    </div>
  );
}

function PaperDetail({ paperId, file, papers, go, onSelect }: { paperId: string; file: IssuesFile; papers: Map<string, Paper>; go: PageProps["go"]; onSelect: (s: Selected) => void }) {
  const p = papers.get(paperId);
  const issues = new Map(file.issues.map((i) => [i.id, i]));
  const links = file.links.filter((l) => l.paper_id === paperId);
  return (
    <div className="card">
      <p className="title">{p?.title ?? "(削除した論文)"}</p>
      {p && <button className="btn secondary small" onClick={() => go({ name: "editor", paperId })}>メモを開く</button>}
      <h2>この論文と論点</h2>
      {links.map((l) => (
        <div key={l.issue_id} className="proposal-item">
          <div className="row"><StanceChip stance={l.stance} /><NoticedBadge link={l} /></div>
          <button className="link q" onClick={() => onSelect({ kind: "issue", id: l.issue_id })}>{issues.get(l.issue_id)?.question}</button>
          <p className="note">{l.note}</p>
        </div>
      ))}
    </div>
  );
}
