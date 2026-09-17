// OpenAI 互換の /chat/completions を話す行き先をまとめて受ける(仕様 7.1)。
// OpenAI、Gemini(OpenAI 互換エンドポイント)、OpenRouter、Groq、LM Studio など。違いは URL とキーとモデル名だけ

import { roughTokenCount } from "@/core/usage/cost";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./provider";

export const OPENAI_COMPAT_PRESETS: { label: string; baseUrl: string; note: string }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", note: "" },
  { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", note: "Google AI Studio のキー。無料枠がある" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", note: "無料のモデルもある" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", note: "" },
  { label: "LM Studio(ローカル)", baseUrl: "http://localhost:1234/v1", note: "キー不要" },
];

export interface OpenAiCompatOptions {
  baseUrl: string;
  /** ローカルのサーバーなら空でよい */
  apiKey?: string | null;
  model: string;
  fetch?: typeof globalThis.fetch;
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiCompatProvider implements LlmProvider {
  readonly name = "openai" as const;
  readonly model: string;
  private baseUrl: string;
  private apiKey: string;
  private fetchFn: typeof globalThis.fetch;

  constructor(opts: OpenAiCompatOptions) {
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey?.trim() ?? "";
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private post(req: LlmRequest, jsonMode: boolean): Promise<Response> {
    // スキーマ指定(json_schema)は行き先によって通らないので、スキーマは文面で伝え、JSON モードだけ頼む。
    // 出力の上限も名前が割れている(max_tokens / max_completion_tokens)ので送らない
    const system = req.schema ? `${req.system}\n\n次の JSON Schema に合う JSON オブジェクトだけを返してください。前置きやコードフェンスは不要です。\n${JSON.stringify(req.schema)}` : req.system;
    return this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: req.user },
        ],
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    let res: Response;
    try {
      res = await this.post(req, !!req.schema);
      // JSON モードを知らないサーバーは 400 を返す。文面の指示だけでもう一度
      if (res.status === 400 && req.schema) res = await this.post(req, false);
    } catch {
      throw new LlmError(`LLM に接続できません (${this.baseUrl})。ブラウザ版では、行き先が CORS を許可していないと届きません`, "network");
    }
    if (res.status === 401 || res.status === 403) throw new LlmError("API キーが違うか、権限がありません", "auth");
    if (res.status === 429) throw new LlmError("レート制限か、無料枠の上限です。少し待ってからもう一度", "rate_limit");
    if (!res.ok) throw new LlmError(`LLM エラー ${res.status}: ${(await res.text()).slice(0, 300)}`, "other");
    const data = (await res.json()) as ChatCompletion;
    const msg = data.choices?.[0]?.message;
    if (msg?.refusal) throw new LlmError(`LLM が応答を断りました: ${msg.refusal}`, "refusal");
    if (!msg?.content) throw new LlmError("LLM の応答が空でした", "bad_output");
    return {
      text: msg.content,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model ?? this.model,
    };
  }

  async countTokens(text: string): Promise<number> {
    return roughTokenCount(text);
  }
}
