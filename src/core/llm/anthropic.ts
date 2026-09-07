import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./provider";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  /** Tauri の plugin-http の fetch を渡すと CORS を回避できる */
  fetch?: typeof globalThis.fetch;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      fetch: opts.fetch,
      dangerouslyAllowBrowser: true,
      maxRetries: 2,
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 4096,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: {
          ...(req.effort ? { effort: req.effort } : {}),
          ...(req.schema ? { format: { type: "json_schema" as const, schema: req.schema } } : {}),
        },
      });
      if (response.stop_reason === "refusal") {
        throw new LlmError(
          `モデルが応答を拒否しました${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ""}`,
          "refusal",
        );
      }
      if (response.stop_reason === "max_tokens") {
        throw new LlmError("出力が max_tokens に達しました。maxTokens を増やしてください", "bad_output");
      }
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: response.model,
      };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new LlmError("API キーが無効です", "auth");
      if (e instanceof Anthropic.RateLimitError) throw new LlmError("レート制限中です。少し待ってください", "rate_limit");
      if (e instanceof Anthropic.APIConnectionError) throw new LlmError("API に接続できません", "network");
      if (e instanceof Anthropic.APIError) {
        const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
        throw new LlmError(`API エラー ${e.status}: ${detail}`, "other");
      }
      throw new LlmError(String(e), "other");
    }
  }

  async countTokens(text: string): Promise<number> {
    const r = await this.client.messages.countTokens({
      model: this.model,
      messages: [{ role: "user", content: text }],
    });
    return r.input_tokens;
  }
}
