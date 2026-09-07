import { useCallback, useEffect, useState } from "react";
import type { AppState } from "@/core/app";
import { bootstrap, currentStreak, runJudgement } from "@/core/app";
import { logicalDate } from "@/core/schedule/logicalDay";
import * as sql from "@/core/store/db";
import { listMemos } from "@/core/store/memos";
import { HomePage } from "./pages/HomePage";
import { TodayPage } from "./pages/TodayPage";
import { EditorPage } from "./pages/EditorPage";
import { CalendarPage } from "./pages/CalendarPage";
import { PapersPage } from "./pages/PapersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsagePage } from "./pages/UsagePage";

export type Page =
  | { name: "home" }
  | { name: "today" }
  | { name: "editor"; paperId: string }
  | { name: "calendar" }
  | { name: "papers" }
  | { name: "usage" }
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
  { page: { name: "calendar" }, label: "カレンダー" },
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

  // 日付境界を跨いだら判定を回す(仕様 5.1)
  const refreshDay = useCallback(async () => {
    if (!state) return;
    const today = logicalDate(new Date(), state.settings.day_boundary_hour);
    if (today === state.today) return;
    const memos = await listMemos(state.settings.data_dir);
    const firstUse = (await sql.getMeta("first_use_date")) ?? today;
    const r = await runJudgement({ settings: state.settings, memos, today, firstUse });
    setState({ ...state, memos, today, ...r });
  }, [state]);

  useEffect(() => {
    const id = setInterval(refreshDay, 60_000);
    window.addEventListener("focus", refreshDay);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refreshDay);
    };
  }, [refreshDay]);

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
    case "usage": body = <UsagePage {...props} />; break;
    case "settings": body = <SettingsPage {...props} />; break;
  }

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">One day,<br />One paper</div>
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
      <main className="main">{body}</main>
    </div>
  );
}
