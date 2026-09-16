// 講座(仕様 11 v2)。src/content/lessons/ の Markdown を同梱し、そのまま表示する

import { useMemo, useState } from "react";
import { markdownTitle, renderMarkdown } from "@/core/markdown";

// ビルド時に取り込む。ファイル名順に並ぶ
const FILES = import.meta.glob("../../content/lessons/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const LESSONS = Object.keys(FILES)
  .sort()
  .map((path) => ({ id: path.split("/").pop()!.replace(/\.md$/, ""), md: FILES[path], title: markdownTitle(FILES[path]) ?? path }));

export function LessonsPage() {
  const [id, setId] = useState(LESSONS[0]?.id ?? "");
  const lesson = LESSONS.find((l) => l.id === id) ?? LESSONS[0];
  const html = useMemo(() => (lesson ? renderMarkdown(lesson.md) : ""), [lesson]);
  if (!lesson) return <p className="muted">講座がありません</p>;
  return (
    <>
      <h1>講座</h1>
      <div className="lessons">
        <nav className="lessons-nav">
          {LESSONS.map((l, i) => (
            <button key={l.id} className={l.id === lesson.id ? "active" : ""} onClick={() => setId(l.id)}>
              <span className="muted">{i + 1}.</span> {l.title}
            </button>
          ))}
        </nav>
        {/* 同梱のテキストを自前のレンダラでエスケープ済み。外部の入力は入らない */}
        <article className="lesson card" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </>
  );
}
