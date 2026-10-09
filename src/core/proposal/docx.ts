// 計画書を Word(.docx)にする(仕様 13)。ライブラリを足さず、必要最小限の OOXML を手で組んで fflate で ZIP にする。
// 見出しは Word 組み込みの「見出し 1」にするので、ナビゲーションや目次がそのまま使える。
// 体裁は A4・余白 25mm・本文 10.5pt。提出先の様式に合わせる細かい調整は Word 側でしてもらう

import { zipSync, type Zippable } from "fflate";
import type { Paper, Proposal } from "@/core/types";
import { escXml } from "./figures";
import { bodyBlocks, boldRuns, figurePlacement, numberCitations, referenceText, renderCitations } from "./model";

export interface FigureImage {
  png: Uint8Array;
  /** 元の SVG の大きさ(px)。縦横比に使う */
  width: number;
  height: number;
}

export interface ProposalImages {
  schedule?: FigureImage;
  map?: FigureImage;
}

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** 図の幅の上限。本文の幅(160mm)より少し狭く */
const MAX_FIG_EMU = 150 * 36000;

/** XML 1.0 で使えない制御文字を落とす */
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const t = (s: string) => `<w:t xml:space="preserve">${escXml(clean(s))}</w:t>`;

function runs(text: string): string {
  return boldRuns(text)
    .map((r) => {
      const lines = r.text.split("\n");
      const body = lines.map((l, i) => (i ? "<w:br/>" : "") + t(l)).join("");
      return `<w:r>${r.bold ? "<w:rPr><w:b/></w:rPr>" : ""}${body}</w:r>`;
    })
    .join("");
}

const para = (inner: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;

function image(rid: string, n: number, img: FigureImage): string {
  const cx = Math.min(MAX_FIG_EMU, Math.round(img.width * 9525));
  const cy = Math.round((cx * img.height) / img.width);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="図 ${n}"/><a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_PIC}"><pic:pic xmlns:pic="${NS_PIC}"><pic:nvPicPr><pic:cNvPr id="${n}" name="figure${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

const STYLES = `${XML_HEAD}<w:styles xmlns:w="${NS_W}">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="游明朝" w:cs="Times New Roman"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="300" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLineChars="100" w:firstLine="210"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:spacing w:after="120"/></w:pPr><w:rPr><w:rFonts w:eastAsia="游ゴシック"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Byline"><w:name w:val="Byline"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/><w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="游ゴシック"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420" w:hanging="210" w:firstLineChars="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Figure"><w:name w:val="Figure"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:spacing w:before="120"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:spacing w:after="120"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Reference"><w:name w:val="Reference"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420" w:hanging="420" w:firstLineChars="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="19"/></w:rPr></w:style>
</w:styles>`;

export function buildDocx(p: Proposal, byKey: Map<string, Paper>, images: ProposalImages = {}, now = new Date()): Uint8Array {
  const { numbers, ordered } = numberCitations(p, byKey);
  const placement = figurePlacement(p, { schedule: !!images.schedule, map: !!images.map });
  const rels: string[] = [`<Relationship Id="rIdStyles" Type="${NS_R}/styles" Target="styles.xml"/>`];
  const media: Zippable = {};
  const body: string[] = [];
  let figNo = 0;

  const figures = (where: string | null) => {
    for (const f of placement.get(where) ?? []) {
      const img = images[f]!;
      figNo++;
      const rid = `rIdImg${figNo}`;
      rels.push(`<Relationship Id="${rid}" Type="${NS_R}/image" Target="media/figure${figNo}.png"/>`);
      media[`word/media/figure${figNo}.png`] = [img.png, { level: 0 }];
      body.push(para(image(rid, figNo, img), '<w:pStyle w:val="Figure"/>'));
      body.push(para(runs(`図 ${figNo}　${(f === "schedule" ? p.schedule.caption : p.map.caption).trim()}`), '<w:pStyle w:val="Caption"/>'));
    }
  };

  body.push(para(runs(p.title.trim() || "研究計画書"), '<w:pStyle w:val="Title"/>'));
  const byline = [p.affiliation.trim(), p.author.trim()].filter(Boolean).join("　");
  if (byline) body.push(para(runs(byline), '<w:pStyle w:val="Byline"/>'));

  for (const s of p.sections) {
    if (s.heading.trim()) body.push(para(runs(s.heading.trim()), '<w:pStyle w:val="Heading1"/>'));
    for (const b of bodyBlocks(renderCitations(s.body, numbers))) {
      body.push(b.kind === "bullet" ? para(runs(`・${b.text}`), '<w:pStyle w:val="ListBullet"/>') : para(runs(b.text)));
    }
    figures(s.id);
  }
  figures(null);

  if (ordered.length) {
    body.push(para(runs(p.references_heading.trim() || "参考文献"), '<w:pStyle w:val="Heading1"/>'));
    ordered.forEach((paper, i) => body.push(para(runs(`[${i + 1}]\t${referenceText(paper)}`), '<w:pStyle w:val="Reference"/><w:tabs><w:tab w:val="left" w:pos="420"/></w:tabs>')));
  }

  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/><w:docGrid w:type="lines" w:linePitch="360"/></w:sectPr>';
  const document = `${XML_HEAD}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"><w:body>${body.join("")}${sect}</w:body></w:document>`;

  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const core = `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escXml(clean(p.title))}</dc:title><dc:creator>${escXml(clean(p.author))}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;

  const enc = (s: string) => new TextEncoder().encode(s);
  const files: Zippable = {
    "[Content_Types].xml": enc(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    ),
    "_rels/.rels": enc(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ),
    "docProps/core.xml": enc(core),
    "word/document.xml": enc(document),
    "word/styles.xml": enc(STYLES),
    "word/_rels/document.xml.rels": enc(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`),
    ...media,
  };
  return zipSync(files);
}
