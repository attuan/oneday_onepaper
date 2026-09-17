import type { PageProps } from "../App";
import { currentStreak, today, todaysReads } from "@/core/app";
import { queue } from "@/core/papers/queue";
import { courseProgress } from "@/core/papers/course";
import { PaperMeta } from "../components/PaperCard";

export function HomePage({ state, go }: PageProps) {
  const paper = today(state);
  const reads = todaysReads(state);
  const q = queue(state.papers);
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
      <div className="row">
        <div className="card" style={{ flex: 1 }}><div className="muted">キュー</div><p className="title">{q.length} 本</p></div>
        <div className="card" style={{ flex: 1 }}><div className="muted">読了</div><p className="title">{state.papers.filter((p) => p.status === "read").length} 本</p></div>
        <div className="card" style={{ flex: 1 }}><div className="muted">連続記録</div><p className="title">{currentStreak(state)} 日</p></div>
      </div>
    </>
  );
}
