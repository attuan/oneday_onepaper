// 引用をたどる(仕様 8.2)。リストの 1 本を種に、引いている論文(さかのぼる)と引かれている論文(その後を追う)を出す。
// 引用関係は OpenAlex の事実なので LLM も実在照合も要らない(原則 5 が構造的に満たされる)。LLM は並べ替えだけ(app.ts)

import type { Paper } from "@/core/types";
import { SURVEY_RE } from "@/core/papers/course";
import { lookupWork, searchWorks, type WorkCandidate } from "./openalex";
import type { Candidate, FetchFn } from "./types";
import { titleMatches } from "./verify";

export type SnowballDirection = "backward" | "forward";

/** 候補の上限。rank のプロンプトに全部入れるので検索(MAX_CANDIDATES)と同じにする */
export const MAX_SNOWBALL = 40;

/** さかのぼるときに引く参照の上限(1 回の一括取得に収める。多い分は取ってから被引用数で切るのではなく、先頭から) */
export const MAX_REFS = 50;

export interface SnowballSeed extends WorkCandidate {
  /** この論文が引いている work の ID */
  referenced: string[];
}

/**
 * リストの論文を OpenAlex の work に解決する。DOI(arXiv の DOI 含む)で引き、無ければタイトル検索で突き合わせる。
 * タイトルだけの一致は verify.ts と同じ基準(副題の有無は許す。年が 2 年超ずれたら別物)
 */
export async function resolveSeed(paper: Pick<Paper, "title" | "doi" | "year">, fetchFn: FetchFn): Promise<SnowballSeed | null> {
  if (paper.doi) {
    const c = await lookupWork({ doi: paper.doi }, fetchFn);
    if (c) return c;
  }
  const results = await searchWorks(paper.title, fetchFn, 5);
  const yearOk = (c: Candidate) => paper.year == null || c.year == null || Math.abs(c.year - paper.year) <= 2;
  const hit = results.find((c) => titleMatches(paper.title, c.title) && yearOk(c));
  if (!hit) return null;
  // 検索結果は referenced_works を持たないので、見つけた work を引き直す
  return lookupWork(hit.doi ? { doi: hit.doi } : { workId: hit.id.replace(/^openalex:/, "") }, fetchFn);
}

export interface SnowballCandidate extends WorkCandidate {
  /** 既にリストにある(removed は除く)。read 以外の状態は unread 扱い */
  known: "unread" | "read" | null;
  /** 題名からサーベイ・解説らしいもの(コースの「全体像」と同じ判定) */
  survey: boolean;
  /** 自分のリストの他の論文のうち、これを引用している本数(共引用。分野の背骨を見つける信号) */
  coCited: number;
}

/**
 * 候補に「リストにあるか」「サーベイか」「リストの他の論文も引いているか」を付ける。種そのものは除く。純粋関数。
 * refsOfMine は種以外のリスト内論文の参照一覧(openalex.referencedOf の結果)
 */
export function annotateSnowball(cands: WorkCandidate[], papers: Paper[], seed: Pick<Paper, "id"> & { workId?: string }, refsOfMine: Map<string, string[]>): SnowballCandidate[] {
  const status = new Map(papers.filter((p) => p.status !== "removed").map((p) => [p.id, p.status]));
  const refLists = [...refsOfMine.values()];
  return cands
    .filter((c) => c.id !== seed.id && c.workId !== seed.workId)
    .map((c) => ({
      ...c,
      known: !status.has(c.id) ? null : status.get(c.id) === "read" ? ("read" as const) : ("unread" as const),
      survey: SURVEY_RE.test(c.title),
      coCited: refLists.filter((refs) => refs.includes(c.workId)).length,
    }));
}

/** 共引用の多い順 → 被引用数順。LLM なしの既定の並び */
export function sortSnowball<T extends SnowballCandidate>(cands: T[]): T[] {
  return [...cands].sort((a, b) => b.coCited - a.coCited || b.cited_by - a.cited_by);
}
