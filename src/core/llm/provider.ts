// LLM プロバイダ抽象層(仕様 7.1)

import type { LlmProviderName } from "@/core/types";

export type JsonSchema = Record<string, unknown>;

export interface LlmRequest {
  system: string;
  user: string;
  /** 指定すると JSON で返す */
  schema?: JsonSchema;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
  /** 概算でよい。表示用 */
  countTokens(text: string): Promise<number>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "rate_limit" | "refusal" | "network" | "bad_output" | "other",
  ) {
    super(message);
  }
}

export function parseJsonLoose<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // ```json ... ``` で包まれている場合
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
    if (m) return JSON.parse(m[1]) as T;
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new LlmError("LLM の出力を JSON として解釈できませんでした", "bad_output");
  }
}
