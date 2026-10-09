// はじめの一歩(仕様 13.1)。気になること → 検索語 → 論文の候補 → 問いの候補 → 自分の言葉の問い

import { useMemo, useState } from "react";
import type { PageProps } from "../App";
import type { ExploreCandidate, Proposal, ProposalExploration } from "@/core/types";
import { acceptQuestionsAnswer, applyRankAnswer, exploreCandidates, exploreQueries, exploreQueriesPrompt, exploreQuestions, exploreQuestionsPrompt, exploreSearch, queueExploreCandidates, rankExplore, rankExplorePrompt, type SearchResult } from "@/core/app";
import { parseRecommendAnswer } from "@/core/llm/handoff";
import { PasteRoundTrip } from "./PasteRoundTrip";

type Update = (fn: (prev: Proposal) => Proposal) => void;

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** 保存してある候補を、並べ替え(貼り付け)に渡せる形にする */
function asResult(ex: ProposalExploration): SearchResult {
  return { candidates: ex.candidates.map((c, i) => ({ ...c, rank: i + 1 })), queries: ex.queries, queriesJa: ex.queries_ja, perSource: [], usedLlm: false, warnings: [] };
}

export function ProposalExplore({ state, setState, proposal: p, update, via }: Pick<PageProps, "state" | "setState"> & { proposal: Proposal; update: Update; via: "api" | "paste" }) {
  const ex = p.exploration;
  const setEx = (patch: Partial<ProposalExploration>) => update((x) => ({ ...x, exploration: { ...x.exploration, ...patch } }));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const [queued, setQueued] = useState<string | null>(null);
  const inList = new Set(state.papers.filter((x) => x.status !== "removed").map((x) => x.id));
  const curiosity = ex.curiosity.trim();
  const ranked = ex.candidates.some((c) => c.reason);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const search = () =>
    act("search", async () => {
      setWarn([]);
      let r = await exploreSearch(state, curiosity, { queries: ex.queries, queries_ja: ex.queries_ja });
      setWarn(r.warnings);
      if (!r.candidates.length) {
        setEx({ candidates: [], picked: [] });
        return;
      }
      // API があればそのまま並べ替えて理由を付ける。貼り付けのときは下のボタンから
      if (via === "api") {
        try {
          r = await rankExplore(state, r, curiosity);
        } catch (e) {
          setWarn([...r.warnings, `並べ替えに失敗したので被引用数の順で出します: ${e instanceof Error ? e.message : e}`]);
        }
      }
      setEx({ candidates: exploreCandidates(r), picked: [] });
    });

  const togglePick = (id: string) => setEx({ picked: ex.picked.includes(id) ? ex.picked.filter((x) => x !== id) : [...ex.picked, id] });

  const queue = (cands: ExploreCandidate[]) =>
    act("queue", async () => {
      const r = await queueExploreCandidates(state, cands.filter((c) => !inList.has(c.id)), curiosity);
      setState(r.state);
      setQueued(`${r.added} 本を論文リストに入れました。「今日の論文」から 1 日 1 本ずつ読めます。`);
    });

  const rankPrompt = useMemo(() => (ex.candidates.length ? rankExplorePrompt(state, asResult(ex), curiosity) : ""), [ex.candidates, curiosity]); // eslint-disable-line react-hooks/exhaustive-deps
  const queryPrompt = useMemo(() => (curiosity ? exploreQueriesPrompt(state, curiosity) : ""), [curiosity]); // eslint-disable-line react-hooks/exhaustive-deps
  const questionPrompt = useMemo(() => (ex.candidates.length ? exploreQuestionsPrompt(state, p) : null), [ex.candidates, ex.picked, curiosity, p.purpose, state.memos]); // eslint-disable-line react-hooks/exhaustive-deps

  const paperOf = (id: string) => ex.candidates.find((c) => c.id === id) ?? state.papers.find((x) => x.id === id) ?? null;
  const who = (c: { authors: string[]; year: number | null }) => [c.authors[0], c.year].filter(Boolean).join(", ");
  const chosen = ex.questions.find((q) => q.id === ex.chosen);

  return (
    <div className="card explore">
      <p className="muted" style={{ marginTop: 0 }}>
        まだ論文を読んでいなくても大丈夫です。気になることを普段の言葉で書くと、検索語 → 論文の候補 → 問いの候補、と順に進めます。
        AI が出すのは材料と候補だけです。問いは自分で選んで、自分の言葉で書き直します。
      </p>

      <Step n={1} title="気になることを書く" done={!!curiosity}>
        <textarea
          rows={3}
          value={ex.curiosity}
          onChange={(e) => setEx({ curiosity: e.target.value })}
          placeholder="例: SNS でデマが広がるのはなぜなのか気になる。訂正の投稿はどれくらい効いているんだろう"
        />
        <p className="muted">専門用語はいりません。きっかけ、なぜ気になるのか、知りたいことを書くと、検索語や問いの候補が具体的になります。</p>
      </Step>

      <Step n={2} title="検索語を作る" done={ex.queries.length > 0} disabled={!curiosity}>
        {curiosity && (
          <>
            {via === "api" ? (
              <button className="btn small" disabled={!!busy} onClick={() => act("queries", async () => { const q = await exploreQueries(state, curiosity); setEx({ queries: q.queries, queries_ja: q.queries_ja }); })}>
                {busy === "queries" ? "作成中…" : ex.queries.length ? "作り直す" : "AI に検索語を作ってもらう"}
              </button>
            ) : (
              <PasteRoundTrip prompt={queryPrompt} copyLabel="1. 頼む文面をコピー" onAnswer={(t) => { const q = parseRecommendAnswer(t, queryPrompt); setEx({ queries: q.queries, queries_ja: q.queries_ja }); }} />
            )}
            <div className="row" style={{ alignItems: "flex-start", marginTop: 8 }}>
              <div className="field" style={{ flex: 2, minWidth: 220 }}>
                <label>英語の検索語(1 行に 1 つ。自分で直しても書いてもよい)</label>
                <textarea rows={4} value={ex.queries.join("\n")} onChange={(e) => setEx({ queries: lines(e.target.value) })} placeholder={"misinformation spread social media\ncorrection effectiveness"} />
              </div>
              {ex.queries_ja.length > 0 && (
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label>日本語の検索語</label>
                  <textarea rows={4} value={ex.queries_ja.join("\n")} onChange={(e) => setEx({ queries_ja: lines(e.target.value) })} />
                </div>
              )}
            </div>
            <p className="muted">論文はほとんど英語なので、英語の分野用語で探すと多く見つかります。どんな語で探しているかを見ておくと、あとで自分で探すときに役立ちます。</p>
          </>
        )}
      </Step>

      <Step n={3} title="論文の候補を見る" done={ex.candidates.length > 0} disabled={!ex.queries.length}>
        {ex.queries.length > 0 && (
          <>
            <button className="btn small" disabled={!!busy} onClick={search}>{busy === "search" ? "探しています…" : ex.candidates.length ? "探し直す" : "論文の候補を探す"}</button>
            {warn.map((w) => <p key={w} className="muted">{w}</p>)}
            {ex.candidates.length > 0 && !ranked && via === "paste" && (
              <div style={{ marginTop: 8 }}>
                <p className="muted">今は被引用数の順です。AI に「問いを立てるのに役立つ順」に並べてもらい、理由を付けられます(任意)。</p>
                <PasteRoundTrip prompt={rankPrompt} copyLabel="1. 並べ替えを頼む文面をコピー" onAnswer={(t) => setEx({ candidates: exploreCandidates(applyRankAnswer(asResult(ex), t, rankPrompt)) })} />
              </div>
            )}
            {ex.candidates.length > 0 && (
              <>
                <p className="muted">気になるものに印を付けてください。問いの候補は、印を付けた論文(無ければ上から 10 本)をもとに出します。読むのは論文リストに入れてから、1 日 1 本ずつで大丈夫です。</p>
                <ul className="explore-cands">
                  {ex.candidates.map((c) => (
                    <li key={c.id} className={ex.picked.includes(c.id) ? "picked" : ""}>
                      <label className="row" style={{ alignItems: "flex-start", gap: 8, flexWrap: "nowrap" }}>
                        <input type="checkbox" checked={ex.picked.includes(c.id)} onChange={() => togglePick(c.id)} style={{ marginTop: 4 }} />
                        <span>
                          <strong>{c.title}</strong>
                          <span className="muted"> {[who(c), c.venue, c.cited_by ? `被引用 ${c.cited_by}` : null].filter(Boolean).join(" · ")}{inList.has(c.id) && " · 論文リストにあります"}</span>
                          {c.reason && <div>{c.reason}</div>}
                        </span>
                      </label>
                      {c.abstract && <details><summary className="muted">アブストラクト</summary><p className="muted">{c.abstract}</p></details>}
                    </li>
                  ))}
                </ul>
                <div className="row">
                  <button className="btn secondary small" disabled={!!busy || !ex.picked.some((id) => !inList.has(id))} onClick={() => queue(ex.candidates.filter((c) => ex.picked.includes(c.id)))}>
                    印を付けたものを論文リストに入れる
                  </button>
                  {queued && <span className="ok">{queued}</span>}
                </div>
              </>
            )}
          </>
        )}
      </Step>

      <Step n={4} title="問いの候補を出す" done={ex.questions.length > 0} disabled={!ex.candidates.length}>
        {ex.candidates.length > 0 && (
          <>
            {via === "api" ? (
              <button className="btn small" disabled={!!busy} onClick={() => act("questions", async () => setEx({ questions: await exploreQuestions(state, p), chosen: null }))}>
                {busy === "questions" ? "考えてもらっています…" : ex.questions.length ? "出し直す" : `問いの候補を出してもらう(${ex.picked.length ? `印を付けた ${ex.picked.length} 本` : "上から 10 本"}をもとに)`}
              </button>
            ) : (
              questionPrompt && <PasteRoundTrip prompt={questionPrompt.prompt} copyLabel="1. 頼む文面をコピー" onAnswer={(t) => setEx({ questions: acceptQuestionsAnswer(t, questionPrompt.refs), chosen: null })} />
            )}
            {ex.questions.map((q) => (
              <label key={q.id} className={`card question ${q.id === ex.chosen ? "chosen" : ""}`}>
                <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <input type="radio" name={`q-${p.id}`} checked={q.id === ex.chosen} onChange={() => setEx({ chosen: q.id })} style={{ marginTop: 5 }} />
                  <div>
                    <div className="title" style={{ fontSize: 16 }}>{q.question}</div>
                    {q.why && <p><span className="muted">なぜ大事か</span> {q.why}</p>}
                    {q.unknown && <p><span className="muted">まだ分かっていないこと</span> {q.unknown}</p>}
                    {q.approach && <p><span className="muted">どう確かめるか</span> {q.approach}</p>}
                    {q.paper_ids.length > 0 && (
                      <div className="muted">関係する論文: {q.paper_ids.map((id) => paperOf(id)?.title).filter(Boolean).join(" / ")}</div>
                    )}
                    {q.first_read && paperOf(q.first_read) && (
                      <div className="row" style={{ marginTop: 6 }}>
                        <span>最初に読む 1 本: <strong>{paperOf(q.first_read)!.title}</strong></span>
                        {inList.has(q.first_read) ? (
                          <span className="muted">論文リストにあります</span>
                        ) : (
                          ex.candidates.some((c) => c.id === q.first_read) && <button type="button" className="btn secondary small" disabled={!!busy} onClick={() => queue(ex.candidates.filter((c) => c.id === q.first_read))}>論文リストに入れる</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </label>
            ))}
            {ex.questions.length > 0 && <p className="muted">どれも候補です。まだ論文を読んでいないので、「まだ分かっていないこと」は読んで確かめるまで仮のものです。いくつか読んだら出し直すと、問いが具体的になります。</p>}
          </>
        )}
      </Step>

      <Step n={5} title="自分の言葉で問いを書く" done={!!ex.my_question.trim()} disabled={!ex.questions.length && !ex.my_question}>
        {(ex.questions.length > 0 || ex.my_question) && (
          <>
            {chosen && <blockquote className="evidence">{chosen.question}</blockquote>}
            <textarea rows={3} value={ex.my_question} onChange={(e) => setEx({ my_question: e.target.value })} placeholder={chosen ? "選んだ問いを、自分が本当に知りたい形に書き直す。範囲を狭める・対象を決める・言葉を変える" : "上の候補から 1 つ選ぶか、組み合わせて書く"} />
            <p className="muted">
              ここに書いた問いは本文には入りません。節を AI に見せるときの前提として伝わります。
              題目と「研究の目的」は、これをもとに下の節で自分で書いてください。次は、最初に読む 1 本を今日の論文にして読むところからです。
            </p>
          </>
        )}
      </Step>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

function Step({ n, title, done, disabled, children }: { n: number; title: string; done: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <section className={`explore-step ${disabled ? "disabled" : ""}`}>
      <div className="row" style={{ gap: 8 }}>
        <span className={`step-no ${done ? "done" : ""}`}>{done ? "✓" : n}</span>
        <strong>{title}</strong>
      </div>
      <div className="step-body">{children}</div>
    </section>
  );
}
