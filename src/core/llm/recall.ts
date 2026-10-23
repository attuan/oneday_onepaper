// LLM の記憶から論文の候補を挙げてもらう(タスク recall)。
// キーワード検索はアブストに語が載っている論文しか拾えない。分野の定番・古典や、違う用語で書かれた関連研究を LLM の想起で補う。
// 原則 5(論文の存在は LLM に保証させない)は守る: ここで挙がったものは scholar/verify.ts で学術 API に照合できたものだけを候補に混ぜる

import { chatPrompt, checkPasted, parsePapersJson, type ChatPaperInput } from "./handoff";
import type { LlmProvider } from "./provider";
import type { TaskResult } from "./tasks";

// 欠けを null で返させるとスキーマが行き先ごとに通ったり通らなかったりするので、
// 文字列は空文字・年は 0 で返させ、parsePapersJson(chatPaper)が null に直す
const RECALL_SCHEMA = {
  type: "object",
  properties: {
    papers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          authors: { type: "array", items: { type: "string" } },
          year: { type: "integer" },
          venue: { type: "string" },
          doi: { type: "string" },
          arxiv_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["title", "authors", "year", "venue", "doi", "arxiv_id", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["papers"],
  additionalProperties: false,
};

export function buildRecallRequest(keywords: string, context: string, language: string) {
  const lang = language === "en" ? "English" : "日本語";
  return {
    system: [
      "あなたは分野を広く知る司書です。ユーザーの関心に合う実在の論文を、あなたの知識の中から 8〜12 本挙げてください。",
      "確かに存在すると言い切れる論文だけを挙げ、うろ覚えのものは挙げないでください。挙がった論文はアプリが学術 API で実在を照合し、確認できたものだけを使います。",
      "全体像が分かるサーベイ、分野の基礎になった古典、代表的な研究が混ざるようにしてください。",
      "title は原題のまま(英語の論文なら英語で)。訳さないでください。",
      "書誌(authors, year, venue, doi, arxiv_id)は確かに分かるものだけ。自信が無い項目は空文字(year は 0)にし、DOI や arXiv ID を推測で作らないでください。",
      "arxiv_id は「2301.00001」の形(版の v は付けない)。doi は「10.」で始まる部分だけ。",
      `reason は、この関心になぜ役立つかを${lang}で 1〜2 文。`,
    ].join(""),
    user: `興味のあるキーワード: ${keywords}${context ? `\n補足: ${context}` : ""}`,
    schema: RECALL_SCHEMA,
    maxTokens: 3000,
    effort: "medium" as const,
  };
}

export async function runRecall(llm: LlmProvider, keywords: string, context: string, language: string): Promise<TaskResult<ChatPaperInput[]>> {
  const res = await llm.complete(buildRecallRequest(keywords, context, language));
  return { output: parsePapersJson(res.text), res };
}

// ---- API を通さない道(仕様 7.4)。貼り付けて頼むときはこちら ----

const EXAMPLE = { papers: [{ title: "…", authors: ["…"], year: 2017, venue: "", doi: "", arxiv_id: "", reason: "…" }] };

export function buildRecallPrompt(keywords: string, context: string, language: string): string {
  return chatPrompt(buildRecallRequest(keywords, context, language), EXAMPLE);
}

export function parseRecallAnswer(text: string, prompt: string): ChatPaperInput[] {
  checkPasted(text, prompt);
  return parsePapersJson(text);
}
