import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { getApiKey, saveAvatar, setApiKey, updateSettings } from "@/core/app";
import { ACCESSORIES, Avatar, HAIRS, SKINS, STRIPES } from "../components/Avatar";
import { DEFAULT_AVATAR, type AvatarParts, newPrisonerPreview } from "@/death";
import type { Settings } from "@/core/types";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function SettingsPage({ state, setState }: PageProps) {
  const [s, setS] = useState<Settings>(state.settings);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<AvatarParts>(state.death?.avatar ?? DEFAULT_AVATAR);

  useEffect(() => {
    getApiKey().then((k) => setHasKey(!!k));
  }, []);

  const save = async () => {
    try {
      let st = await updateSettings(state, s);
      if (st.death) st = await saveAvatar(st, avatar);
      setState(st);
      if (key) {
        await setApiKey(key);
        setHasKey(true);
        setKey("");
      }
      setMsg("保存しました");
    } catch (e) {
      setMsg(`保存に失敗: ${e}`);
    }
  };

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
            <label>API キー(OS のキーチェーンに保存。{hasKey ? "設定済み" : "未設定"})</label>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? "変更する場合のみ入力" : "sk-ant-..."} />
          </div>
        ) : (
          <div className="field"><label>Ollama の URL</label><input value={s.llm.base_url ?? ""} placeholder="http://localhost:11434" onChange={(e) => setS({ ...s, llm: { ...s.llm, base_url: e.target.value || null } })} /></div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>通知</h2>
        <div className="row">
          <div className="field"><label>朝の通知</label><input type="time" value={s.notifications.morning} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, morning: e.target.value } })} /></div>
          <div className="field"><label>夜の通知(未読のとき)</label><input type="time" value={s.notifications.evening} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, evening: e.target.value } })} /></div>
          <div className="field"><label>締切の何分前に最終通知</label><input type="number" min={5} value={s.notifications.last_call_minutes_before} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, last_call_minutes_before: Number(e.target.value) } })} /></div>
        </div>
        <label><input type="checkbox" checked={s.notifications.channels.includes("os")} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, channels: e.target.checked ? ["os"] : [] } })} /> macOS の通知を使う</label>
        <p className="muted">ウィンドウを閉じてもメニューバーに常駐し、通知を出します。終了はメニューバーのアイコンから。休みの日は通知しません。</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>死刑機能</h2>
        <label><input type="checkbox" checked={s.death_mode} onChange={(e) => setS({ ...s, death_mode: e.target.checked })} /> 有効にする(オフのときは「シンプル機能」)</label>
        <p className="muted">読まなかった日があると囚人が死に、連続記録はリセット、肉は半減、墓地に記録が残ります。オフにしても読了の記録は残り、オンに戻したときにオフ期間の未読で死ぬことはありません。</p>
        {s.death_mode && (
          <div className="row" style={{ alignItems: "flex-start", marginTop: 10 }}>
            <Avatar parts={avatar} prisoner={state.death?.prisoner ?? newPrisonerPreview()} size={120} />
            <div>
              <div className="field"><label>肌</label><div className="row">{SKINS.map((c, i) => <button key={i} className={`swatch${avatar.skin === i ? " on" : ""}`} style={{ background: c }} onClick={() => setAvatar({ ...avatar, skin: i })} />)}</div></div>
              <div className="field"><label>髪</label><div className="row">{HAIRS.map((c, i) => <button key={i} className={`swatch${avatar.hair === i ? " on" : ""}`} style={{ background: c }} onClick={() => setAvatar({ ...avatar, hair: i })} />)}</div></div>
              <div className="field"><label>囚人服</label><div className="row">{STRIPES.map((c, i) => <button key={i} className={`swatch${avatar.stripes === i ? " on" : ""}`} style={{ background: `repeating-linear-gradient(${c[0]} 0 4px, ${c[1]} 4px 6px)` }} onClick={() => setAvatar({ ...avatar, stripes: i })} />)}</div></div>
              <div className="field"><label>小物</label><select value={avatar.accessory} onChange={(e) => setAvatar({ ...avatar, accessory: Number(e.target.value) })}>{ACCESSORIES.map((a, i) => <option key={i} value={i}>{a}</option>)}</select></div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>データ</h2>
        <div className="field"><label>保存先フォルダ(変更後は再起動)</label><input value={s.data_dir} onChange={(e) => setS({ ...s, data_dir: e.target.value })} /></div>
        <p className="muted">メモは Markdown、論文リストは JSON としてこのフォルダに置かれます。</p>
      </div>

      <div className="row">
        <button className="btn" onClick={save}>保存</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
    </>
  );
}
