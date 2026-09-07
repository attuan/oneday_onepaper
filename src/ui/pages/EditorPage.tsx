import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "../App";
import { estimateAiCost, extractFulltext, hasPdf, loadAiOutputs, openMemo, persistMemo, runAi } from "@/core/app";
import type { GradeOutput, Memo, SummaryOutput } from "@/core/types";
import { countMemoChars } from "@/core/memo/format";
import { judgeCompletion } from "@/core/memo/completion";
import { formatUsd } from "@/core/usage/cost";
import type { PaperContext } from "@/core/llm/tasks";
import { PaperLinks, PaperMeta } from "../components/PaperCard";

export function EditorPage({ state, setState, go, paperId }: PageProps & { paperId: string }) {
  const paper = state.papers.find((p) => p.id === paperId);
  const [memo, setMemo] = useState<Memo | null>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!paper) return;
    openMemo(state, paper).then((m) => {
      setMemo(m);
      setBody(m.body);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  const chars = useMemo(() => countMemoChars(body), [body]);
  const completion = judgeCompletion(chars, state.settings.min_memo_chars, memo?.frontmatter.completed ?? false);

  if (!paper) return <p className="error">論文が見つかりません</p>;
  if (!memo) return <p className="muted">読み込み中…</p>;

  const save = async () => {
    setSaving(true);
    try {
      const r = await persistMemo(state, memo, body);
      setState(r.state);
      setMemo(r.memo);
      setDirty(false);
      setMsg(r.newlyCompleted ? "読了になりました。AI 要約と採点を実行できます。" : "保存しました");
      if (r.newlyCompleted && r.state.memos.filter((m) => m.frontmatter.completed && m.frontmatter.date === r.state.today).length > 1) {
        setMsg("読了になりました(今日 2 本目以降)。1 日 1 本を毎日続けることを勧めます。");
      }
    } catch (e) {
      setMsg(`保存に失敗: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editor">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>{paper.title}</strong>
            <PaperMeta paper={paper} />
          </div>
          <div className="row">
            <button className="btn" disabled={saving || !dirty} onClick={save}>保存 (⌘S)</button>
            <button className="btn secondary" onClick={() => go({ name: "home" })}>戻る</button>
          </div>
        </div>
        <textarea
          value={body}
          spellCheck={false}
          onChange={(e) => {
            setBody(e.target.value);
            setDirty(true);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              if (dirty) save();
            }
          }}
        />
      </div>
      <div className="side">
        <div className="card">
          <div className="muted">本文の文字数</div>
          <p className="title">{chars} / {completion.required}</p>
          <div className="progress"><div style={{ width: `${Math.min(100, (chars / completion.required) * 100)}%` }} /></div>
          {completion.completed ? <p className="ok">読了</p> : <p className="muted">あと {completion.remaining} 文字で読了</p>}
          {msg && <p className="muted">{msg}</p>}
          <PaperLinks paper={paper} />
        </div>
        {memo.frontmatter.completed && <AiPanel state={state} setState={setState} memo={memo} paperCtxBase={{ paper }} />}
      </div>
    </div>
  );
}

function AiPanel({ state, setState, memo, paperCtxBase }: { state: PageProps["state"]; setState: PageProps["setState"]; memo: Memo; paperCtxBase: { paper: PaperContext["paper"] } }) {
  const paper = paperCtxBase.paper;
  const [summary, setSummary] = useState<SummaryOutput | null>(null);
  const [grade, setGrade] = useState<GradeOutput | null>(null);
  const [inputKind, setInputKind] = useState<PaperContext["inputKind"]>("abstract");
  const [pasted, setPasted] = useState("");
  const [fulltext, setFulltext] = useState<{ text: string; tokens: number } | null>(null);
  const [pdfAvailable, setPdfAvailable] = useState(false);
  const [running, setRunning] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadAiOutputs(paper.id).then((o) => {
      setSummary(o.summary);
      setGrade(o.grade);
    });
    hasPdf(state, paper).then((h) => setPdfAvailable(h || !!paper.pdf_url));
  }, [paper.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 全文を選んだら抽出してトークン数を出す(仕様 7.3)
  useEffect(() => {
    if (inputKind !== "fulltext" || fulltext) return;
    setExtracting(true);
    setErr(null);
    extractFulltext(state, paper)
      .then((r) => {
        setState(r.state);
        setFulltext({ text: r.text, tokens: r.tokens });
      })
      .catch((e) => {
        setErr(`全文を用意できませんでした: ${e instanceof Error ? e.message : e}`);
        setInputKind("abstract");
      })
      .finally(() => setExtracting(false));
  }, [inputKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = inputKind === "pasted" ? pasted : inputKind === "fulltext" ? (fulltext?.text ?? "") : (paper.abstract ?? "");
  const ctx: PaperContext = { paper, text: text || "(アブストラクトなし。タイトルと書誌情報のみ)", inputKind };
  const est = estimateAiCost(state.settings, ctx, memo.body);
  const absEst = estimateAiCost(state.settings, { paper, text: paper.abstract ?? "", inputKind: "abstract" }, memo.body);

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const r = await runAi(state, ctx, memo);
      setState(r.state);
      setSummary(r.summary);
      setGrade(r.grade);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>AI 要約と採点</h2>
      {!summary && (
        <>
          <div className="field">
            <label>LLM に渡す論文情報</label>
            <select value={inputKind} onChange={(e) => setInputKind(e.target.value as PaperContext["inputKind"])}>
              <option value="abstract">アブストラクトのみ(既定・約 {formatUsd(absEst.costUsd)})</option>
              <option value="fulltext" disabled={!pdfAvailable}>全文 PDF{pdfAvailable ? (fulltext ? `(約 ${fulltext.tokens.toLocaleString()} トークン)` : "") : "(PDF なし)"}</option>
              <option value="pasted">本文を貼り付ける</option>
            </select>
          </div>
          {inputKind === "pasted" && (
            <div className="field">
              <textarea rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="論文本文をここに貼り付け" />
            </div>
          )}
          {extracting && <p className="muted">PDF から本文を抽出中…</p>}
          <p className="muted">
            推定: 入力 約 {est.inputTokens.toLocaleString()} トークン + 出力 約 {est.outputTokensGuess.toLocaleString()} トークン ≈ <strong>{formatUsd(est.costUsd)}</strong>
            <br />({state.settings.llm.provider} / {state.settings.llm.model})
            {inputKind !== "abstract" && <><br />アブストのみなら約 {formatUsd(absEst.costUsd)}</>}
          </p>
          <button className="btn" disabled={running || extracting} onClick={run}>{running ? "実行中…" : "要約と採点を実行"}</button>
          {err && <p className="error">{err}</p>}
        </>
      )}
      {summary && (
        <>
          <h2>要約</h2>
          <p><strong>問題</strong> {summary.problem}</p>
          <p><strong>手法</strong> {summary.method}</p>
          <p><strong>結果</strong> {summary.results}</p>
          <p><strong>限界</strong> {summary.limitations}</p>
        </>
      )}
      {grade && (
        <>
          <h2>採点 {grade.total} / 20</h2>
          {grade.items.map((it) => (
            <div className="grade-item" key={it.name}>
              <span className="score">{it.score}/5</span>
              <span><strong>{it.name}</strong><br /><span className="muted">{it.comment}</span></span>
            </div>
          ))}
          <p>{grade.overall_comment}</p>
          {grade.missing_points && grade.missing_points.length > 0 && (
            <>
              <div className="muted">本文にあってメモにない点</div>
              <ul>{grade.missing_points.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </>
          )}
          <button className="btn secondary small" onClick={() => { setSummary(null); setGrade(null); }}>やり直す</button>
        </>
      )}
    </div>
  );
}
