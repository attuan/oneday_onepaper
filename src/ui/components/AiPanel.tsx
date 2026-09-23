import { useEffect, useRef, useState } from "react";
import type { PageProps } from "../App";
import { apiUsable, estimateAiCost, extractFulltext, hasPdf, loadAiOutputs, platform, runAi, saveHandoffResult, updateSettings } from "@/core/app";
import type { AiVia, GradeOutput, Memo, Paper, SummaryField, SummaryOutput } from "@/core/types";
import { buildHandoffPrompt, handoffReturnUrl, shortcutRunUrl } from "@/core/llm/handoff";
import type { PaperContext } from "@/core/llm/tasks";
import { formatUsd } from "@/core/usage/cost";
import { clearPending, loadPending, savePending } from "../handoffPending";

type Via = Exclude<AiVia, "auto">;

const SUMMARY_LABELS: [SummaryField, string][] = [["problem", "問題"], ["method", "手法"], ["results", "結果"], ["limitations", "限界"]];

/** ショートカット App がある端末か。iPad の Safari は Macintosh を名乗る */
const appleDevice = () => /iPad|iPhone|Macintosh/.test(navigator.userAgent);

export function AiPanel({ state, setState, memo, paper }: { state: PageProps["state"]; setState: PageProps["setState"]; memo: Memo; paper: Paper }) {
  // ショートカットの戻り先は https のページなので、デスクトップ版からは使えない
  const shortcutAvailable = platform() === "web";
  const [summary, setSummary] = useState<SummaryOutput | null>(null);
  const [grade, setGrade] = useState<GradeOutput | null>(null);
  const [pending] = useState(() => loadPending(paper.id));
  const [inputKind, setInputKind] = useState<PaperContext["inputKind"]>(pending?.inputKind ?? (paper.kind === "article" && !paper.abstract ? "pasted" : "abstract"));
  const [pasted, setPasted] = useState(pending?.pasted ?? "");
  const [fulltext, setFulltext] = useState<{ text: string; tokens: number } | null>(null);
  const [pdfAvailable, setPdfAvailable] = useState(false);
  const [running, setRunning] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [via, setVia] = useState<Via | null>(null);
  /** 表示中の要約が何から作られたか */
  const [savedKind, setSavedKind] = useState<string | null>(null);
  const [handedOff, setHandedOff] = useState(!!pending);
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState<string | null>(pending ? "戻ってきました。「2. 結果を貼り付ける」を押してください。" : null);
  /** 「うまくいかないとき」を開いておくか */
  const [manualOpen, setManualOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadAiOutputs(paper.id).then((o) => {
      setSavedKind(o.inputKind);
      setSummary(o.summary);
      setGrade(o.grade);
    });
    hasPdf(state, paper).then((h) => setPdfAvailable(h || !!paper.pdf_url));
  }, [paper.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 実行方法。auto は API が使えれば API、だめなら Apple の端末でショートカット、それ以外は貼り付け(仕様 7.4)
  useEffect(() => {
    const chosen = state.settings.llm.summary_via;
    if (chosen !== "auto") {
      setVia(chosen === "shortcut" && !shortcutAvailable ? "paste" : chosen);
      return;
    }
    apiUsable(state.settings).then((ok) => setVia(ok ? "api" : shortcutAvailable && appleDevice() ? "shortcut" : "paste"));
  }, [state.settings, shortcutAvailable]);

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

  const chooseVia = async (v: Via) => {
    setVia(v);
    setErr(null);
    setState(await updateSettings(state, { ...state.settings, llm: { ...state.settings.llm, summary_via: v } }));
  };

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const r = await runAi(state, ctx, memo);
      setSavedKind(ctx.inputKind);
      setState(r.state);
      setSummary(r.summary);
      setGrade(r.grade);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const prompt = buildHandoffPrompt(ctx, memo.body, state.settings.language);

  /** プロンプトをクリップボードに置く。ショートカットならそのまま起動する */
  const handOff = async () => {
    setErr(null);
    if (!(await copyText(prompt, promptRef.current))) {
      setManualOpen(true);
      setErr("クリップボードに書き込めませんでした。下の「プロンプト」欄を長押し(右クリック)して全選択し、手でコピーしてください");
      return;
    }
    savePending({ paperId: paper.id, inputKind, pasted: inputKind === "pasted" ? pasted : undefined });
    setHandedOff(true);
    if (via === "shortcut") {
      setNote("ショートカットを開きます。終わるとこのページに戻ります。");
      location.href = shortcutRunUrl(state.settings.llm.shortcut_name, handoffReturnUrl(location.href, paper.id));
    } else {
      setNote("プロンプトをコピーしました。ChatGPT や Claude などに貼り、返ってきた JSON をコピーして戻ってきてください。");
    }
  };

  /** 読めたら true */
  const accept = async (raw: string): Promise<boolean> => {
    setRunning(true);
    setErr(null);
    try {
      const r = await saveHandoffResult(state, memo, ctx, raw);
      clearPending();
      setSavedKind(ctx.inputKind);
      setState(r.state);
      setSummary(r.summary);
      setGrade(r.grade);
      setNote(null);
      setAnswer("");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setRunning(false);
    }
  };

  const pasteAnswer = async () => {
    let raw: string;
    try {
      raw = await navigator.clipboard.readText();
    } catch {
      setManualOpen(true);
      setErr("クリップボードを読めませんでした。下の「AI の回答」欄に貼り付けて「読み込む」を押してください");
      return;
    }
    // 読めなかったときは、何を読んだかが見えるように欄に入れておく。そこで直して読み込み直せる
    if (!(await accept(raw))) {
      setAnswer(raw);
      setManualOpen(true);
    }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>AI 要約とフィードバック</h2>
      {!summary && memo.frontmatter.level < 3 && <p className="muted">フィードバックはメモ全体が対象です。書き足してから実行すると、返ってくるものも具体的になります。</p>}
      {!summary && via && (
        <>
          <div className="field">
            <label>実行方法</label>
            <select value={via} onChange={(e) => chooseVia(e.target.value as Via)}>
              <option value="api">API({state.settings.llm.provider} / {state.settings.llm.model})</option>
              {shortcutAvailable && <option value="shortcut">Apple Intelligence(ショートカット経由・キー不要)</option>}
              <option value="paste">好きな AI に貼り付ける(キー不要)</option>
            </select>
          </div>
          <div className="field">
            <label>LLM に渡す論文情報</label>
            <select value={inputKind} onChange={(e) => setInputKind(e.target.value as PaperContext["inputKind"])}>
              <option value="abstract">アブストラクトのみ(既定{via === "api" && `・約 ${formatUsd(absEst.costUsd)}`})</option>
              <option value="fulltext" disabled={!pdfAvailable}>全文 PDF{pdfAvailable ? (fulltext ? `(約 ${fulltext.tokens.toLocaleString()} トークン)` : "") : "(PDF なし)"}</option>
              <option value="pasted">本文を貼り付ける</option>
            </select>
          </div>
          {inputKind === "pasted" && (
            <div className="field">
              <textarea rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="論文本文をここに貼り付け" />
              {handedOff && <p className="muted">プロンプトをコピーした後に本文を変えたときは、「1. プロンプトをコピー」からやり直してください。</p>}
            </div>
          )}
          {extracting && <p className="muted">PDF から本文を抽出中…</p>}
          {via === "api" ? (
            <>
              <p className="muted">
                推定: 入力 約 {est.inputTokens.toLocaleString()} トークン + 出力 約 {est.outputTokensGuess.toLocaleString()} トークン ≈ <strong>{formatUsd(est.costUsd)}</strong>
                {inputKind !== "abstract" && <><br />アブストのみなら約 {formatUsd(absEst.costUsd)}</>}
              </p>
              <button className="btn" disabled={running || extracting} onClick={run}>{running ? "実行中…" : "要約とフィードバックを実行"}</button>
            </>
          ) : (
            <>
              {via === "shortcut" && inputKind !== "abstract" && <p className="muted">端末内のモデルは長い文章を扱えません。全文を渡すなら、ショートカット側のモデルを Private Cloud Compute にしてください。</p>}
              <div className="row">
                <button className={handedOff ? "btn secondary" : "btn"} disabled={running || extracting} onClick={handOff}>
                  {via === "shortcut" ? "1. Apple Intelligence で実行" : "1. プロンプトをコピー"}
                </button>
                <button className={handedOff ? "btn" : "btn secondary"} disabled={running || extracting} onClick={pasteAnswer}>2. 結果を貼り付ける</button>
              </div>
              {note && <p className="muted">{note}</p>}
              {via === "shortcut" && !handedOff && <p className="muted">初回は設定画面の手順でショートカット「{state.settings.llm.shortcut_name}」を作ってください。</p>}
              <details open={manualOpen} onToggle={(e) => setManualOpen(e.currentTarget.open)}>
                <summary className="muted">うまくいかないとき(手でコピー・貼り付け)</summary>
                <div className="field">
                  <label>プロンプト</label>
                  {/* onFocus で select() すると、直後のマウスアップで選択が外れる。クリックのたびに全体を選ぶ */}
                  <textarea ref={promptRef} rows={4} readOnly value={prompt} onClick={(e) => e.currentTarget.setSelectionRange(0, prompt.length)} />
                  <button className="btn secondary small" onClick={async () => setNote((await copyText(prompt, promptRef.current)) ? "プロンプトをコピーしました。" : "コピーできませんでした。欄を長押しして全選択し、コピーしてください。")}>プロンプトをコピー</button>
                </div>
                <div className="field">
                  <label>AI の回答</label>
                  <textarea rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder='{"summary": {...}, "grade": {...}}' />
                </div>
                <button className="btn secondary small" disabled={running || !answer.trim()} onClick={() => accept(answer)}>読み込む</button>
              </details>
            </>
          )}
          {err && <p className="error">{err}</p>}
        </>
      )}
      {summary && (
        <>
          <h2>要約</h2>
          {savedKind === "abstract" && <p className="badge">アブストラクトだけから作った要約です。本文の詳細は入っていません</p>}
          {SUMMARY_LABELS.map(([field, label]) => (
            <div key={field}>
              <p><strong>{label}</strong> {summary[field]}</p>
              {summary.evidence?.filter((e) => e.field === field).map((e, i) => (
                <blockquote key={i} className={e.found ? "evidence" : "evidence unverified"}>
                  {e.quote}
                  <span className="muted">{e.found ? " — 原文にあります" : " — 原文に見つかりません。要約のこの部分は確かめてください"}</span>
                </blockquote>
              ))}
            </div>
          ))}
        </>
      )}
      {summary && grade && (
        <>
          <h2>メモへのフィードバック</h2>
          <FeedbackList title="よく捉えている点" items={grade.good_points} />
          <FeedbackList title="論文にあってメモにない点" items={grade.missing_points} />
          <FeedbackList title="読み違えているかもしれない点" items={grade.misreadings} />
          {grade.next_step && <p><strong>次の一歩</strong> {grade.next_step}</p>}
          <p>{grade.overall_comment}</p>
          <details>
            <summary className="muted">点数を見る({grade.total} / 20)</summary>
            {grade.items.map((it) => (
              <div className="grade-item" key={it.name}>
                <span className="score">{it.score}/5</span>
                <span><strong>{it.name}</strong><br /><span className="muted">{it.comment}</span></span>
              </div>
            ))}
          </details>
        </>
      )}
      {summary && <button className="btn secondary small" onClick={() => { setSummary(null); setGrade(null); }}>やり直す</button>}
    </div>
  );
}

/** クリップボードに書く。navigator.clipboard が使えない環境(古い WebView など)では、欄を選択して execCommand で写す */
async function copyText(text: string, el: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!el || !el.isConnected) return false;
    el.focus();
    el.setSelectionRange(0, text.length);
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

function FeedbackList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <>
      <div className="muted">{title}</div>
      <ul>{items.map((m, i) => <li key={i}>{m}</li>)}</ul>
    </>
  );
}
