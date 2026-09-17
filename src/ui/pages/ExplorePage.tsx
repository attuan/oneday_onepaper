import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { COURSE_CRITERION, addMany, apiUsable, createCourse, searchPapers, type SearchResult } from "@/core/app";
import { STAGE_LABELS, buildCourse, stageOf } from "@/core/papers/course";
import { SOURCES, sourceInfo } from "@/core/scholar/sources";
import type { CourseStage, SourceId } from "@/core/types";

const COURSE_SIZES = [5, 10, 15];

export function ExplorePage({ state, setState, go }: PageProps) {
  const [keywords, setKeywords] = useState("");
  const [purpose, setPurpose] = useState("");
  const [useLlm, setUseLlm] = useState(true);
  const [sources, setSources] = useState<Set<SourceId>>(() => new Set(state.settings.search.sources));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  // コース: 「このテーマの入門 N 本」を順番つきで入れる(仕様 8.1)。入ったばかりの人にはこちらが既定
  const [mode, setMode] = useState<"course" | "free">("course");
  const [courseSize, setCourseSize] = useState(10);
  const [courseTitle, setCourseTitle] = useState("");
  const [stages, setStages] = useState<Map<string, CourseStage>>(new Map());

  // キーが無い人に、毎回「LLM に失敗しました」を見せない
  useEffect(() => {
    apiUsable(state.settings).then(setUseLlm);
  }, [state.settings]);

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
      const r = await searchPapers(state, keywords.trim(), purpose.trim(), useLlm, [...sources], mode === "course" ? COURSE_CRITERION : undefined);
      if (mode === "free") {
        setResult(r);
        setSelected(new Set(r.candidates.slice(0, 5).map((c) => c.id)));
        return;
      }
      // LLM が並べたならその順を信じる。無ければ題名と年から 全体像 → 基礎 → 最近 を組む
      const nowYear = Number(state.today.slice(0, 4));
      const course = r.usedLlm ? r.candidates.slice(0, courseSize).map((c) => ({ ...c, stage: stageOf(c, nowYear) })) : buildCourse(r.candidates, courseSize, nowYear);
      const inCourse = new Set(course.map((c) => c.id));
      setResult({ ...r, candidates: [...course, ...r.candidates.filter((c) => !inCourse.has(c.id))] });
      setSelected(inCourse);
      setStages(new Map(r.candidates.map((c) => [c.id, stageOf(c, nowYear)])));
      setCourseTitle(`${keywords.trim()} 入門`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!result) return;
    const chosen = result.candidates.filter((c) => selected.has(c.id));
    if (mode === "course") {
      const r = await createCourse(state, courseTitle, chosen.map((c) => ({ ...c, stage: stages.get(c.id) ?? "classic" })));
      setState(r.state);
      go({ name: "home" });
      return;
    }
    const r = await addMany(state, chosen.map((c) => ({ ...c, source: "llm" as const, reason: c.reason || null })));
    setState(r.state);
    go({ name: "papers" });
  };

  const hasJa = [...sources].some((id) => sourceInfo(id).lang === "ja");

  return (
    <>
      <h1>論文を探す</h1>
      <div className="card">
        <div className="row">
          <label><input type="radio" checked={mode === "course"} onChange={() => { setMode("course"); setResult(null); }} /> 入門コースを作る</label>
          <select value={courseSize} disabled={mode !== "course"} onChange={(e) => setCourseSize(Number(e.target.value))}>
            {COURSE_SIZES.map((n) => <option key={n} value={n}>{n} 本</option>)}
          </select>
          <label><input type="radio" checked={mode === "free"} onChange={() => { setMode("free"); setResult(null); }} /> 自由に探す</label>
        </div>
        {mode === "course" && <p className="muted">全体像が分かるもの → 基礎 → 最近の研究 の順に並べて、キューに入れます。終わりが見えるので、何から読めばいいか分からないときはこちら。</p>}
        <div className="field"><label>興味のあるキーワード</label><input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="例: retrieval augmented generation, evaluation" onKeyDown={(e) => e.key === "Enter" && keywords.trim() && sources.size > 0 && search()} /></div>
        <div className="field"><label>目的・補足(任意。LLM の順位付けに使う)</label><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例: 修論で RAG の評価手法を整理したい" /></div>
        {state.settings.advanced && (
        <div className="field">
          <label>検索するソース(既定は設定画面で変えられる)</label>
          <div className="row">
            {SOURCES.map((s) => (
              <label key={s.id} title={s.note}><input type="checkbox" checked={sources.has(s.id)} onChange={() => toggleSource(s.id)} /> {s.label}</label>
            ))}
          </div>
        </div>
        )}
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
            <button className="btn" disabled={selected.size === 0} onClick={add}>{mode === "course" ? `この ${selected.size} 本をコースとしてキューに入れる` : `選んだ ${selected.size} 本をリストに追加`}</button>
          </div>
          {mode === "course" && (
            <>
              <div className="field"><label>コースの名前</label><input value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} /></div>
              <p className="muted">チェックの付いたものが、上から順にコースになります。外したり、下の候補から足したりできます。{!result.usedLlm && " LLM を使っていないので、題名と年と被引用数から組んでいます。"}</p>
            </>
          )}
          <table>
            <tbody>
              {result.candidates.map((c) => (
                <tr key={c.id}>
                  <td style={{ width: 30 }}><input type="checkbox" checked={selected.has(c.id)} onChange={(e) => { const s = new Set(selected); e.target.checked ? s.add(c.id) : s.delete(c.id); setSelected(s); }} /></td>
                  <td style={{ width: 30 }} className="muted">{c.rank}</td>
                  <td>
                    {mode === "course" && <span className="badge">{STAGE_LABELS[stages.get(c.id) ?? "classic"]}</span>} <strong>{c.title}</strong>
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
