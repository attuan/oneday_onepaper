// LLM が記憶から挙げた論文を、学術 API で実在照合する(仕様 原則 5: 論文の存在は LLM に保証させない)。
// DOI / arXiv ID があればそれで引き、無ければ OpenAlex でタイトル検索して突き合わせる。
// 照合できたものだけを候補にし、書誌(アブスト・被引用数・PDF リンク)は API のものに置き換える

import type { Paper } from "@/core/types";
import { lookupDoi, searchWorks } from "./openalex";
import type { Candidate, FetchFn } from "./types";

/** 記号・空白・大小を無視したタイトル。日本語のタイトルも残るように \W は使わない */
export const titleKey = (s: string): string => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

/** LLM が挙げた 1 本。llm/handoff.ts の ChatPaperInput と同じ形 */
export type RecalledInput = Partial<Paper> & { title: string };

export interface UnverifiedPaper {
  title: string;
  authors: string[];
  year: number | null;
  /** なぜ照合できなかったか(そのまま見せる) */
  note: string;
}

export interface VerifyOutcome {
  verified: Candidate[];
  /** 照合できなかったもの。見せるだけで、候補には入れない */
  unverified: UnverifiedPaper[];
}

/** 照合する最大件数。1 件につき API を 1〜2 回引くため */
export const MAX_VERIFY = 12;

/** 副題の有無(「Title: Subtitle」)の違いは許す。短い前方一致は別の論文に当たるので許さない */
export function titleMatches(a: string, b: string): boolean {
  const ka = titleKey(a);
  const kb = titleKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return short.length >= 20 && long.startsWith(short);
}

/** タイトルが合い、年が離れすぎていないもの(プレプリントと出版で 1〜2 年ずれる)。完全一致なら年のずれは問わない */
function pickMatch(item: RecalledInput, results: Candidate[]): Candidate | null {
  const matched = results.filter((c) => titleMatches(item.title, c.title));
  const yearOk = (c: Candidate) => item.year == null || c.year == null || Math.abs(c.year - item.year) <= 2;
  return matched.find(yearOk) ?? matched.find((c) => titleKey(c.title) === titleKey(item.title)) ?? null;
}

/** 順番に照合する(並列にするとレート制限に当たる)。API エラーは「照合できなかった」として理由ごと返す */
export async function verifyRecalled(items: RecalledInput[], fetchFn: FetchFn, max = MAX_VERIFY): Promise<VerifyOutcome> {
  const verified: Candidate[] = [];
  const unverified: UnverifiedPaper[] = [];
  for (const item of items.slice(0, max)) {
    try {
      let found: Candidate | null = null;
      if (item.doi) {
        const c = await lookupDoi(item.doi, fetchFn);
        // DOI が実在しても題名が合わなければ、別の論文の DOI を貼った可能性がある。タイトルで引き直す
        if (c && titleMatches(item.title, c.title)) found = c;
      }
      found ??= pickMatch(item, await searchWorks(item.title, fetchFn, 5));
      if (found) verified.push({ ...found, reason: item.reason ?? found.reason ?? null, recalled: true });
      else unverified.push(unv(item, "学術 API で見つかりませんでした(実在しないか、書誌が不正確)"));
    } catch (e) {
      unverified.push(unv(item, `照合に失敗しました: ${e instanceof Error ? e.message : e}`));
    }
  }
  return { verified, unverified };
}

const unv = (item: RecalledInput, note: string): UnverifiedPaper => ({ title: item.title, authors: item.authors ?? [], year: item.year ?? null, note });
