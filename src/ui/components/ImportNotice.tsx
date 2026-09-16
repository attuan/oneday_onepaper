// 取り込みの後は画面を読み込み直すので、結果は sessionStorage 経由で次の画面に渡す

import { useState } from "react";
import type { ImportReport } from "@/core/app";

const KEY = "oneday:import-report";

export function stashImportReport(r: ImportReport): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* 見せられないだけで、取り込み自体は済んでいる */
  }
}

function takeImportReport(): ImportReport | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return raw ? (JSON.parse(raw) as ImportReport) : null;
  } catch {
    return null;
  }
}

// StrictMode は初期化関数を 2 回呼ぶので、読み出しはページごとに 1 回にする
let taken: ImportReport | null | undefined;
const takeOnce = () => (taken === undefined ? (taken = takeImportReport()) : taken);

export function ImportNotice() {
  const [r, setR] = useState<ImportReport | null>(takeOnce);
  if (!r) return null;
  const parts = [`論文 ${r.papers} 件`, `メモ ${r.memos} 件`];
  if (r.pdfs) parts.push(`PDF ${r.pdfs} 件`);
  if (r.db) parts.push("記録(AI の要約・採点、使用量)");
  if (r.settings) parts.push("設定");
  return (
    <div className="card hero">
      <p className="title">データを取り込みました</p>
      <p>{parts.join("、")}</p>
      {r.warnings.map((w) => (
        <p key={w} className="error">{w}</p>
      ))}
      {r.skipped.length > 0 && (
        <p className="muted">
          取り込まなかったファイル {r.skipped.length} 件: {r.skipped.slice(0, 5).join(", ")}
          {r.skipped.length > 5 ? " ほか" : ""}
        </p>
      )}
      <p className="muted">取り込む前のデータは {r.backupPath} に残してあります。</p>
      <button className="btn secondary small" onClick={() => setR(null)}>閉じる</button>
    </div>
  );
}
