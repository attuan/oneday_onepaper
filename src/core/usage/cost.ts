import prices from "./prices.json";
import type { LlmProviderName } from "@/core/types";

interface Price {
  input: number;
  output: number;
}

export function priceFor(provider: LlmProviderName, model: string): Price | null {
  const table = (prices as unknown as Record<string, Record<string, Price>>)[provider] ?? {};
  if (table[model]) return table[model];
  // "claude-opus-5-xxxx" のような派生名は前方一致で拾う
  const key = Object.keys(table).find((k) => model.startsWith(k));
  return key ? table[key] : null;
}

export function estimateCostUsd(provider: LlmProviderName, model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(provider, model);
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function formatUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

/** API を叩かずにトークン数をざっくり見積もる(Ollama 用・事前表示用) */
export function roughTokenCount(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4 + other * 1.2);
}
