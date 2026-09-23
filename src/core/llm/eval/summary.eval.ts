// 要約タスクの評価: 実物の arXiv 論文(scholar/fixtures/arxiv-sample.json)で、
// 「根拠(evidence)の引用が原文に本当にあるか」「アブストのみ / TeX 本文で結果がどう変わるか」を数える。
//
//   ANTHROPIC_API_KEY=... npm run eval
//   ONEPAPER_EVAL_PROVIDER=ollama ONEPAPER_EVAL_MODEL=llama3.1 npm run eval
//   ONEPAPER_EVAL_PROVIDER=openai OPENAI_API_KEY=... ONEPAPER_EVAL_BASE_URL=https://api.openai.com/v1 ONEPAPER_EVAL_MODEL=gpt-5 npm run eval
//
// 任意: ONEPAPER_EVAL_N=2(論文数)、ONEPAPER_EVAL_INPUT=abstract|tex|both(既定 both)、ONEPAPER_EVAL_OUT=結果 JSON の書き出し先
// フィクスチャの取り直しは scripts/fetch-arxiv-sample.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../anthropic";
import { OllamaProvider } from "../ollama";
import { OpenAiCompatProvider } from "../openaiCompat";
import type { LlmProvider } from "../provider";
import { runGrade, runSummary, type PaperContext } from "../tasks";
import { texToText } from "@/core/papers/tex";
import { newPaper } from "@/core/papers/queue";
import { estimateCostUsd } from "@/core/usage/cost";

type Fixture = { paper_id: string; title: string; abstract: string; authors: string | null; year: number | null; primary_category: string; tex: string };
const FIXTURES: Fixture[] = JSON.parse(readFileSync(new URL("../../scholar/fixtures/arxiv-sample.json", import.meta.url), "utf8"));

const env = process.env;
const providerName = env.ONEPAPER_EVAL_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENAI_API_KEY ? "openai" : "");

function makeProvider(): LlmProvider | null {
  const f = globalThis.fetch;
  if (providerName === "anthropic" && env.ANTHROPIC_API_KEY) return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ONEPAPER_EVAL_MODEL ?? "claude-opus-5", fetch: f });
  if (providerName === "ollama") return new OllamaProvider({ model: env.ONEPAPER_EVAL_MODEL ?? "llama3.1", baseUrl: env.ONEPAPER_EVAL_BASE_URL, fetch: f });
  if (providerName === "openai" && env.ONEPAPER_EVAL_BASE_URL) return new OpenAiCompatProvider({ baseUrl: env.ONEPAPER_EVAL_BASE_URL, apiKey: env.OPENAI_API_KEY ?? null, model: env.ONEPAPER_EVAL_MODEL ?? "", fetch: f });
  return null;
}

interface Result {
  paper_id: string;
  input: PaperContext["inputKind"];
  input_chars: number;
  evidence: number;
  evidence_found: number;
  unknown_fields: number;
  grade_total: number | null;
  misreadings: number;
  missing_points: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  seconds: number;
  error?: string;
}

const llm = makeProvider();
const n = Number(env.ONEPAPER_EVAL_N ?? FIXTURES.length);
const inputs: PaperContext["inputKind"][] = env.ONEPAPER_EVAL_INPUT === "abstract" ? ["abstract"] : env.ONEPAPER_EVAL_INPUT === "tex" ? ["fulltext"] : ["abstract", "fulltext"];

describe.skipIf(!llm)("summary / grade on real arXiv papers", () => {
  it(`${providerName || "(no provider)"}: evidence found rate`, async () => {
    const results: Result[] = [];
    for (const f of FIXTURES.slice(0, n)) {
      const paper = newPaper({ id: `10.48550/arxiv.${f.paper_id}`, title: f.title, authors: f.authors?.split(/,\s*/) ?? [], year: f.year, venue: "arXiv", abstract: f.abstract }, [], "eval");
      // メモは「アブストの最初の文を自分の言葉にせずそのまま」という最低限のもの。採点が壊れないかだけ見る
      const memo = `# ${f.title}\n\n## ひとこと\n${f.abstract.split(/(?<=\.)\s/)[0]}\n`;
      for (const input of inputs) {
        const text = input === "abstract" ? f.abstract : texToText(f.tex);
        const ctx: PaperContext = { paper, text, inputKind: input };
        const t0 = Date.now();
        const r: Result = { paper_id: f.paper_id, input, input_chars: text.length, evidence: 0, evidence_found: 0, unknown_fields: 0, grade_total: null, misreadings: 0, missing_points: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, seconds: 0 };
        try {
          const s = await runSummary(llm!, ctx, "ja");
          const ev = s.output.evidence ?? [];
          r.evidence = ev.length;
          r.evidence_found = ev.filter((e) => e.found).length;
          r.unknown_fields = [s.output.problem, s.output.method, s.output.results, s.output.limitations].filter((x) => /不明|unknown/i.test(x)).length;
          const g = await runGrade(llm!, ctx, memo, "ja");
          r.grade_total = g.output.total;
          r.misreadings = g.output.misreadings?.length ?? 0;
          r.missing_points = g.output.missing_points?.length ?? 0;
          for (const res of [s.res, g.res]) {
            r.input_tokens += res.inputTokens;
            r.output_tokens += res.outputTokens;
            r.cost_usd += estimateCostUsd(llm!.name, res.model, res.inputTokens, res.outputTokens);
          }
        } catch (e) {
          r.error = e instanceof Error ? e.message : String(e);
        }
        r.seconds = Math.round((Date.now() - t0) / 100) / 10;
        results.push(r);
        console.log(`${f.paper_id} ${input}: evidence ${r.evidence_found}/${r.evidence} 不明 ${r.unknown_fields} 採点 ${r.grade_total ?? "-"} ${r.seconds}s${r.error ? ` ERROR ${r.error}` : ""}`);
      }
    }
    console.table(results);
    const byInput = inputs.map((input) => {
      const rs = results.filter((r) => r.input === input && !r.error);
      const ev = rs.reduce((a, r) => a + r.evidence, 0);
      const found = rs.reduce((a, r) => a + r.evidence_found, 0);
      return { input, papers: rs.length, evidence_found_rate: ev ? Math.round((100 * found) / ev) : null, cost_usd: Math.round(rs.reduce((a, r) => a + r.cost_usd, 0) * 1000) / 1000 };
    });
    console.table(byInput);
    if (env.ONEPAPER_EVAL_OUT) writeFileSync(env.ONEPAPER_EVAL_OUT, JSON.stringify({ provider: providerName, model: llm!.model, at: new Date().toISOString(), results, byInput }, null, 2));
    expect(results.some((r) => !r.error)).toBe(true);
  });
});
