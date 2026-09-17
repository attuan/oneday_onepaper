// 講座(仕様 11 v2)と使い方。src/content/ の Markdown を同梱し、そのまま表示する

import { useMemo, useState } from "react";
import { markdownTitle, renderMarkdown } from "@/core/markdown";

// ビルド時に取り込む。ファイル名順に並ぶ
const FILES = import.meta.glob("../../content/lessons/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const GUIDE_FILES = import.meta.glob("../../content/guide/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const toPages = (files: Record<string, string>) =>
  Object.keys(files)
    .sort()
    .map((path) => ({ id: path.split("/").pop()!.replace(/\.md$/, ""), md: files[path], title: markdownTitle(files[path]) ?? path }));

const LESSONS = toPages(FILES);
const GUIDE = toPages(GUIDE_FILES);

export function LessonsPage() {
  return <MarkdownBook title="講座" pages={LESSONS} />;
}

/** 使い方。アプリの操作の説明。講座(論文の読み方)とは分けてある */
export function GuidePage() {
  return <MarkdownBook title="使い方" pages={GUIDE} />;
}

function MarkdownBook({ title, pages }: { title: string; pages: typeof LESSONS }) {
  const [id, setId] = useState(pages[0]?.id ?? "");
  const lesson = pages.find((l) => l.id === id) ?? pages[0];
  const html = useMemo(() => (lesson ? renderMarkdown(lesson.md) : ""), [lesson]);
  if (!lesson) return <p className="muted">ページがありません</p>;
  return (
    <>
      <h1>{title}</h1>
      <div className="lessons">
        <nav className="lessons-nav">
          {pages.map((l, i) => (
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
