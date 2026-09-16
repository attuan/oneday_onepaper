import { useState } from "react";
import type { PageProps } from "../App";
import { addMany, searchPapers, type SearchResult } from "@/core/app";
import { SOURCES, sourceInfo } from "@/core/scholar/sources";
import type { SourceId } from "@/core/types";

export function ExplorePage({ state, setState, go }: PageProps) {
  const [keywords, setKeywords] = useState("");
  const [purpose, setPurpose] = useState("");
  const [useLlm, setUseLlm] = useState(true);
  const [sources, setSources] = useState<Set<SourceId>>(() => new Set(state.settings.search.sources));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const toggleSource = (id: SourceId) => {
    const s = new Set(sources);
    s.has(id) ? s.delete(id) : s.add(id);
    setSources(s);
  };

  const search = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await searchPapers(state, keywords.trim(), purpose.trim(), useLlm, [...sources]);
      setResult(r);
      setSelected(new Set(r.candidates.slice(0, 5).map((c) => c.id)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!result) return;
    const picked = result.candidates.filter((c) => selected.has(c.id)).map((c) => ({ ...c, source: "llm" as const, reason: c.reason || null }));
    const r = await addMany(state, picked);
    setState(r.state);
    go({ name: "papers" });
  };

  const hasJa = [...sources].some((id) => sourceInfo(id).lang === "ja");

  return (
    <>
      <h1>論文を探す</h1>
      <div className="card">
        <div className="field"><label>興味のあるキーワード</label><input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="例: retrieval augmented generation, evaluation" onKeyDown={(e) => e.key === "Enter" && keywords.trim() && sources.size > 0 && search()} /></div>
        <div className="field"><label>目的・補足(任意。LLM の順位付けに使う)</label><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例: 修論で RAG の評価手法を整理したい" /></div>
        <div className="field">
          <label>検索するソース(既定は設定画面で変えられる)</label>
          <div className="row">
            {SOURCES.map((s) => (
              <label key={s.id} title={s.note}><input type="checkbox" checked={sources.has(s.id)} onChange={() => toggleSource(s.id)} /> {s.label}</label>
            ))}
          </div>
        </div>
        <div className="row">
          <label><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} /> LLM でクエリ生成と順位付けをする({state.settings.llm.provider} / {state.settings.llm.model})</label>
        </div>
        <p className="muted">
          書誌情報は選んだソースの API から取り、DOI かタイトルが同じものは 1 件に統合します。
          {hasJa ? " CiNii / J-STAGE には日本語のクエリを投げます。" : ""}
          LLM は検索クエリの生成と「読むべき理由」の生成だけを担当し、論文の存在を保証させません。
        </p>
        <button className="btn" disabled={busy || !keywords.trim() || sources.size === 0} onClick={search}>{busy ? "検索中…" : "探す"}</button>
        {sources.size === 0 && <p className="error">ソースを 1 つ以上選んでください</p>}
        {err && <p className="error">{err}</p>}
      </div>
      {result && (
        <>
          {result.warnings.map((w, i) => <p key={i} className="error">{w}</p>)}
          <p className="muted">
            クエリ: {result.queries.join(" / ")}
            {result.queriesJa.length > 0 && ` / 日本語: ${result.queriesJa.join(" / ")}`}
            {result.usedLlm ? "(LLM が順位付け)" : "(被引用数順)"}
          </p>
          <p className="muted">取得件数: {result.perSource.map((p) => `${sourceInfo(p.id).label} ${p.count}`).join(" · ")}</p>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>候補({result.candidates.length})</h2>
            <button className="btn" disabled={selected.size === 0} onClick={add}>選んだ {selected.size} 本をリストに追加</button>
          </div>
          <table>
            <tbody>
              {result.candidates.map((c) => (
                <tr key={c.id}>
                  <td style={{ width: 30 }}><input type="checkbox" checked={selected.has(c.id)} onChange={(e) => { const s = new Set(selected); e.target.checked ? s.add(c.id) : s.delete(c.id); setSelected(s); }} /></td>
                  <td style={{ width: 30 }} className="muted">{c.rank}</td>
                  <td>
                    <strong>{c.title}</strong>
                    <div className="muted">
                      {[(c.authors ?? []).slice(0, 3).join(", "), c.year, c.venue, c.cited_by > 0 ? `被引用 ${c.cited_by}` : null, c.pdf_url ? "PDF あり" : null, (c.sources ?? []).map((s) => sourceInfo(s).label).join("+")].filter(Boolean).join(" · ")}
                    </div>
                    {c.reason && <div>{c.reason}</div>}
                    {c.abstract && <details><summary className="muted">アブストラクト</summary><p className="muted">{c.abstract}</p></details>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
