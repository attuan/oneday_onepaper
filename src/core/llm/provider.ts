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

/**
 * JSON を読む。API の出力に加えて、チャット AI の画面から手でコピーしたものも読めるようにしてある。
 * 前後の文章・コードフェンス・見えない空白(NBSP やゼロ幅文字)・カーブした引用符・文字列中の生の改行・末尾のカンマを許す
 */
export function parseJsonLoose<T>(text: string): T {
  const trimmed = text.replace(/^﻿/, "").trim();
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(trimmed)?.[1];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const slice = start >= 0 && end > start ? trimmed.slice(start, end + 1) : undefined;
  const pieces = [trimmed, fence, balancedObject(trimmed), slice].filter((p): p is string => !!p);
  const candidates = [...pieces, ...pieces.map(repairJson), balancedObject(repairJson(trimmed))];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c) as T;
    } catch {
      /* 次を試す */
    }
  }
  if (start >= 0 && !balancedObject(repairJson(trimmed))) {
    throw new LlmError("出力が途中で切れているようです(括弧が閉じていません)", "bad_output");
  }
  throw new LlmError("LLM の出力を JSON として解釈できませんでした", "bad_output");
}

/** 最初の { から、それと対になる } まで。閉じていなければ null */
function balancedObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

const INVISIBLE = /[​-‍⁠﻿]/;

/** 手でコピーしたときに混ざるものを JSON として正しい形に直す。文字列の中身はできるだけ変えない */
function repairJson(s: string): string {
  let out = "";
  let inStr = false;
  /** 開きがカーブした引用符だった文字列。閉じもカーブしている */
  let curly = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") {
        out += c + (s[i + 1] ?? "");
        i++;
      } else if (curly ? c === "”" || c === "“" : c === '"') {
        out += '"';
        inStr = false;
      } else if (c === '"') out += '\\"';
      else if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else if (!INVISIBLE.test(c)) out += c;
      continue;
    }
    if (c === '"' || c === "“" || c === "”") {
      out += '"';
      inStr = true;
      curly = c !== '"';
    } else if (/\s/.test(c) || INVISIBLE.test(c)) out += " ";
    else if (c === "," && /^[\s​-‍⁠﻿]*[}\]]/.test(s.slice(i + 1))) continue;
    else out += c;
  }
  return out;
}
