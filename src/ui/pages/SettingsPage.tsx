import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { exportData, getApiKey, getLineToken, getSemanticScholarKey, getSlackWebhook, importData, PartialImportError, platform, sendTestNotification, setApiKey, setLineToken, setSemanticScholarKey, setSlackWebhook, updateSettings } from "@/core/app";
import { ConfirmButton } from "../components/ConfirmButton";
import { stashImportReport } from "../components/ImportNotice";
import { SOURCES } from "@/core/scholar/sources";
import type { NotifyChannel, Settings, SourceId } from "@/core/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SettingsPage({ state, setState }: PageProps) {
  const [s, setS] = useState<Settings>(state.settings);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [s2Key, setS2Key] = useState("");
  const [hasS2Key, setHasS2Key] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [includePdfs, setIncludePdfs] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importErr, setImportErr] = useState<{ text: string; reload: boolean } | null>(null);
  const [slackUrl, setSlackUrl] = useState("");
  const [hasSlack, setHasSlack] = useState(false);
  const [lineTok, setLineTok] = useState("");
  const [hasLine, setHasLine] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState<NotifyChannel | null>(null);
  const web = platform() === "web";
  const keyStore = web ? "このブラウザに保存。暗号化はされません" : "OS のキーチェーンに保存";

  useEffect(() => {
    getApiKey().then((k) => setHasKey(!!k));
    getSemanticScholarKey().then((k) => setHasS2Key(!!k));
    getSlackWebhook().then((k) => setHasSlack(!!k));
    getLineToken().then((k) => setHasLine(!!k));
  }, []);

  const save = async () => {
    try {
      setState(await updateSettings(state, s));
      if (key) {
        await setApiKey(key);
        setHasKey(true);
        setKey("");
      }
      if (s2Key) {
        await setSemanticScholarKey(s2Key);
        setHasS2Key(true);
        setS2Key("");
      }
      await saveNotifySecrets();
      setMsg("保存しました");
    } catch (e) {
      setMsg(`保存に失敗: ${e}`);
    }
  };

  const doExport = async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      setExportMsg(await exportData(state, includePdfs));
    } catch (e) {
      setExportMsg(`書き出しに失敗: ${errText(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const doImport = async () => {
    if (!importFile) return;
    setImportErr(null);
    try {
      stashImportReport(await importData(state, importFile));
      location.reload();
    } catch (e) {
      setImportErr({ text: errText(e), reload: e instanceof PartialImportError });
    }
  };

  /** 通知の秘密情報(Webhook URL・トークン)。テスト送信の前にも保存する */
  const saveNotifySecrets = async () => {
    if (slackUrl) {
      await setSlackWebhook(slackUrl);
      setHasSlack(true);
      setSlackUrl("");
    }
    if (lineTok) {
      await setLineToken(lineTok);
      setHasLine(true);
      setLineTok("");
    }
  };

  const toggleChannel = (c: NotifyChannel) =>
    setS({ ...s, notifications: { ...s.notifications, channels: s.notifications.channels.includes(c) ? s.notifications.channels.filter((x) => x !== c) : [...s.notifications.channels, c] } });

  const testSend = async (c: NotifyChannel) => {
    setTesting(c);
    setTestMsg(null);
    try {
      await saveNotifySecrets();
      await sendTestNotification(s, c);
      setTestMsg(`${c === "os" ? "通知" : c === "slack" ? "Slack" : "LINE"} にテスト送信しました`);
    } catch (e) {
      setTestMsg(`テスト送信に失敗: ${errText(e)}`);
    } finally {
      setTesting(null);
    }
  };

  const toggleSource = (id: SourceId) =>
    setS({ ...s, search: { ...s.search, sources: s.search.sources.includes(id) ? s.search.sources.filter((x) => x !== id) : [...s.search.sources, id] } });

  const toggleWd = (d: number) =>
    setS({ ...s, rest_weekdays: s.rest_weekdays.includes(d) ? s.rest_weekdays.filter((x) => x !== d) : [...s.rest_weekdays, d].sort() });

  return (
    <>
      <h1>設定</h1>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>スケジュール</h2>
        <div className="row">
          <div className="field"><label>日付の切り替え時刻</label><input type="number" min={0} max={23} value={s.day_boundary_hour} onChange={(e) => setS({ ...s, day_boundary_hour: Number(e.target.value) })} /></div>
          <div className="field"><label>読了に必要な文字数</label><input type="number" min={0} value={s.min_memo_chars} onChange={(e) => setS({ ...s, min_memo_chars: Number(e.target.value) })} /></div>
        </div>
        <div className="field">
          <label>休みの曜日</label>
          <div className="row">
            {WEEKDAYS.map((w, i) => (
              <label key={i}><input type="checkbox" checked={s.rest_weekdays.includes(i)} onChange={() => toggleWd(i)} /> {w}</label>
            ))}
          </div>
        </div>
        <div className="field">
          <label>休みの期間(from/to)</label>
          {s.rest_periods.map((p, i) => (
            <div className="row" key={i}>
              <input type="date" value={p.from} onChange={(e) => setS({ ...s, rest_periods: s.rest_periods.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} />
              <input type="date" value={p.to} onChange={(e) => setS({ ...s, rest_periods: s.rest_periods.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} />
              <button className="btn danger small" onClick={() => setS({ ...s, rest_periods: s.rest_periods.filter((_, j) => j !== i) })}>削除</button>
            </div>
          ))}
          <div><button className="btn secondary small" onClick={() => setS({ ...s, rest_periods: [...s.rest_periods, { from: state.today, to: state.today }] })}>期間を追加</button></div>
        </div>
        <div className="row">
          <div className="field">
            <label>猶予</label>
            <label><input type="checkbox" checked={s.grace.enabled} onChange={(e) => setS({ ...s, grace: { ...s.grace, enabled: e.target.checked } })} /> 猶予を有効にする(既定はなし)</label>
          </div>
          <div className="field">
            <label>2 本目以降を読んだとき</label>
            <select value={s.extra_read_reward} disabled={!s.grace.enabled} onChange={(e) => setS({ ...s, extra_read_reward: e.target.value as Settings["extra_read_reward"] })}>
              <option value="none">記録のみ</option>
              <option value="grace">猶予 1 日に変換</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>LLM</h2>
        <div className="row">
          <div className="field">
            <label>プロバイダ</label>
            <select value={s.llm.provider} onChange={(e) => setS({ ...s, llm: { ...s.llm, provider: e.target.value as Settings["llm"]["provider"], model: e.target.value === "ollama" ? "llama3.1" : "claude-opus-5" } })}>
              <option value="anthropic">Anthropic API</option>
              <option value="ollama">Ollama(ローカル)</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}><label>モデル</label><input value={s.llm.model} onChange={(e) => setS({ ...s, llm: { ...s.llm, model: e.target.value } })} /></div>
          <div className="field">
            <label>出力言語</label>
            <select value={s.language} onChange={(e) => setS({ ...s, language: e.target.value as Settings["language"] })}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
        {s.llm.provider === "anthropic" ? (
          <div className="field">
            <label>API キー({keyStore}。{hasKey ? "設定済み" : "未設定"})</label>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? "変更する場合のみ入力" : "sk-ant-..."} />
          </div>
        ) : (
          <div className="field"><label>Ollama の URL</label><input value={s.llm.base_url ?? ""} placeholder="http://localhost:11434" onChange={(e) => setS({ ...s, llm: { ...s.llm, base_url: e.target.value || null } })} /></div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>論文検索</h2>
        <div className="field">
          <label>既定で使うソース(検索画面でその都度変えられる)</label>
          {SOURCES.map((src) => (
            <div key={src.id}>
              <label><input type="checkbox" checked={s.search.sources.includes(src.id)} onChange={() => toggleSource(src.id)} /> {src.label}</label>
              <span className="muted"> — {src.note}</span>
            </div>
          ))}
        </div>
        <div className="field">
          <label>Semantic Scholar の API キー(任意。{keyStore}。{hasS2Key ? "設定済み" : "未設定"})</label>
          <input type="password" value={s2Key} onChange={(e) => setS2Key(e.target.value)} placeholder={hasS2Key ? "変更する場合のみ入力" : "なしでも動くが、レート制限が厳しい"} />
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>通知</h2>
        <div className="row">
          <div className="field"><label>朝の通知</label><input type="time" value={s.notifications.morning} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, morning: e.target.value } })} /></div>
          <div className="field"><label>夜の通知(未読のとき)</label><input type="time" value={s.notifications.evening} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, evening: e.target.value } })} /></div>
          <div className="field"><label>締切の何分前に最終通知</label><input type="number" min={5} value={s.notifications.last_call_minutes_before} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, last_call_minutes_before: Number(e.target.value) } })} /></div>
        </div>
        <h3>配信先</h3>
        <div className="row">
          <label><input type="checkbox" checked={s.notifications.channels.includes("os")} onChange={() => toggleChannel("os")} /> {web ? "ブラウザの通知" : "macOS の通知"}</label>
          <button className="btn secondary small" disabled={testing !== null} onClick={() => testSend("os")}>{testing === "os" ? "送信中…" : "テスト送信"}</button>
        </div>
        <p className="muted">
          {web
            ? "このタブを開いている間だけ通知します。タブを閉じると届きません。休みの日は通知しません。"
            : "ウィンドウを閉じてもメニューバーに常駐し、通知を出します。終了はメニューバーのアイコンから。休みの日は通知しません。"}
        </p>

        <div className="row">
          <label><input type="checkbox" checked={s.notifications.channels.includes("slack")} onChange={() => toggleChannel("slack")} /> Slack(Incoming Webhook)</label>
          <button className="btn secondary small" disabled={testing !== null || (!hasSlack && !slackUrl)} onClick={() => testSend("slack")}>{testing === "slack" ? "送信中…" : "テスト送信"}</button>
        </div>
        <div className="field">
          <label>Webhook URL({keyStore}。{hasSlack ? "設定済み" : "未設定"})</label>
          <input type="password" value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} placeholder={hasSlack ? "変更する場合のみ入力" : "https://hooks.slack.com/services/..."} />
          <span className="muted">Slack の「アプリ」→「Incoming Webhooks」でチャンネルを選ぶと URL が発行されます。{web && " ブラウザ版は CORS 中継が無くても送れますが、送信の成否は分かりません。"}</span>
        </div>

        <div className="row">
          <label><input type="checkbox" checked={s.notifications.channels.includes("line")} onChange={() => toggleChannel("line")} /> LINE(Messaging API)</label>
          <button className="btn secondary small" disabled={testing !== null || (!hasLine && !lineTok) || !s.notifications.line_to.trim()} onClick={() => testSend("line")}>{testing === "line" ? "送信中…" : "テスト送信"}</button>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>チャネルアクセストークン({keyStore}。{hasLine ? "設定済み" : "未設定"})</label>
            <input type="password" value={lineTok} onChange={(e) => setLineTok(e.target.value)} placeholder={hasLine ? "変更する場合のみ入力" : "LINE Developers で発行した長期トークン"} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>送信先(自分のユーザー ID)</label>
            <input value={s.notifications.line_to} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, line_to: e.target.value } })} placeholder="U で始まる ID" />
          </div>
        </div>
        <p className="muted">
          LINE Developers で Messaging API のチャネルを作り、そのボットを友だち追加してください。ユーザー ID はチャネルの「チャネル基本設定」にある「あなたのユーザー ID」です。
          {web && " ブラウザ版から送るには CORS 中継(VITE_PROXY_BASE)が必要です。"}
        </p>
        {testMsg && <p className={testMsg.startsWith("テスト送信に失敗") ? "error" : "ok"}>{testMsg}</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>ポモドーロ</h2>
        <label><input type="checkbox" checked={s.pomodoro.enabled} onChange={(e) => setS({ ...s, pomodoro: { ...s.pomodoro, enabled: e.target.checked } })} /> メモを書く画面にタイマーを出す</label>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field"><label>作業(分)</label><input type="number" min={1} max={120} value={s.pomodoro.work_minutes} onChange={(e) => setS({ ...s, pomodoro: { ...s.pomodoro, work_minutes: Number(e.target.value) || 25 } })} /></div>
          <div className="field"><label>休憩(分)</label><input type="number" min={1} max={60} value={s.pomodoro.break_minutes} onChange={(e) => setS({ ...s, pomodoro: { ...s.pomodoro, break_minutes: Number(e.target.value) || 5 } })} /></div>
        </div>
        <p className="muted">作業が終わると休憩が自動で始まり、休憩が終わったら止まります。要らなければオフにしてください。</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>データ</h2>
        {web ? (
          <p className="muted">
            データはこのブラウザの中にだけ保存されています。ブラウザのサイトデータを消すと一緒に消え、他の端末やブラウザからは見えません。定期的に書き出してください。
          </p>
        ) : (
          <>
            <div className="field"><label>保存先フォルダ(変更後は再起動)</label><input value={s.data_dir} onChange={(e) => setS({ ...s, data_dir: e.target.value })} /></div>
            <p className="muted">メモは Markdown、論文リストは JSON としてこのフォルダに置かれます。このフォルダがそのままバックアップになります。ブラウザ版に持ち込むときは下の「書き出す」を使ってください。</p>
          </>
        )}

        <h3>書き出す</h3>
        <p className="muted">論文リスト・メモ・記録(AI の要約と採点を含む)・設定を 1 つの ZIP にします。API キーは含めません。解凍するとデスクトップ版のデータフォルダと同じ並びになります。</p>
        <div className="row">
          <label><input type="checkbox" checked={includePdfs} onChange={(e) => setIncludePdfs(e.target.checked)} /> 保存済みの PDF も含める(大きくなります)</label>
          <button className="btn secondary small" disabled={exporting} onClick={doExport}>{exporting ? "書き出し中…" : "書き出す"}</button>
        </div>
        {exportMsg && <p className="muted">{exportMsg}</p>}

        <h3>取り込む</h3>
        <p className="muted">
          書き出した ZIP か、デスクトップ版のデータフォルダを圧縮したものを読み込み、<strong>今のデータと置き換えます</strong>。
          置き換える前の状態は自動でデータフォルダの backups/ に書き出します。デスクトップ版のフォルダを手で圧縮するときは、先にアプリを終了してください。
        </p>
        <div className="row">
          <input type="file" accept=".zip,application/zip" onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setImportErr(null); }} />
          <ConfirmButton label="このファイルで置き換える" confirmLabel="今のデータを置き換えて取り込む" disabled={!importFile} onConfirm={doImport} />
        </div>
        {importErr && (
          <div>
            <p className="error">{importErr.text}</p>
            {importErr.reload && <button className="btn small" onClick={() => location.reload()}>読み込み直す</button>}
          </div>
        )}
      </div>

      <div className="row">
        <button className="btn" onClick={save}>保存</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
    </>
  );
}
