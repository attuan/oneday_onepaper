// 論点の台帳(仕様 7.6)のうち、メモの画面に出すもの。
// 書く前: これまでの論点(未解決)を見せる。読了後: この論文が台帳のどの論点にどう関わるかを AI に提案させ、選んで入れる
import "./issues.css";
import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { apiUsable, loadAiOutputs } from "@/core/app";
import type { Memo, Paper } from "@/core/types";
import { questionMaterial } from "@/core/understanding";
import { STANCE_LABELS, currentView, type AcceptedProposals, type IssueLink, type IssuesFile, type Stance } from "@/core/issues/model";
import { acceptProposals, issuesAsk, loadIssues, proposeIssues } from "@/core/issues/actions";
import { PasteRoundTrip } from "./PasteRoundTrip";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function StanceChip({ stance }: { stance: Stance }) {
  return <span className={`stance s-${stance}`}><i />{STANCE_LABELS[stance]}</span>;
}

export function NoticedBadge({ link }: { link: Pick<IssueLink, "in_memo"> }) {
  return link.in_memo ? <span className="noticed yes">✓ メモで触れていた</span> : <span className="noticed no">AI が見つけた</span>;
}

/** 書きながら見る、未解決の論点。台帳が空なら出さない */
export function IssuesReminder({ state, go }: { state: PageProps["state"]; go: PageProps["go"] }) {
  const [file, setFile] = useState<IssuesFile | null>(null);
  useEffect(() => {
    loadIssues(state).then(setFile, () => setFile(null));
  }, [state.settings.data_dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (file?.issues ?? []).filter((i) => i.status === "open").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (!open.length) return null;
  return (
    <details className="card issues-reminder">
      <summary><strong>これまでの論点</strong> <span className="muted">未解決 {open.length} 個。関係しそうなら、メモに書いてみる</span></summary>
      <ul>
        {open.slice(0, 5).map((i) => (
          <li key={i.id}>
            {i.question}
            {currentView(i) && <div className="muted">今の理解: {currentView(i)}</div>}
          </li>
        ))}
      </ul>
      <button className="link" onClick={() => go({ name: "issues" })}>論点マップを開く</button>
    </details>
  );
}

type Draft = AcceptedProposals;

export function IssuesPanel({ state, memo, paper, go }: { state: PageProps["state"]; memo: Memo; paper: Paper; go: PageProps["go"] }) {
  const [file, setFile] = useState<IssuesFile | null>(null);
  const [material, setMaterial] = useState<string | null>(null);
  const [useApi, setUseApi] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    loadIssues(state).then(setFile, (e) => setErr(errText(e)));
  }, [paper.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // AI 要約があれば材料に足す。採点のあとで要約が増えるので、state.memos が変わるたびに読み直す
  useEffect(() => {
    loadAiOutputs(paper.id).then((o) => setMaterial(questionMaterial(paper, o.summary)));
  }, [paper.id, state.memos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const via = state.settings.llm.summary_via;
    if (via === "api") setUseApi(true);
    else if (via === "auto") apiUsable(state.settings).then(setUseApi);
    else setUseApi(false);
  }, [state.settings]);

  if (!file || material === null || useApi === null) return err ? <div className="card"><p className="error">{err}</p></div> : null;

  const mine = file.links.filter((l) => l.paper_id === paper.id);
  const byId = new Map(file.issues.map((i) => [i.id, i]));
  const ask = issuesAsk(state, paper, material, memo.body, file);

  const gotProposals = (p: ReturnType<typeof ask.parse>) => {
    if (!p.links.length && !p.new_issues.length) throw new Error("この論文と関わる論点は見つかりませんでした");
    setDraft({ links: p.links.map((l) => ({ ...l, use: true, useView: !!l.new_view })), new_issues: p.new_issues.map((n) => ({ ...n, use: true })) });
    setAsking(false);
    setDone(null);
  };

  const runApi = async () => {
    setBusy(true);
    setErr(null);
    try {
      gotProposals(await proposeIssues(state, ask));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await acceptProposals(state, paper.id, draft);
      setFile(next);
      const past = draft.links.filter((l) => l.use);
      setDone(past.length ? `過去の論点 ${past.length} 個のうち、メモで自分から触れていたのは ${past.filter((l) => l.in_memo).length} 個でした。` : "台帳に入れました。");
      setDraft(null);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const setLink = (i: number, patch: Partial<Draft["links"][number]>) => draft && setDraft({ ...draft, links: draft.links.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setNew = (i: number, patch: Partial<Draft["new_issues"][number]>) => draft && setDraft({ ...draft, new_issues: draft.new_issues.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <div className="card issues-panel">
      <h2 style={{ marginTop: 0 }}>論点</h2>
      {draft ? (
        <>
          <p className="muted">AI の提案です。台帳に入れるものだけ選んでください。文は直せます。</p>
          {draft.links.map((l, i) => {
            const issue = byId.get(l.issue_id);
            if (!issue) return null;
            return (
              <div key={l.issue_id} className={l.use ? "proposal-item" : "proposal-item off"}>
                <label className="row"><input type="checkbox" checked={l.use} onChange={(e) => setLink(i, { use: e.target.checked })} /><StanceChip stance={l.stance} /><NoticedBadge link={l} /></label>
                <p className="q">{issue.question}</p>
                <p className="note">{l.note}</p>
                {l.new_view && (
                  <div className="view-change">
                    <div className="muted">今の理解: {currentView(issue) || "(まだ無い)"}</div>
                    <label className="row"><input type="checkbox" checked={l.useView} disabled={!l.use} onChange={(e) => setLink(i, { useView: e.target.checked })} /> この論文を踏まえて書き換える</label>
                    {l.useView && <textarea rows={3} value={l.new_view} onChange={(e) => setLink(i, { new_view: e.target.value })} />}
                  </div>
                )}
              </div>
            );
          })}
          {draft.new_issues.map((n, i) => (
            <div key={`n${i}`} className={n.use ? "proposal-item new" : "proposal-item new off"}>
              <label className="row"><input type="checkbox" checked={n.use} onChange={(e) => setNew(i, { use: e.target.checked })} /><span className="badge">新しい論点</span><StanceChip stance={n.stance} /><NoticedBadge link={n} /></label>
              <input className="q-input" value={n.question} onChange={(e) => setNew(i, { question: e.target.value })} />
              <p className="note">{n.note}</p>
              <textarea rows={2} value={n.view} placeholder="今わかっていること" onChange={(e) => setNew(i, { view: e.target.value })} />
            </div>
          ))}
          <div className="row">
            <button className="btn" disabled={busy} onClick={save}>選んだものを台帳に入れる</button>
            <button className="btn secondary small" disabled={busy} onClick={() => setDraft(null)}>やめる</button>
          </div>
        </>
      ) : (
        <>
          {mine.length > 0 ? (
            <>
              <p className="muted">この論文と論点のつながり</p>
              {mine.map((l) => (
                <div key={l.issue_id} className="proposal-item">
                  <div className="row"><StanceChip stance={l.stance} /><NoticedBadge link={l} /></div>
                  <p className="q">{byId.get(l.issue_id)?.question}</p>
                  <p className="note">{l.note}</p>
                </div>
              ))}
            </>
          ) : (
            <p className="muted">
              {file.issues.length
                ? `台帳の論点 ${file.issues.length} 個のうち、この論文がどれを支持し、どれに反するかを AI が探します。新しい問いがあれば論点として足します。`
                : "読んだ論文から、分野の問い(論点)を拾って台帳にしていきます。次の論文からは、その論点を支持するか、反するかでつながり、ネットワークの図になります。"}
            </p>
          )}
          {done && <p className="ok">{done}</p>}
          {useApi ? (
            <button className="btn small" disabled={busy} onClick={runApi}>{busy ? "考え中…" : mine.length ? "もう一度提案してもらう" : "論点を探してもらう"}</button>
          ) : asking ? (
            <PasteRoundTrip prompt={ask.prompt} onAnswer={(text) => gotProposals(ask.parse(text))} />
          ) : (
            <button className="btn small" onClick={() => setAsking(true)}>{mine.length ? "もう一度提案してもらう" : "論点を探してもらう"}(好きな AI に貼り付け)</button>
          )}
          {file.issues.length > 0 && <button className="link" style={{ marginLeft: 10 }} onClick={() => go({ name: "issues" })}>論点マップを開く</button>}
        </>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
