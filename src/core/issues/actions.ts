// 論点の台帳の保存と LLM 呼び出し。画面からはここを呼ぶ

import type { AppState } from "@/core/app";
import { makeProvider } from "@/core/app";
import * as sql from "@/core/store/db";
import { loadIssues as load, saveIssues as save } from "@/core/store/issues";
import { newId } from "@/core/proposal/model";
import type { Paper } from "@/core/types";
import { estimateCostUsd } from "@/core/usage/cost";
import { applyProposals, issuesForPrompt, type AcceptedProposals, type IssueProposals, type IssuesFile } from "./model";
import { buildIssuesPrompt, buildIssuesRequest, issueRefs, parseIssueProposals } from "./llm";

export const loadIssues = (state: AppState) => load(state.settings.data_dir);
export const saveIssues = (state: AppState, file: IssuesFile) => save(state.settings.data_dir, file);

/** 頼む材料をそろえる。API でも貼り付けでも同じものを使い、答えを読むときの番号も同じにする */
export function issuesAsk(state: AppState, paper: Paper, material: string, memoBody: string, file: IssuesFile) {
  const shown = issuesForPrompt(file);
  const req = buildIssuesRequest(paper, material, memoBody, shown, state.settings.language);
  const refs = issueRefs(shown);
  return { req, prompt: buildIssuesPrompt(req), parse: (text: string): IssueProposals => parseIssueProposals(text, refs) };
}

export async function proposeIssues(state: AppState, ask: ReturnType<typeof issuesAsk>): Promise<IssueProposals> {
  const llm = await makeProvider(state.settings);
  const res = await llm.complete(ask.req);
  const { provider } = state.settings.llm;
  await sql.insertUsage({
    at: new Date().toISOString(),
    provider,
    model: res.model,
    task: "issues",
    input_tokens: res.inputTokens,
    output_tokens: res.outputTokens,
    est_cost_usd: estimateCostUsd(provider, res.model, res.inputTokens, res.outputTokens),
  });
  return ask.parse(res.text);
}

/** 保存の直前に読み直してから入れる。ほかのタブ・画面での変更を消さないため */
export async function acceptProposals(state: AppState, paperId: string, accepted: AcceptedProposals): Promise<IssuesFile> {
  const next = applyProposals(await loadIssues(state), paperId, accepted, new Date().toISOString(), () => newId("q"));
  await saveIssues(state, next);
  return next;
}

/** 台帳を読み直してから fn を当てて保存する */
export async function editIssues(state: AppState, fn: (f: IssuesFile) => IssuesFile): Promise<IssuesFile> {
  const next = fn(await loadIssues(state));
  await saveIssues(state, next);
  return next;
}
