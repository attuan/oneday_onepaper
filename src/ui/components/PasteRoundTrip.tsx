import { useRef, useState } from "react";
import { copyText } from "../clipboard";

/**
 * API を通さずに LLM に頼む往復(仕様 7.4)。プロンプトをコピーして好きなチャット AI に貼り、回答を貼り戻してもらう。
 * onAnswer は読めなければ投げる。メッセージはそのまま見せる
 */
export function PasteRoundTrip({ prompt, onAnswer, copyLabel = "1. プロンプトをコピー", pasteLabel = "2. 回答を貼り付ける" }: { prompt: string; onAnswer: (text: string) => void | Promise<void>; copyLabel?: string; pasteLabel?: string }) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    setErr(null);
    if (!(await copyText(prompt, promptRef.current))) {
      setManualOpen(true);
      setErr("クリップボードに書き込めませんでした。下の「プロンプト」欄を長押し(右クリック)して全選択し、手でコピーしてください");
      return;
    }
    setCopied(true);
    setNote("プロンプトをコピーしました。ChatGPT や Claude などに貼り、返ってきた JSON をコピーして戻ってきてください。");
  };

  /** 読めたら true */
  const accept = async (raw: string): Promise<boolean> => {
    setBusy(true);
    setErr(null);
    try {
      await onAnswer(raw);
      setNote(null);
      setAnswer("");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    let raw: string;
    try {
      raw = await navigator.clipboard.readText();
    } catch {
      setManualOpen(true);
      setErr("クリップボードを読めませんでした。下の「AI の回答」欄に貼り付けて「読み込む」を押してください");
      return;
    }
    // 読めなかったときは、何を読んだかが見えるように欄に入れておく
    if (!(await accept(raw))) {
      setAnswer(raw);
      setManualOpen(true);
    }
  };

  return (
    <>
      <div className="row">
        <button className={copied ? "btn secondary" : "btn"} disabled={busy} onClick={copy}>{copyLabel}</button>
        <button className={copied ? "btn" : "btn secondary"} disabled={busy} onClick={paste}>{busy ? "読み込み中…" : pasteLabel}</button>
      </div>
      {note && <p className="muted">{note}</p>}
      {err && <p className="error">{err}</p>}
      <details open={manualOpen} onToggle={(e) => setManualOpen(e.currentTarget.open)}>
        <summary className="muted">うまくいかないとき(手でコピー・貼り付け)</summary>
        <div className="field">
          <label>プロンプト</label>
          <textarea ref={promptRef} rows={4} readOnly value={prompt} onClick={(e) => e.currentTarget.setSelectionRange(0, prompt.length)} />
        </div>
        <div className="field">
          <label>AI の回答</label>
          <textarea rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="{ ... }" />
        </div>
        <button className="btn secondary small" disabled={busy || !answer.trim()} onClick={() => accept(answer)}>読み込む</button>
      </details>
    </>
  );
}
