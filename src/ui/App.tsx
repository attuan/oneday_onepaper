import { useCallback, useEffect, useState } from "react";
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
import { GraveyardPage } from "./pages/GraveyardPage";
import { Avatar } from "./components/Avatar";

export type Page =
  | { name: "home" }
  | { name: "today" }
  | { name: "editor"; paperId: string }
  | { name: "calendar" }
  | { name: "papers" }
  | { name: "explore" }
  | { name: "usage" }
  | { name: "graveyard" }
  | { name: "settings" };

export interface PageProps {
  state: AppState;
  setState: (s: AppState) => void;
  go: (p: Page) => void;
}

const NAV: { page: Page; label: string; deathOnly?: boolean }[] = [
  { page: { name: "home" }, label: "ホーム" },
  { page: { name: "today" }, label: "今日の論文" },
  { page: { name: "papers" }, label: "論文リスト" },
  { page: { name: "explore" }, label: "論文を探す" },
  { page: { name: "calendar" }, label: "カレンダー" },
  { page: { name: "graveyard" }, label: "墓地", deathOnly: true },
  { page: { name: "usage" }, label: "API 使用量" },
  { page: { name: "settings" }, label: "設定" },
];

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>({ name: "home" });

  useEffect(() => {
    bootstrap().then(setState, (e) => setError(String(e)));
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
        deathMode: next.settings.death_mode,
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
    case "graveyard": body = <GraveyardPage {...props} />; break;
    case "settings": body = <SettingsPage {...props} />; break;
  }

  return (
    <div className={`app${state.death ? " death" : ""}`}>
      <nav className="nav">
        <div className="brand">One day,<br />One paper{state.death && <span className="or-death"><br />(or death)</span>}</div>
        {NAV.filter((n) => !n.deathOnly || state.death).map((n) => (
          <button key={n.page.name} className={page.name === n.page.name ? "active" : ""} onClick={() => setPage(n.page)}>
            {n.label}
          </button>
        ))}
        <div className="streak">
          {state.death && (
            <div className="nav-avatar">
              <Avatar parts={state.death.avatar} prisoner={state.death.prisoner} size={72} />
              <div className="muted-light">{prisonerLabel(state.death.prisoner.state)} · 肉 {state.death.prisoner.meat}</div>
            </div>
          )}
          連続記録
          <strong>{currentStreak(state)} 日</strong>
          {state.today}
        </div>
      </nav>
      <main className="main">{body}</main>
    </div>
  );
}

export function prisonerLabel(s: "alive" | "warning" | "dead"): string {
  return s === "alive" ? "生存" : s === "warning" ? "執行猶予中" : "死亡";
}
