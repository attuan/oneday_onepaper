import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { usageByMonthAndTask } from "@/core/app";
import type { UsageSummary } from "@/core/store/db";
import { formatUsd } from "@/core/usage/cost";

export function UsagePage(_: PageProps) {
  const [rows, setRows] = useState<UsageSummary[]>([]);
  useEffect(() => {
    usageByMonthAndTask().then(setRows);
  }, []);
  const total = rows.reduce((a, r) => a + r.cost, 0);
  const months = [...new Set(rows.map((r) => r.month))];
  return (
    <>
      <h1>API 使用量</h1>
      <div className="card hero"><div className="muted">累計(概算)</div><p className="title">{formatUsd(total)}</p></div>
      {months.map((m) => {
        const rs = rows.filter((r) => r.month === m);
        return (
          <div key={m}>
            <h2>{m}(概算 {formatUsd(rs.reduce((a, r) => a + r.cost, 0))})</h2>
            <table>
              <thead><tr><th>タスク</th><th>回数</th><th>入力トークン</th><th>出力トークン</th><th>概算</th></tr></thead>
              <tbody>
                {rs.map((r) => (
                  <tr key={r.task}><td>{r.task}</td><td>{r.calls}</td><td>{r.input_tokens.toLocaleString()}</td><td>{r.output_tokens.toLocaleString()}</td><td>{formatUsd(r.cost)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {rows.length === 0 && <p className="muted">まだ LLM を呼び出していません</p>}
      <p className="muted">金額は単価表からの概算です。Ollama は 0 として扱います。</p>
    </>
  );
}
