import { useCallback, useEffect, useState } from "react";
import { handoffReturnPaperId } from "@/core/llm/handoff";
import type { AppState } from "@/core/app";
import { bootstrap, currentStreak, rollover, today, todaysReads } from "@/core/app";
import { runNotifications } from "@/core/notify";
import { HomePage } from "./pages/HomePage";
import { TodayPage } from "./pages/TodayPage";
import { EditorPage } from "./pages/EditorPage";
import { CalendarPage } from "./pages/CalendarPage";
import { PapersPage } from "./pages/PapersPage";
import { ExplorePage } from "./pages/ExplorePage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsagePage } from "./pages/UsagePage";
import { LessonsPage } from "./pages/LessonsPage";
import { ImportNotice } from "./components/ImportNotice";

export type Page =
  | { name: "home" }
  | { name: "today" }
  | { name: "editor"; paperId: string }
  | { name: "calendar" }
  | { name: "papers" }
  | { name: "explore" }
  | { name: "usage" }
  | { name: "lessons" }
  | { name: "settings" };

export interface PageProps {
  state: AppState;
  setState: (s: AppState) => void;
  go: (p: Page) => void;
}

const NAV: { page: Page; label: string }[] = [
  { page: { name: "home" }, label: "ホーム" },
  { page: { name: "today" }, label: "今日の論文" },
  { page: { name: "papers" }, label: "論文リスト" },
  { page: { name: "explore" }, label: "論文を探す" },
  { page: { name: "calendar" }, label: "カレンダー" },
  { page: { name: "usage" }, label: "API 使用量" },
  { page: { name: "lessons" }, label: "講座" },
  { page: { name: "settings" }, label: "設定" },
];

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ショートカットから戻ってきたときは、頼んだ論文のメモを開く(仕様 7.4)
  const [page, setPage] = useState<Page>(() => {
    const paperId = handoffReturnPaperId(location.href);
    return paperId ? { name: "editor", paperId } : { name: "home" };
  });

  useEffect(() => {
    bootstrap().then(setState, (e) => setError(String(e)));
    if (handoffReturnPaperId(location.href)) history.replaceState(null, "", location.pathname);
  }, []);

  // 1 分ごと: 日付境界を跨いだら判定(仕様 5.1)、通知の時刻なら送る(仕様 10.4)
  const tick = useCallback(async () => {
    if (!state) return;
    const next = await rollover(state);
    if (next !== state) setState(next);
    try {
      await runNotifications({
        settings: next.settings,
        today: next.today,
        todaysPaper: today(next),
        readToday: todaysReads(next).length > 0,
        now: new Date(),
      });
    } catch {
      /* 通知は失敗しても本体に影響させない */
    }
  }, [state]);

  useEffect(() => {
    const id = setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [tick]);

  if (error) return <div className="main"><p className="error">起動に失敗しました: {error}</p></div>;
  if (!state) return <div className="main muted">読み込み中…</div>;

  const props: PageProps = { state, setState, go: setPage };
  let body: JSX.Element;
  switch (page.name) {
    case "home": body = <HomePage {...props} />; break;
    case "today": body = <TodayPage {...props} />; break;
    case "editor": body = <EditorPage {...props} paperId={page.paperId} />; break;
    case "calendar": body = <CalendarPage {...props} />; break;
    case "papers": body = <PapersPage {...props} />; break;
    case "explore": body = <ExplorePage {...props} />; break;
    case "usage": body = <UsagePage {...props} />; break;
    case "lessons": body = <LessonsPage />; break;
    case "settings": body = <SettingsPage {...props} />; break;
  }

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">One day,{" "}<br />One paper</div>
        {NAV.map((n) => (
          <button key={n.page.name} className={page.name === n.page.name ? "active" : ""} onClick={() => setPage(n.page)}>
            {n.label}
          </button>
        ))}
        <div className="streak">
          連続記録
          <strong>{currentStreak(state)} 日</strong>
          {state.today}
        </div>
      </nav>
      <main className="main">
        <ImportNotice />
        {body}
      </main>
    </div>
  );
}
