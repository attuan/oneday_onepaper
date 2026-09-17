import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { currentStreak, dueReviews, markReviewed, reorder, today, todaysReads } from "@/core/app";
import type { ReviewItem } from "@/core/records";
import { queue } from "@/core/papers/queue";
import { courseProgress } from "@/core/papers/course";
import { heatmap } from "@/core/records";
import { LEVEL_LABELS } from "@/core/memo/completion";

const HEAT_WEEKS = 18;
import { PaperMeta } from "../components/PaperCard";

export function HomePage({ state, setState, go }: PageProps) {
  const paper = today(state);
  const reads = todaysReads(state);
  const q = queue(state.papers);
  const [reviews, setReviews] = useState<(ReviewItem & { after: number })[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    dueReviews(state).then(setReviews);
  }, [state.memos, state.today]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishReview = async (r: ReviewItem & { after: number }, remembered: boolean) => {
    await markReviewed(r.paper.id, r.after, remembered);
    setReviews((xs) => xs.filter((x) => x !== r));
  };
  return (
    <>
      <h1>ホーム</h1>
      {reads.length > 0 ? (
        <div className="card hero">
          <p className="title ok">今日の 1 本は読了済みです</p>
          <p className="muted">連続記録 {currentStreak(state)} 日。もう 1 本読むこともできますが、毎日の習慣にすることを勧めます。</p>
        </div>
      ) : paper ? (
        <div className="card hero">
          {state.onThinIce && <p className="badge">前回は読めませんでした。今日 1 行でも書けば、連続記録 {state.baseStreak} 日は続きます</p>}
          <div className="muted">今日の論文</div>
          <p className="title">{paper.title}</p>
          <PaperMeta paper={paper} />
          {paper.reason && <p style={{ marginTop: 10 }}>{paper.reason}</p>}
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => go({ name: "editor", paperId: paper.id })}>メモを書く</button>
            <button className="btn secondary" onClick={() => go({ name: "today" })}>詳細</button>
          </div>
        </div>
      ) : (
        <div className="card hero">
          <p className="title">読む論文がありません</p>
          <p className="muted">論文リストに追加してください。リストが空の日は未読扱いにはなりませんが、記録も伸びません。</p>
          <div className="row">
            <button className="btn" onClick={() => go({ name: "explore" })}>論文を探す</button>
            <button className="btn secondary" onClick={() => go({ name: "papers" })}>手入力・CSV・DOI で追加</button>
          </div>
        </div>
      )}
      {reads.length === 0 && q.length > 1 && (
        <>
          <div className="muted">気分が乗らなければ、こっちでも(選ぶと今日の 1 本になります)</div>
          <div className="row pick">
            {q.slice(1, 3).map((p) => (
              <button key={p.id} type="button" className="card pick-card" onClick={async () => setState(await reorder(state, [p.id, ...q.filter((x) => x.id !== p.id).map((x) => x.id)]))}>
                <strong>{p.title}</strong>
                <PaperMeta paper={p} />
              </button>
            ))}
          </div>
        </>
      )}
      {reviews.map((r) => (
        <div className="card" key={`${r.paper.id}:${r.after}`}>
          <div className="muted">{r.daysAgo} 日前に読みました。何の論文だったか、思い出せますか?</div>
          <p className="title">{r.paper.title}</p>
          {revealed.has(r.paper.id) ? (
            <>
              <blockquote className="evidence">{r.oneLiner || "(メモの 1 行目が空でした)"}<span className="muted"> — そのときのあなたのひとこと</span></blockquote>
              <div className="row">
                <button className="btn small" onClick={() => finishReview(r, true)}>覚えていた</button>
                <button className="btn secondary small" onClick={() => finishReview(r, false)}>忘れていた</button>
                <button className="btn secondary small" onClick={() => go({ name: "editor", paperId: r.paper.id })}>メモを開く</button>
              </div>
            </>
          ) : (
            <button className="btn secondary small" onClick={() => setRevealed(new Set(revealed).add(r.paper.id))}>頭の中で思い出してから、答えを見る</button>
          )}
        </div>
      ))}
      {courseProgress(state.papers).map((c) => (
        <div className="card" key={c.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{c.title}</strong>
            <span className="muted">{c.read} / {c.total} 本{c.read === c.total && "・修了"}</span>
          </div>
          <div className="progress"><div style={{ width: `${(c.read / c.total) * 100}%` }} /></div>
          {c.next && <div className="muted">次: {c.next.title}</div>}
        </div>
      ))}
      <div className="card">
        <div className="muted">読んだ日(濃いほどしっかり書いた日)</div>
        <div className="heatmap">
          {heatmap(state.memos, state.today, HEAT_WEEKS).map((week) => (
            <div key={week[0].date}>
              {week.map((c) => <span key={c.date} className={c.future ? "heat future" : `heat lv${c.level}`} title={`${c.date}${c.level ? ` Lv${c.level} ${LEVEL_LABELS[c.level]}` : ""}`} />)}
            </div>
          ))}
        </div>
      </div>
      <div className="row">
        <div className="card" style={{ flex: 1 }}><div className="muted">キュー</div><p className="title">{q.length} 本</p></div>
        <div className="card" style={{ flex: 1 }}><div className="muted">読了</div><p className="title">{state.papers.filter((p) => p.status === "read").length} 本</p></div>
        <div className="card" style={{ flex: 1 }}><div className="muted">連続記録</div><p className="title">{currentStreak(state)} 日</p></div>
      </div>
    </>
  );
}
