// 論点の台帳を、読んだ論文で更新するための頼み方(仕様 7.6)

import type { Paper } from "@/core/types";
import { paperHeader } from "@/core/llm/tasks";
import { LlmError, parseJsonLoose } from "@/core/llm/provider";
import { STANCES, currentView, type Issue, type IssueProposals, type Stance } from "./model";

const MAX_LINKS = 4;
const MAX_NEW = 2;

const STANCE_RULES = "stance は raises(この論文が問いを立てている・新しく持ち込んでいる)/ supports(問いへの今の理解を支持する結果・主張)/ challenges(今の理解に反する・覆す結果・主張)/ refines(条件や範囲を付ける・一部だけ当てはまる)のどれか。";

const SCHEMA = {
  type: "object",
  properties: {
    links: {
      type: "array",
      items: {
        type: "object",
        properties: { issue: { type: "string" }, stance: { type: "string", enum: STANCES }, note: { type: "string" }, in_memo: { type: "boolean" }, new_view: { type: "string" } },
        required: ["issue", "stance", "note", "in_memo", "new_view"],
        additionalProperties: false,
      },
    },
    new_issues: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, stance: { type: "string", enum: STANCES }, note: { type: "string" }, in_memo: { type: "boolean" }, view: { type: "string" } },
        required: ["question", "stance", "note", "in_memo", "view"],
        additionalProperties: false,
      },
    },
  },
  required: ["links", "new_issues"],
  additionalProperties: false,
};

const SHAPE = {
  links: [{ issue: "q1", stance: "supports", note: "この論文がこの論点について言っていること(1〜2 文)", in_memo: true, new_view: "書き換えた今の理解(2〜3 文)。変えなくてよければ空文字" }],
  new_issues: [{ question: "分野の問い(〜か?)", stance: "raises", note: "この論文がこの問いについて言っていること(1〜2 文)", in_memo: false, view: "今わかっていること(1〜2 文)" }],
};

/** 論点に q1, q2 … の短い番号を振る。LLM に長い ID を写させると崩れるため */
export function issueRefs(issues: Issue[]): Map<string, string> {
  return new Map(issues.map((i, n) => [`q${n + 1}`, i.id]));
}

export function buildIssuesRequest(paper: Paper, material: string, memoBody: string, issues: Issue[], language: string) {
  const lang = language === "en" ? "English" : "日本語";
  const list = issues.length
    ? issues.map((i, n) => `q${n + 1}. ${i.question}${i.status === "settled" ? "(決着済み)" : ""}\n   今の理解: ${currentView(i) || "(まだ無い)"}`).join("\n")
    : "(まだ論点はありません)";
  return {
    system: [
      `あなたは研究室の指導教員で、学生が分野の論点(研究上の問い)の台帳を育てるのを手伝います。新しく読んだ論文が、台帳のどの論点にどう関わるかを見つけてください。出力は${lang}で。`,
      `links: 台帳の論点のうち、この論文が実際に関わるものだけ(最大 ${MAX_LINKS} 個。無理につながない)。issue は論点の番号(q1 など)。${STANCE_RULES}`,
      "note: この論文がその論点について何を言っているかを 1〜2 文で。論文情報に無いことは書かない。",
      "in_memo: 学生のメモの中で、その論点(またはそれに当たる内容)に自分から触れているなら true。メモに書かれていることだけで判断する。",
      "new_view: この論文を踏まえて「今の理解」を書き換えるなら、その文(2〜3 文。前の理解を残しつつ、この論文で何が変わったかがわかるように)。変わらなければ空文字。",
      `new_issues: 台帳に無い論点で、この論文が立てている・持ち込んでいる重要な問いがあれば最大 ${MAX_NEW} 個。この論文だけの細部ではなく、ほかの論文でも答えが出せる分野の問いにする。台帳の論点と重なるものは立てない。question は「〜か?」の形で 40 字程度まで。view はその問いについて今わかっていること。`,
    ].join("\n"),
    user: `${paperHeader(paper)}\n\n${material}\n\n[学生のメモ]\n${memoBody}\n\n[論点の台帳]\n${list}`,
    schema: SCHEMA,
    maxTokens: 2048,
    effort: "medium" as const,
  };
}

/** API を通さない道用。スキーマを渡せないので、形は文面で伝える */
export function buildIssuesPrompt(req: { system: string; user: string }): string {
  return [req.system, "", req.user, "", "下の形の JSON だけを返してください。前置き・説明・コードフェンスは不要です。", JSON.stringify(SHAPE, null, 1)].join("\n");
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const stanceOf = (v: unknown, fallback: Stance): Stance => (STANCES.includes(v as Stance) ? (v as Stance) : fallback);

/** refs は issueRefs の結果。知らない番号へのつながりは捨てる */
export function parseIssueProposals(text: string, refs: Map<string, string>): IssueProposals {
  const raw = parseJsonLoose<{ links?: unknown; new_issues?: unknown }>(text);
  if (!raw || typeof raw !== "object" || (!Array.isArray(raw.links) && !Array.isArray(raw.new_issues))) {
    throw new LlmError("論点の提案を読み取れませんでした。AI の回答の JSON 全体をコピーしてください", "bad_output");
  }
  const seen = new Set<string>();
  const links = (Array.isArray(raw.links) ? raw.links : []).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = refs.get(str(o.issue).toLowerCase()) ?? refs.get(`q${str(o.issue).replace(/\D/g, "")}`);
    if (!id || seen.has(id) || !str(o.note)) return [];
    seen.add(id);
    return [{ issue_id: id, stance: stanceOf(o.stance, "supports"), note: str(o.note), in_memo: o.in_memo === true, new_view: str(o.new_view) }];
  });
  const new_issues = (Array.isArray(raw.new_issues) ? raw.new_issues : []).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    if (!str(o.question)) return [];
    return [{ question: str(o.question), stance: stanceOf(o.stance, "raises"), note: str(o.note), in_memo: o.in_memo === true, view: str(o.view) }];
  });
  return { links: links.slice(0, MAX_LINKS), new_issues: new_issues.slice(0, MAX_NEW) };
}
