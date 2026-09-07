import { useState } from "react";
import type { PageProps } from "../App";
import { addPaper, importCsv, importDois, llmReorderQueue, remove, reorder } from "@/core/app";
import { queue } from "@/core/papers/queue";
import { PaperMeta } from "../components/PaperCard";
import { ConfirmButton } from "../components/ConfirmButton";

const CRITERIA = ["基礎から応用へ(読む順として自然な順)", "難易度が低い順", "新しい順", "被引用・影響力が大きい順"];

export function PapersPage({ state, setState, go }: PageProps) {
  const q = queue(state.papers);
  const read = state.papers.filter((p) => p.status === "read").sort((a, b) => (a.read_at! < b.read_at! ? 1 : -1));
  const [msg, setMsg] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showDoi, setShowDoi] = useState(false);
  const [doiText, setDoiText] = useState("");
  const [busy, setBusy] = useState(false);
  const [criterion, setCriterion] = useState(CRITERIA[0]);
  const [reasons, setReasons] = useState<Map<string, string>>(new Map());

  const move = async (id: string, dir: -1 | 1) => {
    const ids = q.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setState(await reorder(state, ids));
  };

  const onCsv = async (file: File) => {
    const r = await importCsv(state, await file.text());
    setState(r.state);
    setMsg([`${r.added} 本を追加しました`, ...r.errors]);
  };

  const onDoi = async () => {
    setBusy(true);
    try {
      const r = await importDois(state, doiText);
      setState(r.state);
      setMsg([`${r.added} 本を追加しました`, ...r.errors]);
      if (r.added) {
        setDoiText("");
        setShowDoi(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const onLlmReorder = async () => {
    setBusy(true);
    try {
      const r = await llmReorderQueue(state, criterion);
      setState(r.state);
      setReasons(r.reasons);
      setMsg(["並べ替えました"]);
    } catch (e) {
      setMsg(["", `並べ替えに失敗: ${e instanceof Error ? e.message : e}`]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>論文リスト</h1>
        <div className="row">
          <button className="btn secondary" onClick={() => go({ name: "explore" })}>論文を探す</button>
          <label className="btn secondary">
            CSV を読み込む
            <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />
          </label>
          <button className="btn secondary" onClick={() => setShowDoi((v) => !v)}>DOI で追加</button>
          <button className="btn" onClick={() => setShowAdd((v) => !v)}>手入力で追加</button>
        </div>
      </div>
      {msg.length > 0 && <div className="card">{msg.map((m, i) => m && <div key={i} className={i === 0 ? "ok" : "error"}>{m}</div>)}</div>}
      {showDoi && (
        <div className="card">
          <div className="field">
            <label>DOI または arXiv ID を 1 行に 1 つ(URL 形式でも可)。書誌情報は OpenAlex / arXiv から取ります</label>
            <textarea rows={4} value={doiText} onChange={(e) => setDoiText(e.target.value)} placeholder={"1706.03762\nhttps://doi.org/10.1109/CVPR.2016.90"} />
          </div>
          <button className="btn" disabled={busy || !doiText.trim()} onClick={onDoi}>{busy ? "取得中…" : "追加"}</button>
        </div>
      )}
      {showAdd && (
        <AddForm
          onAdd={async (input) => {
            setState(await addPaper(state, input));
            setShowAdd(false);
          }}
        />
      )}
      <p className="muted">CSV の列: title(必須), authors(「;」区切り), year, venue, doi, url, pdf_url, abstract, reason</p>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>キュー({q.length})</h2>
        {q.length >= 2 && (
          <div className="row">
            <select value={criterion} onChange={(e) => setCriterion(e.target.value)}>{CRITERIA.map((c) => <option key={c}>{c}</option>)}</select>
            <ConfirmButton label="LLM で並べ替え" confirmLabel={`API を呼んで ${q.length} 本を並べ替える`} className="btn secondary small" disabled={busy} onConfirm={onLlmReorder} />
          </div>
        )}
      </div>
      {q.length === 0 && <p className="muted">空です</p>}
      <table>
        <tbody>
          {q.map((p, i) => (
            <tr key={p.id}>
              <td style={{ width: 30 }} className="muted">{i + 1}</td>
              <td>
                <strong>{p.title}</strong>
                <PaperMeta paper={p} />
                {p.reason && <div className="muted">{p.reason}</div>}
                {reasons.get(p.id) && <div className="muted">並べ替えの理由: {reasons.get(p.id)}</div>}
              </td>
              <td style={{ whiteSpace: "nowrap", width: 220 }}>
                <button className="btn secondary small" onClick={() => move(p.id, -1)} disabled={i === 0}>↑</button>{" "}
                <button className="btn secondary small" onClick={() => move(p.id, 1)} disabled={i === q.length - 1}>↓</button>{" "}
                <button className="btn small" onClick={() => go({ name: "editor", paperId: p.id })}>メモ</button>{" "}
                <ConfirmButton label="外す" confirmLabel="外す(確定)" onConfirm={async () => setState(await remove(state, p.id))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>読了({read.length})</h2>
      <table>
        <tbody>
          {read.map((p) => (
            <tr key={p.id}>
              <td className="muted" style={{ width: 110 }}>{p.read_at?.slice(0, 10)}</td>
              <td><strong>{p.title}</strong><PaperMeta paper={p} /></td>
              <td style={{ width: 80 }}><button className="btn small secondary" onClick={() => go({ name: "editor", paperId: p.id })}>メモ</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AddForm({ onAdd }: { onAdd: (input: { title: string; authors: string[]; year: number | null; venue: string | null; doi: string | null; url: string | null; pdf_url: string | null; abstract: string | null; reason: string | null }) => Promise<void> }) {
  const [f, setF] = useState({ title: "", authors: "", year: "", venue: "", doi: "", url: "", pdf_url: "", abstract: "", reason: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = () =>
    onAdd({
      title: f.title.trim(),
      authors: f.authors.split(/[;,]/).map((s) => s.trim()).filter(Boolean),
      year: f.year ? Number(f.year) || null : null,
      venue: f.venue || null,
      doi: f.doi || null,
      url: f.url || null,
      pdf_url: f.pdf_url || null,
      abstract: f.abstract || null,
      reason: f.reason || null,
    });
  return (
    <div className="card">
      <div className="field"><label>タイトル(必須)</label><input value={f.title} onChange={set("title")} /></div>
      <div className="row">
        <div className="field" style={{ flex: 2 }}><label>著者(「;」区切り)</label><input value={f.authors} onChange={set("authors")} /></div>
        <div className="field" style={{ flex: 1 }}><label>年</label><input value={f.year} onChange={set("year")} /></div>
        <div className="field" style={{ flex: 1 }}><label>掲載</label><input value={f.venue} onChange={set("venue")} /></div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}><label>DOI</label><input value={f.doi} onChange={set("doi")} /></div>
        <div className="field" style={{ flex: 1 }}><label>URL</label><input value={f.url} onChange={set("url")} /></div>
        <div className="field" style={{ flex: 1 }}><label>PDF URL</label><input value={f.pdf_url} onChange={set("pdf_url")} /></div>
      </div>
      <div className="field"><label>アブストラクト</label><textarea rows={3} value={f.abstract} onChange={set("abstract")} /></div>
      <div className="field"><label>読むべき理由</label><input value={f.reason} onChange={set("reason")} /></div>
      <button className="btn" disabled={!f.title.trim()} onClick={submit}>追加</button>
    </div>
  );
}
