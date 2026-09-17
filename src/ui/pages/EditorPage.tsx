import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "../App";
import { openMemo, persistMemo, shareCompletion } from "@/core/app";
import type { Memo } from "@/core/types";
import { countMemoChars } from "@/core/memo/format";
import { LEVEL_LABELS, judgeCompletion, levelThresholds } from "@/core/memo/completion";
import { PaperLinks, PaperMeta } from "../components/PaperCard";
import { Pomodoro } from "../components/Pomodoro";
import { AiPanel } from "../components/AiPanel";

export function EditorPage({ state, setState, go, paperId }: PageProps & { paperId: string }) {
  const paper = state.papers.find((p) => p.id === paperId);
  const [memo, setMemo] = useState<Memo | null>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!paper) return;
    openMemo(state, paper).then((m) => {
      setMemo(m);
      setBody(m.body);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  const chars = useMemo(() => countMemoChars(body), [body]);
  const thresholds = levelThresholds(state.settings);
  const completion = judgeCompletion(chars, thresholds, memo?.frontmatter.level ?? 0);

  if (!paper) return <p className="error">論文が見つかりません</p>;
  if (!memo) return <p className="muted">読み込み中…</p>;

  const save = async () => {
    setSaving(true);
    try {
      const r = await persistMemo(state, memo, body);
      setState(r.state);
      setMemo(r.memo);
      setDirty(false);
      const lv = r.memo.frontmatter.level;
      if (r.newlyCompleted) {
        const extra = r.state.memos.filter((m) => m.frontmatter.completed && m.frontmatter.date === r.state.today).length > 1;
        setMsg(
          extra
            ? "読了になりました(今日 2 本目以降)。1 日 1 本を毎日続けることを勧めます。"
            : `読了になりました(Lv${lv} ${LEVEL_LABELS[lv]})。今日の記録はつきました。${lv < 3 ? "余力があれば続きをどうぞ。" : "AI 要約と採点を実行できます。"}`,
        );
        void share(r.state, r.memo);
      } else {
        setMsg(lv > memo.frontmatter.level ? `Lv${lv} ${LEVEL_LABELS[lv]} になりました` : "保存しました");
      }
    } catch (e) {
      setMsg(`保存に失敗: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const share = async (st: PageProps["state"], m: Memo) => {
    setSharing(true);
    setShareMsg(null);
    try {
      if (await shareCompletion(st, m)) setShareMsg("Slack に投稿しました");
    } catch (e) {
      setShareMsg(`Slack への投稿に失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSharing(false);
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
        {state.settings.pomodoro.enabled && <Pomodoro config={state.settings.pomodoro} />}
        <div className="card">
          <div className="muted">本文の文字数</div>
          <p className="title">{chars}{completion.next && ` / ${completion.next.required}`}</p>
          {completion.next && <div className="progress"><div style={{ width: `${Math.min(100, (chars / Math.max(1, completion.next.required)) * 100)}%` }} /></div>}
          <div className="levels">
            {([1, 2, 3] as const).map((lv) => (
              <span key={lv} className={completion.level >= lv ? "level reached" : "level"}>Lv{lv} {LEVEL_LABELS[lv]}<br />{thresholds[lv - 1]} 字</span>
            ))}
          </div>
          {completion.completed ? (
            <p className="ok">読了(Lv{completion.level} {LEVEL_LABELS[completion.level]}){completion.next && <span className="muted"> あと {completion.next.remaining} 文字で Lv{completion.next.level}</span>}</p>
          ) : (
            <p className="muted">あと {completion.next?.remaining} 文字で読了。まずは 1 行だけ。</p>
          )}
          {msg && <p className="muted">{msg}</p>}
          {state.settings.share.slack_on_complete && memo.frontmatter.completed && (
            <button className="btn secondary small" disabled={sharing || dirty} onClick={() => share(state, memo)}>{sharing ? "投稿中…" : "Slack にもう一度投稿"}</button>
          )}
          {shareMsg && <p className="muted">{shareMsg}</p>}
          <PaperLinks paper={paper} />
        </div>
        {memo.frontmatter.completed && <AiPanel state={state} setState={setState} memo={memo} paper={paper} />}
      </div>
    </div>
  );
}
