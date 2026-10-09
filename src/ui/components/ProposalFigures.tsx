// 研究計画書の図(任意)と書き出し(仕様 13)

import { useMemo, useRef, useState } from "react";
import type { PageProps } from "../App";
import type { MapPoint, Paper, Proposal, ScheduleRow } from "@/core/types";
import { exportProposalDocx, exportProposalLatex } from "@/core/app";
import { MAP_GEOMETRY, ganttSvg, mapSvg } from "@/core/proposal/figures";
import { checkProposal, citedKeys, defaultScheduleRows, newId, shortLabel } from "@/core/proposal/model";
import type { ProposalImages } from "@/core/proposal/docx";
import { svgToPng } from "../svgPng";

type Update = (fn: (prev: Proposal) => Proposal) => void;

export function ProposalFigures({ state, proposal: p, update, byKey, keyOf }: { state: PageProps["state"]; proposal: Proposal; update: Update; byKey: Map<string, Paper>; keyOf: Map<string, string> }) {
  const placeOptions = (
    <>
      {p.sections.map((s) => <option key={s.id} value={s.id}>「{s.heading || "(見出しなし)"}」の後ろ</option>)}
      <option value="">参考文献の前</option>
    </>
  );
  const setSchedule = (patch: Partial<Proposal["schedule"]>) => update((x) => ({ ...x, schedule: { ...x.schedule, ...patch } }));
  const setMap = (patch: Partial<Proposal["map"]>) => update((x) => ({ ...x, map: { ...x.map, ...patch } }));
  const setRow = (id: string, patch: Partial<ScheduleRow>) => setSchedule({ rows: p.schedule.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const gantt = useMemo(() => (p.schedule.enabled ? ganttSvg(p.schedule.rows) : null), [p.schedule]);

  return (
    <>
      <h2>図(任意)</h2>
      <div className="card">
        <label className="row">
          <input
            type="checkbox"
            checked={p.schedule.enabled}
            onChange={(e) => setSchedule({ enabled: e.target.checked, rows: e.target.checked && !p.schedule.rows.length ? defaultScheduleRows(state.today) : p.schedule.rows })}
          />
          <strong>研究スケジュール(ガントチャート)を入れる</strong>
        </label>
        {p.schedule.enabled && (
          <>
            <div className="row" style={{ marginTop: 8 }}>
              <div className="field" style={{ flex: 2 }}>
                <label>図の題</label>
                <input value={p.schedule.caption} onChange={(e) => setSchedule({ caption: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>置く場所</label>
                <select value={p.schedule.after_section ?? ""} onChange={(e) => setSchedule({ after_section: e.target.value || null })}>{placeOptions}</select>
              </div>
            </div>
            <table>
              <thead><tr><th>やること</th><th>始め</th><th>終わり</th><th /></tr></thead>
              <tbody>
                {p.schedule.rows.map((r) => (
                  <tr key={r.id}>
                    <td><input value={r.label} onChange={(e) => setRow(r.id, { label: e.target.value })} style={{ width: "100%" }} /></td>
                    <td><input type="month" value={r.start} onChange={(e) => setRow(r.id, { start: e.target.value })} /></td>
                    <td><input type="month" value={r.end} onChange={(e) => setRow(r.id, { end: e.target.value })} /></td>
                    <td><button className="btn secondary small" onClick={() => setSchedule({ rows: p.schedule.rows.filter((x) => x.id !== r.id) })}>消す</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn secondary small" style={{ marginTop: 8 }} onClick={() => setSchedule({ rows: [...p.schedule.rows, { id: newId("r"), label: "", start: p.schedule.rows.at(-1)?.end ?? state.today.slice(0, 7), end: p.schedule.rows.at(-1)?.end ?? state.today.slice(0, 7) }] })}>行を足す</button>
            {/* 自前で組んだ SVG。文字はエスケープ済み */}
            {gantt ? <div className="figure-preview" dangerouslySetInnerHTML={{ __html: gantt.svg }} /> : <p className="muted">始めと終わりの月を入れると図が出ます。</p>}
          </>
        )}
      </div>

      <div className="card">
        <label className="row">
          <input type="checkbox" checked={p.map.enabled} onChange={(e) => setMap({ enabled: e.target.checked })} />
          <strong>先行研究マップ(本研究の位置づけ)を入れる</strong>
        </label>
        {p.map.enabled && <MapEditor state={state} proposal={p} setMap={setMap} byKey={byKey} keyOf={keyOf} placeOptions={placeOptions} />}
      </div>
    </>
  );
}

function MapEditor({
  state,
  proposal: p,
  setMap,
  byKey,
  keyOf,
  placeOptions,
}: {
  state: PageProps["state"];
  proposal: Proposal;
  setMap: (patch: Partial<Proposal["map"]>) => void;
  byKey: Map<string, Paper>;
  keyOf: Map<string, string>;
  placeOptions: JSX.Element;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const m = p.map;
  const svg = useMemo(() => mapSvg(m, selected).svg, [m, selected]);
  const setPoint = (id: string, patch: Partial<MapPoint>) => setMap({ points: m.points.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  // 置ける論文: 本文で引用しているもの → 読んだもの → そのほか。もう置いたものは除く
  const placed = new Set(m.points.map((x) => x.paper_id));
  const cited = new Set(citedKeys(p.sections.map((s) => s.body)).map((k) => byKey.get(k)?.id));
  const read = new Set(state.memos.filter((x) => x.frontmatter.completed).map((x) => x.frontmatter.paper_id));
  const candidates = state.papers
    .filter((x) => x.status !== "removed" && !placed.has(x.id))
    .sort((a, b) => Number(cited.has(b.id)) - Number(cited.has(a.id)) || Number(read.has(b.id)) - Number(read.has(a.id)));

  const addPaper = (id: string) => {
    const paper = state.papers.find((x) => x.id === id);
    if (!paper) return;
    const n = m.points.length;
    setMap({ points: [...m.points, { id: newId("m"), paper_id: paper.id, label: shortLabel(paper), x: 0.15 + ((n * 0.23) % 0.6), y: 0.2 + ((n * 0.37) % 0.55) }] });
  };

  /** 画面上の位置を 0〜1 の座標に */
  const toXY = (clientX: number, clientY: number) => {
    const el = box.current?.querySelector("svg");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const sx = ((clientX - r.left) * MAP_GEOMETRY.width) / r.width;
    const sy = ((clientY - r.top) * MAP_GEOMETRY.height) / r.height;
    const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
    return { x: clamp((sx - MAP_GEOMETRY.left) / MAP_GEOMETRY.plotW), y: clamp(1 - (sy - MAP_GEOMETRY.top) / MAP_GEOMETRY.plotH), sx, sy };
  };

  const onDown = (e: React.PointerEvent) => {
    const at = toXY(e.clientX, e.clientY);
    if (!at) return;
    // 一番近い点を 20px(SVG 上)以内で拾う
    let best: { id: string; d: number } | null = null;
    for (const pt of m.points) {
      const px = MAP_GEOMETRY.left + pt.x * MAP_GEOMETRY.plotW;
      const py = MAP_GEOMETRY.top + (1 - pt.y) * MAP_GEOMETRY.plotH;
      const d = Math.hypot(px - at.sx, py - at.sy);
      if (d < 20 && (!best || d < best.d)) best = { id: pt.id, d };
    }
    setSelected(best?.id ?? null);
    if (best) {
      setDrag(best.id);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const at = toXY(e.clientX, e.clientY);
    if (at) setPoint(drag, { x: at.x, y: at.y });
  };

  const axis = (which: "x_axis" | "y_axis", end: "low" | "high", label: string, placeholder: string) => (
    <div className="field" style={{ flex: 1, minWidth: 140 }}>
      <label>{label}</label>
      <input value={m[which][end]} onChange={(e) => setMap({ [which]: { ...m[which], [end]: e.target.value } })} placeholder={placeholder} />
    </div>
  );

  return (
    <>
      <p className="muted">
        先行研究を 2 本の軸で並べ、本研究がどこを埋めるかを見せる図です。軸は自分で決めます。どの軸を選ぶかが、そのまま「自分の研究の何が新しいか」の説明になります。点はドラッグで動かせます。
      </p>
      <div className="row">
        {axis("x_axis", "low", "横軸の左端", "例: 手作業の特徴量")}
        {axis("x_axis", "high", "横軸の右端", "例: 学習で獲得")}
        {axis("y_axis", "low", "縦軸の下端", "例: 小規模データ")}
        {axis("y_axis", "high", "縦軸の上端", "例: 大規模データ")}
      </div>
      <div
        ref={box}
        className="figure-preview map-preview"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        // 自前で組んだ SVG。文字はエスケープ済み
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <table>
        <tbody>
          {m.points.map((pt) => (
            <tr key={pt.id} className={pt.id === selected ? "selected" : ""} onClick={() => setSelected(pt.id)}>
              <td style={{ width: "45%" }}>
                <input value={pt.label} onChange={(e) => setPoint(pt.id, { label: e.target.value })} style={{ width: "100%" }} />
              </td>
              <td className="muted">{pt.paper_id === null ? "本研究" : (state.papers.find((x) => x.id === pt.paper_id)?.title ?? "(論文リストから外れています)")}{pt.paper_id && keyOf.get(pt.paper_id) && <> ・ <code>[@{keyOf.get(pt.paper_id)}]</code></>}</td>
              <td style={{ width: 70 }}>{pt.paper_id !== null && <button className="btn secondary small" onClick={() => setMap({ points: m.points.filter((x) => x.id !== pt.id) })}>外す</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8 }}>
        <select value="" onChange={(e) => e.target.value && addPaper(e.target.value)} disabled={!candidates.length}>
          <option value="">{candidates.length ? "論文を点として足す…" : "足せる論文がありません"}</option>
          {candidates.slice(0, 200).map((x) => (
            <option key={x.id} value={x.id}>{cited.has(x.id) ? "[引用中] " : read.has(x.id) ? "[読んだ] " : ""}{shortLabel(x)} — {x.title.slice(0, 60)}</option>
          ))}
        </select>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div className="field" style={{ flex: 2 }}>
          <label>図の題</label>
          <input value={m.caption} onChange={(e) => setMap({ caption: e.target.value })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>置く場所</label>
          <select value={m.after_section ?? ""} onChange={(e) => setMap({ after_section: e.target.value || null })}>{placeOptions}</select>
        </div>
      </div>
    </>
  );
}

export function ProposalExport({ state, proposal: p, byKey }: { state: PageProps["state"]; proposal: Proposal; byKey: Map<string, Paper> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const check = useMemo(() => checkProposal(p, byKey), [p, byKey]);

  const images = async (): Promise<ProposalImages> => {
    const out: ProposalImages = {};
    if (p.schedule.enabled) {
      const g = ganttSvg(p.schedule.rows);
      if (g) out.schedule = { png: await svgToPng(g.svg, g.width, g.height), width: g.width, height: g.height };
    }
    if (p.map.enabled) {
      const g = mapSvg(p.map);
      out.map = { png: await svgToPng(g.svg, g.width, g.height), width: g.width, height: g.height };
    }
    return out;
  };

  const run = async (fn: typeof exportProposalDocx) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      setMsg(`書き出しました: ${await fn(state, p, await images())}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>書き出す</h2>
      {check.unknownKeys.length > 0 && <p className="error">論文リストに無い引用があります(書き出すと [?] になります): {check.unknownKeys.map((k) => `[@${k}]`).join(" ")}</p>}
      {check.overLimit.map((o) => <p key={o.heading} className="error">「{o.heading}」が上限を超えています({o.chars.toLocaleString()} / {o.limit.toLocaleString()} 字)</p>)}
      {check.empty.length > 0 && <p className="muted">まだ空の節: {check.empty.join("、")}</p>}
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => run(exportProposalDocx)}>{busy ? "書き出し中…" : "Word で書き出す"}</button>
        <button className="btn secondary" disabled={busy} onClick={() => run(exportProposalLatex)}>LaTeX で書き出す(任意)</button>
      </div>
      <p className="muted">
        Word は A4・本文 10.5pt で、見出しは Word の「見出し 1」になります。提出先の様式に合わせた細かい調整は Word でしてください。
        LaTeX は main.tex・refs.bib・図をまとめた ZIP です。LuaLaTeX でコンパイルします(Overleaf ではコンパイラを LuaLaTeX に)。
      </p>
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
