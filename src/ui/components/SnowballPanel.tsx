import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { addSnowballed, apiUsable, applySnowballRankAnswer, rankSnowball, snowball, snowballRankPrompt, type SnowballDirection, type SnowballResult } from "@/core/app";
import type { Paper } from "@/core/types";
import { ConfirmButton } from "./ConfirmButton";
import { PasteRoundTrip } from "./PasteRoundTrip";

/**
 * 引用をたどる(仕様 8.2)。種の論文が引いている論文(さかのぼる)と、引いている論文(その後を追う)を出して、選んでリストに足す。
 * 書誌も引用関係も OpenAlex の事実なので、LLM なしで成立する。LLM は並べ替えだけ(API と貼り付けの両対応)
 */
export function SnowballPanel({ state, setState, paper, onClose }: { state: PageProps["state"]; setState: PageProps["setState"]; paper: Paper; onClose: () => void }) {
  const [direction, setDirection] = useState<SnowballDirection>("backward");
  const [order, setOrder] = useState<"cited" | "recent">("cited");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ranking, setRanking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SnowballResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string[]>([]);
  const [apiOk, setApiOk] = useState(false);

  useEffect(() => {
    apiUsable(state.settings).then(setApiOk);
  }, [state.settings]);

  useEffect(() => {
    let gone = false;
    setBusy(true);
    setErr(null);
    setResult(null);
    setSelected(new Set());
    setMsg([]);
    snowball(state, paper, direction, order)
      .then((r) => !gone && setResult(r))
      .catch((e) => !gone && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => !gone && setBusy(false));
    return () => {
      gone = true;
    };
    // state は依存に入れない(追加のたびに API を引き直さない。バッジは追加時に手元で更新する)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.id, direction, order]);

  const toggle = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const add = async () => {
    if (!result || !selected.size) return;
    setAdding(true);
    try {
      const r = await addSnowballed(state, paper, result.candidates.filter((c) => selected.has(c.id)), direction);
      setState(r.state);
      setMsg([`${r.added} 本を追加しました`, ...r.errors]);
      setResult({ ...result, candidates: result.candidates.map((c) => (selected.has(c.id) ? { ...c, known: c.known ?? "unread" } : c)) });
      setSelected(new Set());
    } catch (e) {
      setMsg(["", `追加に失敗: ${e instanceof Error ? e.message : e}`]);
    } finally {
      setAdding(false);
    }
  };

  const rankApi = async () => {
    if (!result) return;
    setRanking(true);
    try {
      setResult(await rankSnowball(state, result, paper));
    } catch (e) {
      setMsg(["", `並べ替えに失敗: ${e instanceof Error ? e.message : e}`]);
    } finally {
      setRanking(false);
    }
  };

  const rankPrompt = result ? snowballRankPrompt(state, result, paper) : "";
  const orderLabel = result?.usedLlm ? "AI が並べた順" : direction === "forward" && order === "recent" ? "新しい順" : "リストとの共引用が多い順 → 被引用数順";

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ marginTop: 0 }}>引用をたどる</h2>
        <button className="btn secondary small" onClick={onClose}>閉じる</button>
      </div>
      <p className="muted">種: <strong>{paper.title}</strong></p>
      <div className="row">
        <label><input type="radio" checked={direction === "backward"} onChange={() => setDirection("backward")} /> この論文が引いている(さかのぼる)</label>
        <label><input type="radio" checked={direction === "forward"} onChange={() => setDirection("forward")} /> この論文を引いている(その後を追う)</label>
        {direction === "forward" && (
          <select value={order} onChange={(e) => setOrder(e.target.value as typeof order)}>
            <option value="cited">被引用数順</option>
            <option value="recent">新しい順</option>
          </select>
        )}
      </div>
      <p className="muted">
        {direction === "backward"
          ? "この論文の土台になった基礎・古典が出ます。"
          : "この論文のその後の発展と、より新しいサーベイが出ます。古典を種にすると最近の研究に届きます。"}
        書誌も引用関係も OpenAlex から取るので、実在は保証されています。
      </p>
      {busy && <p className="muted">引用をたどっています…</p>}
      {err && <p className="error">{err}</p>}
      {msg.map((m, i) => m && <p key={i} className={i === 0 ? "ok" : "error"}>{m}</p>)}
      {result && (
        <>
          {result.warnings.map((w, i) => <p key={i} className="error">{w}</p>)}
          <p className="muted">
            この論文は {result.total} 本{direction === "backward" ? "を引用しています" : "に引用されています"}
            {result.total > result.candidates.length && `(うち ${result.candidates.length} 本を表示)`}。並び: {orderLabel}
          </p>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>候補({result.candidates.length})</h3>
            <button className="btn" disabled={adding || selected.size === 0} onClick={add}>{adding ? "追加中…" : `選んだ ${selected.size} 本をリストに追加`}</button>
          </div>
          <table>
            <tbody>
              {result.candidates.map((c) => (
                <tr key={c.id}>
                  <td style={{ width: 30 }}>
                    <input type="checkbox" checked={selected.has(c.id)} disabled={c.known !== null} onChange={() => toggle(c.id)} aria-label={`${c.title} を追加する`} />
                  </td>
                  <td style={{ width: 30 }} className="muted">{c.rank}</td>
                  <td>
                    {c.survey && <span className="badge" title="題名からサーベイ・解説らしいもの">全体像</span>}
                    {c.known === "read" && <span className="badge">読了</span>}
                    {c.known === "unread" && <span className="badge">リストにあります</span>}
                    {c.coCited > 0 && <span className="badge" title="あなたのリストの他の論文のうち、これを引用している本数。多いほどこの分野の背骨の可能性が高い">リストの他の {c.coCited} 本も引用</span>}
                    {" "}<strong>{c.title}</strong>
                    <div className="muted">{[(c.authors ?? []).slice(0, 3).join(", "), c.year, c.venue, c.cited_by > 0 ? `被引用 ${c.cited_by}` : null, c.pdf_url ? "PDF あり" : null].filter(Boolean).join(" · ")}</div>
                    {c.reason && <div>{c.reason}</div>}
                    {c.abstract && <details><summary className="muted">アブストラクト</summary><p className="muted">{c.abstract}</p></details>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.candidates.length > 0 && (
            <details className="field">
              <summary>AI に並べてもらう(任意){result.usedLlm && " — 済み"}</summary>
              <p className="muted">
                候補の書誌とアブストを渡して、{direction === "backward" ? "種の論文を理解するために先に読む順" : "その後を知るために読む順"}に並べ、理由を付けてもらいます。
                候補にない論文は足させません。
              </p>
              {apiOk && (
                <p>
                  <ConfirmButton label="API で並べ替え" confirmLabel={`API を呼んで ${result.candidates.length} 本を並べ替える`} className="btn secondary small" disabled={ranking} onConfirm={rankApi} />
                  {ranking && <span className="muted"> 並べ替え中…</span>}
                </p>
              )}
              <PasteRoundTrip prompt={rankPrompt} onAnswer={(t) => setResult(applySnowballRankAnswer(result, t, rankPrompt))} />
            </details>
          )}
        </>
      )}
    </div>
  );
}
