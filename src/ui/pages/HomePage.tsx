import type { PageProps } from "../App";
import { prisonerLabel } from "../App";
import { currentStreak, today, todaysReads } from "@/core/app";
import { queue } from "@/core/papers/queue";
import { PaperMeta } from "../components/PaperCard";
import { Avatar } from "../components/Avatar";
import { MEAT_STAGES, meatStage } from "@/death";

export function HomePage({ state, go }: PageProps) {
  const paper = today(state);
  const reads = todaysReads(state);
  const q = queue(state.papers);
  const d = state.death;
  return (
    <>
      <h1>ホーム</h1>
      {d && (
        <div className="card death row" style={{ alignItems: "center" }}>
          <Avatar parts={d.avatar} prisoner={d.prisoner} size={110} />
          <div style={{ flex: 1 }}>
            <p className="title" style={{ margin: 0 }}>{prisonerLabel(d.prisoner.state)}</p>
            <div className="muted">
              肉 {d.prisoner.meat}(段階 {meatStage(d.prisoner.meat) + 1} / {MEAT_STAGES.length}
              {meatStage(d.prisoner.meat) < MEAT_STAGES.length - 1 ? `、次まで ${MEAT_STAGES[meatStage(d.prisoner.meat) + 1] - d.prisoner.meat}` : ""})
            </div>
            {d.prisoner.state === "dead" && <p className="plea">今日 1 本読めば、新しい囚人として生き返る。</p>}
            {d.prisoner.state === "warning" && <p className="plea">猶予を使った。今日読まなければ次はない。</p>}
            {d.prisoner.state === "alive" && reads.length === 0 && paper && <p className="plea">今日読まなければ、明日の私はいない。</p>}
          </div>
        </div>
      )}
      {reads.length > 0 ? (
        <div className="card hero">
          <p className="title ok">今日の 1 本は読了済みです</p>
          <p className="muted">連続記録 {currentStreak(state)} 日。もう 1 本読むこともできますが、毎日の習慣にすることを勧めます。</p>
        </div>
      ) : paper ? (
        <div className="card hero">
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
      <div className="row">
        <div className="card" style={{ flex: 1 }}><div className="muted">キュー</div><p className="title">{q.length} 本</p></div>
        <div className="card" style={{ flex: 1 }}><div className="muted">読了</div><p className="title">{state.papers.filter((p) => p.status === "read").length} 本</p></div>
        <div className="card" style={{ flex: 1 }}><div className="muted">連続記録</div><p className="title">{currentStreak(state)} 日</p></div>
      </div>
    </>
  );
}
