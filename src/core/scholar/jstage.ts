// J-STAGE WebAPI(Atom)。キー不要。国内学会誌の本文 PDF はここが強い

import { normalizeDoi } from "@/core/papers/queue";
import { stripTags, type Candidate, type FetchFn } from "./types";

const BASE = "https://api.jstage.jst.go.jp/searchapi/do";

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
}

/** <ja>…</ja><en>…</en> の入れ子から、日本語優先で 1 つ取る(空の <ja/> は英語に落ちる) */
function jaOrEn(xml: string | null): string | null {
  if (!xml) return null;
  return stripTags(tag(xml, "ja")) ?? stripTags(tag(xml, "en")) ?? stripTags(xml);
}

/**
 * J-STAGE の entry は
 *   <article_title><en/><ja><![CDATA[…]]></ja></article_title>
 *   <article_link><en>…</en><ja>…</ja></article_link>
 *   <author><en><name>…</name></en><ja><name>…</name></ja></author>
 *   <material_title>…</material_title> <pubyear>…</pubyear> <prism:doi>…</prism:doi>
 * という形。抄録は検索 API には含まれない
 */
export function parseJstageFeed(xml: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const title = jaOrEn(tag(e, "article_title")) ?? stripTags(tag(e, "title"));
    if (!title) continue;
    const doiRaw = stripTags(tag(e, "prism:doi") ?? tag(e, "doi"));
    const doi = doiRaw ? normalizeDoi(doiRaw) : null;
    const link = jaOrEn(tag(e, "article_link")) ?? /<link[^>]*href="([^"]+)"/.exec(e)?.[1] ?? null;
    const authorXml = tag(e, "author") ?? "";
    const authorBlock = tag(authorXml, "ja") ?? tag(authorXml, "en") ?? authorXml;
    const authors = [...authorBlock.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((a) => stripTags(a[1]) ?? "").filter(Boolean);
    const year = Number(stripTags(tag(e, "pubyear"))) || null;
    const idm = /\/article\/([^/]+\/[^/]+\/[^/]+\/[^/]+)\//.exec(link ?? "");
    out.push({
      id: doi ?? `jstage:${idm?.[1] ?? title}`,
      title,
      authors,
      year,
      venue: jaOrEn(tag(e, "material_title")),
      doi,
      url: link,
      // 記事ページの _article を _pdf に置き換えると本文 PDF(公開されているもののみ)
      pdf_url: link && /\/_article\b/.test(link) ? link.replace(/\/_article\b/, "/_pdf") : null,
      abstract: null,
      cited_by: 0,
      sources: ["jstage"],
    });
  }
  return out;
}

export async function searchJstage(query: string, fetchFn: FetchFn, count = 15): Promise<Candidate[]> {
  const url = `${BASE}?service=3&text=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`J-STAGE ${res.status}`);
  return parseJstageFeed(await res.text());
}
