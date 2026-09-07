import { roughTokenCount } from "@/core/usage/cost";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./provider";

export interface OllamaOptions {
  baseUrl?: string; // 既定 http://localhost:11434
  model: string;
  fetch?: typeof globalThis.fetch;
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama" as const;
  readonly model: string;
  private baseUrl: string;
  private fetchFn: typeof globalThis.fetch;

  constructor(opts: OllamaOptions) {
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          ...(req.schema ? { format: req.schema } : {}),
          options: { num_predict: req.maxTokens ?? 4096 },
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      });
    } catch (e) {
      throw new LlmError(`Ollama に接続できません (${this.baseUrl})`, "network");
    }
    if (!res.ok) throw new LlmError(`Ollama エラー ${res.status}: ${await res.text()}`, "other");
    const data = (await res.json()) as OllamaChatResponse;
    return {
      text: data.message?.content ?? "",
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      model: data.model ?? this.model,
    };
  }

  async countTokens(text: string): Promise<number> {
    return roughTokenCount(text);
  }
}
