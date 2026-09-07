import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { downloadPdf, hasPdf, skipToday, today } from "@/core/app";
import { queue } from "@/core/papers/queue";
import { PaperLinks, PaperMeta } from "../components/PaperCard";
import { openPath } from "@tauri-apps/plugin-opener";
import { pdfPath } from "@/core/app";

export function TodayPage({ state, setState, go }: PageProps) {
  const paper = today(state);
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (paper) hasPdf(state, paper).then(setPdf);
  }, [paper?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!paper) {
    return (
      <>
        <h1>今日の論文</h1>
        <p className="muted">キューが空です。<button className="link" onClick={() => go({ name: "explore" })}>論文を探す</button>か、<button className="link" onClick={() => go({ name: "papers" })}>論文リスト</button>から追加してください。</p>
      </>
    );
  }
  const next = queue(state.papers)[1];
  const skip = async () => {
    if (!confirm(`「${paper.title}」を後回しにします。キューの末尾に移動し、次の論文を出します。`)) return;
    setBusy(true);
    setState(await skipToday(state, paper.id));
    setBusy(false);
  };
  const fetchPdf = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await downloadPdf(state, paper);
      setPdf(true);
      setMsg("PDF を保存しました");
    } catch (e) {
      setMsg(`PDF を取得できませんでした: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h1>今日の論文</h1>
      <div className="card hero">
        <p className="title">{paper.title}</p>
        <PaperMeta paper={paper} />
        <PaperLinks paper={paper} />
        <div className="row" style={{ marginTop: 8 }}>
          {pdf ? (
            <button className="btn secondary small" onClick={() => openPath(pdfPath(state.settings.data_dir, paper))}>保存済み PDF を開く</button>
          ) : paper.pdf_url ? (
            <button className="btn secondary small" disabled={busy} onClick={fetchPdf}>PDF を保存する</button>
          ) : null}
          {msg && <span className="muted">{msg}</span>}
        </div>
        {paper.reason && (<><h2>読むべき理由</h2><p>{paper.reason}</p></>)}
        {paper.abstract && (<><h2>アブストラクト</h2><p style={{ whiteSpace: "pre-wrap" }}>{paper.abstract}</p></>)}
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => go({ name: "editor", paperId: paper.id })}>メモを書く</button>
          <button className="btn secondary" disabled={busy || !next} onClick={skip}>
            スキップ{next ? `(次: ${next.title.slice(0, 24)}…)` : "(次がありません)"}
          </button>
        </div>
        {paper.skip_count > 0 && <p className="muted" style={{ marginTop: 8 }}>この論文は {paper.skip_count} 回スキップされています</p>}
      </div>
      <p className="muted">読了の条件: メモを保存し、本文が {state.settings.min_memo_chars} 文字以上あること。AI の要約と採点は読了後に表示されます。</p>
    </>
  );
}
