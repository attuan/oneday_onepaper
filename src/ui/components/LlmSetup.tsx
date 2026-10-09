// LLM の接続先の設定(仕様 7.1)。設定画面と、AI を使う画面のその場の設定で同じものを使う

import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import type { Settings } from "@/core/types";
import { apiUsable, getApiKey, getOpenAiKey, platform, setApiKey, setOpenAiKey, testLlm, updateSettings } from "@/core/app";
import { OPENAI_COMPAT_PRESETS } from "@/core/llm/openaiCompat";

export const PROVIDER_DEFAULTS: Record<Settings["llm"]["provider"], { model: string; base_url: string | null }> = {
  anthropic: { model: "claude-opus-5", base_url: null },
  openai: { model: "", base_url: OPENAI_COMPAT_PRESETS[0].baseUrl },
  ollama: { model: "llama3.1", base_url: null },
};

export interface LlmKeys {
  key: string;
  setKey: (v: string) => void;
  hasKey: boolean;
  oaKey: string;
  setOaKey: (v: string) => void;
  hasOaKey: boolean;
}

/** プロバイダ・モデル・接続先・キーの入力欄。保存は呼び出し側 */
export function LlmFields({ s, setS, keys, showLanguage = true }: { s: Settings; setS: (s: Settings) => void; keys: LlmKeys; showLanguage?: boolean }) {
  const web = platform() === "web";
  const keyStore = web ? "このブラウザに保存。暗号化はされません" : "OS のキーチェーンに保存";
  return (
    <>
      <div className="row">
        <div className="field">
          <label>プロバイダ</label>
          <select value={s.llm.provider} onChange={(e) => setS({ ...s, llm: { ...s.llm, ...PROVIDER_DEFAULTS[e.target.value as Settings["llm"]["provider"]], provider: e.target.value as Settings["llm"]["provider"] } })}>
            <option value="anthropic">Anthropic API</option>
            <option value="openai">OpenAI 互換(OpenAI / Gemini / OpenRouter / LM Studio など)</option>
            <option value="ollama">Ollama(ローカル)</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}><label>モデル</label><input value={s.llm.model} onChange={(e) => setS({ ...s, llm: { ...s.llm, model: e.target.value } })} /></div>
        {showLanguage && (
          <div className="field">
            <label>出力言語</label>
            <select value={s.language} onChange={(e) => setS({ ...s, language: e.target.value as Settings["language"] })}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </div>
        )}
      </div>
      {s.llm.provider === "anthropic" && (
        <div className="field">
          <label>API キー({keyStore}。{keys.hasKey ? "設定済み" : "未設定"})</label>
          <input type="password" value={keys.key} onChange={(e) => keys.setKey(e.target.value)} placeholder={keys.hasKey ? "変更する場合のみ入力" : "sk-ant-..."} />
        </div>
      )}
      {s.llm.provider === "openai" && (
        <>
          <div className="row">
            <div className="field">
              <label>接続先</label>
              <select value={OPENAI_COMPAT_PRESETS.some((p) => p.baseUrl === s.llm.base_url) ? s.llm.base_url! : ""} onChange={(e) => e.target.value && setS({ ...s, llm: { ...s.llm, base_url: e.target.value } })}>
                <option value="">(URL を直接入力)</option>
                {OPENAI_COMPAT_PRESETS.map((p) => <option key={p.baseUrl} value={p.baseUrl}>{p.label}{p.note && ` — ${p.note}`}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}><label>URL(/chat/completions の手前まで)</label><input value={s.llm.base_url ?? ""} placeholder="https://api.openai.com/v1" onChange={(e) => setS({ ...s, llm: { ...s.llm, base_url: e.target.value || null } })} /></div>
          </div>
          <div className="field">
            <label>API キー({keyStore}。{keys.hasOaKey ? "設定済み" : "未設定"}。ローカルのサーバーなら空でよい)</label>
            <input type="password" value={keys.oaKey} onChange={(e) => keys.setOaKey(e.target.value)} placeholder={keys.hasOaKey ? "変更する場合のみ入力" : ""} />
          </div>
          <p className="muted">モデル名は接続先のものを上の欄に入れてください。単価表に無いモデルは使用量の金額が $0 と出ます。{web ? " ブラウザ版では、接続先が CORS を許可していないと届きません。" : " デスクトップ版で届くのは、上の一覧にある接続先とローカル(localhost)だけです。"}</p>
        </>
      )}
      {s.llm.provider === "ollama" && (
        <div className="field"><label>Ollama の URL</label><input value={s.llm.base_url ?? ""} placeholder="http://localhost:11434" onChange={(e) => setS({ ...s, llm: { ...s.llm, base_url: e.target.value || null } })} /></div>
      )}
    </>
  );
}

/** キーの状態を読み、入力を持つ */
export function useLlmKeys(): LlmKeys & { saveKeys: () => Promise<void> } {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [oaKey, setOaKey] = useState("");
  const [hasOaKey, setHasOaKey] = useState(false);
  useEffect(() => {
    getApiKey().then((k) => setHasKey(!!k));
    getOpenAiKey().then((k) => setHasOaKey(!!k));
  }, []);
  const saveKeys = async () => {
    if (key) {
      await setApiKey(key);
      setHasKey(true);
      setKey("");
    }
    if (oaKey) {
      await setOpenAiKey(oaKey);
      setHasOaKey(true);
      setOaKey("");
    }
  };
  return { key, setKey, hasKey, oaKey, setOaKey, hasOaKey, saveKeys };
}

/**
 * AI を使う画面の中で API を設定する。保存して試し、つながったら onReady を呼ぶ。
 * 設定画面に行かなくても API に切り替えられるように
 */
export function LlmSetupCard({ state, setState, onReady }: Pick<PageProps, "state" | "setState"> & { onReady: (model: string) => void }) {
  const [s, setS] = useState<Settings>(state.settings);
  const keys = useLlmKeys();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const saveAndTest = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await updateSettings(state, { ...state.settings, llm: { ...s.llm, summary_via: "api" } });
      setState(next);
      await keys.saveKeys();
      if (!(await apiUsable(next.settings))) {
        setMsg({ ok: false, text: next.settings.llm.provider === "anthropic" ? "API キーを入れてください" : "接続先の URL とモデル名を入れてください" });
        return;
      }
      const r = await testLlm(next.settings);
      setMsg({ ok: true, text: `つながりました(${r.model})` });
      onReady(r.model);
    } catch (e) {
      setMsg({ ok: false, text: `つながりませんでした: ${e instanceof Error ? e.message : e}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card llm-setup">
      <strong>API を設定する</strong>
      <p className="muted">
        キーを入れると、ボタン 1 つで AI に頼めます(コピーと貼り付けの往復が要りません)。Google Gemini や OpenRouter には無料で使える枠があります。
        ここで入れた設定は設定画面の「LLM」と同じものです。
      </p>
      <LlmFields s={s} setS={setS} keys={keys} showLanguage={false} />
      <button className="btn small" disabled={busy} onClick={saveAndTest}>{busy ? "試しています…" : "保存して接続を試す"}</button>
      {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
    </div>
  );
}
