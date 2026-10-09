// 計画書の図(仕様 13)。SVG の文字列を作る純粋関数。画面のプレビューと書き出し(PNG にして Word / LaTeX へ)で同じものを使う

import type { MapFigure, ScheduleRow } from "@/core/types";

const FONT = `-apple-system, "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
const BLUE = "#1e5fb8";
const BLUE_DARK = "#164a8f";
const BLUE_LIGHT = "#e8f0fb";
const GRID = "#d5dfee";
const TEXT = "#0f2440";
const MUTED = "#5a6b85";

export interface Svg {
  svg: string;
  width: number;
  height: number;
}

export function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 全角を 2、半角を 1 として max を超えたら … で切る */
function clip(s: string, max: number): string {
  let w = 0;
  let out = "";
  for (const c of s) {
    w += /[\x20-\x7e]/.test(c) ? 1 : 2;
    if (w > max) return out + "…";
    out += c;
  }
  return out;
}

const monthIndex = (ym: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
};

const MAX_MONTHS = 48;

/** 研究スケジュールのガントチャート。月が読めない行は飛ばす。描くものが無ければ null */
export function ganttSvg(rows: ScheduleRow[]): Svg | null {
  const items = rows.flatMap((r) => {
    const a = monthIndex(r.start);
    const b = monthIndex(r.end) ?? a;
    if (a === null || b === null) return [];
    return [{ label: r.label.trim() || "(作業)", from: Math.min(a, b), to: Math.max(a, b) }];
  });
  if (!items.length) return null;
  const first = Math.min(...items.map((i) => i.from));
  const last = Math.min(Math.max(...items.map((i) => i.to)), first + MAX_MONTHS - 1);
  const n = last - first + 1;
  const width = 720;
  const labelW = 190;
  const colW = (width - labelW - 12) / n;
  const top = 44;
  const rowH = 30;
  const height = top + rowH * items.length + 12;
  const parts: string[] = [];
  // 年の帯と月の目盛り
  for (let i = 0; i < n; i++) {
    const idx = first + i;
    const x = labelW + i * colW;
    const month = (idx % 12) + 1;
    if (i === 0 || month === 1) parts.push(`<text x="${x + 2}" y="14" font-size="11" fill="${MUTED}">${Math.floor(idx / 12)}年</text>`);
    if (n <= 24 || month % 3 === 1) parts.push(`<text x="${x + colW / 2}" y="34" font-size="11" fill="${MUTED}" text-anchor="middle">${month}</text>`);
    parts.push(`<line x1="${x}" y1="${top - 4}" x2="${x}" y2="${height - 8}" stroke="${GRID}" stroke-width="${month === 1 ? 1.2 : 0.6}"/>`);
  }
  parts.push(`<line x1="${labelW + n * colW}" y1="${top - 4}" x2="${labelW + n * colW}" y2="${height - 8}" stroke="${GRID}" stroke-width="0.6"/>`);
  items.forEach((it, r) => {
    const y = top + r * rowH;
    if (r % 2 === 0) parts.push(`<rect x="0" y="${y}" width="${width}" height="${rowH}" fill="${BLUE_LIGHT}" opacity="0.5"/>`);
    parts.push(`<text x="8" y="${y + rowH / 2 + 4}" font-size="13" fill="${TEXT}">${escXml(clip(it.label, 24))}</text>`);
    const from = Math.max(it.from, first) - first;
    const to = Math.min(it.to, last) - first;
    if (to >= from) parts.push(`<rect x="${labelW + from * colW + 2}" y="${y + 7}" width="${Math.max((to - from + 1) * colW - 4, 4)}" height="${rowH - 14}" rx="3" fill="${BLUE}"/>`);
  });
  return wrap(parts, width, height);
}

/** 描画域。画面でドラッグした位置を 0〜1 に直すのにも使う */
export const MAP_GEOMETRY = { width: 680, height: 460, left: 110, top: 40, plotW: 460, plotH: 360 };

/** 先行研究マップ。軸の交点を中心にした 4 象限 */
export function mapSvg(map: MapFigure, selectedId: string | null = null): Svg {
  const { width, height, left, top, plotW, plotH } = MAP_GEOMETRY;
  const cx = left + plotW / 2;
  const cy = top + plotH / 2;
  const px = (x: number) => left + clamp01(x) * plotW;
  const py = (y: number) => top + (1 - clamp01(y)) * plotH;
  const parts: string[] = [
    `<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="#fff" stroke="${GRID}"/>`,
    `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${MUTED}"/></marker></defs>`,
    `<line x1="${left}" y1="${cy}" x2="${left + plotW}" y2="${cy}" stroke="${MUTED}" stroke-width="1.2" marker-start="url(#arr)" marker-end="url(#arr)"/>`,
    `<line x1="${cx}" y1="${top + plotH}" x2="${cx}" y2="${top}" stroke="${MUTED}" stroke-width="1.2" marker-start="url(#arr)" marker-end="url(#arr)"/>`,
    axisText(map.x_axis.low || "(横軸の左端)", left - 6, cy + 4, "end", !map.x_axis.low),
    axisText(map.x_axis.high || "(横軸の右端)", left + plotW + 6, cy + 4, "start", !map.x_axis.high),
    axisText(map.y_axis.high || "(縦軸の上端)", cx, top - 12, "middle", !map.y_axis.high),
    axisText(map.y_axis.low || "(縦軸の下端)", cx, top + plotH + 22, "middle", !map.y_axis.low),
  ];
  // 本研究を最後に描いて上に出す
  const points = [...map.points].sort((a, b) => (a.paper_id === null ? 1 : 0) - (b.paper_id === null ? 1 : 0));
  for (const p of points) {
    const x = px(p.x);
    const y = py(p.y);
    const self = p.paper_id === null;
    const sel = p.id === selectedId;
    const anchor = clamp01(p.x) > 0.75 ? "end" : "start";
    const tx = anchor === "end" ? x - 11 : x + 11;
    parts.push(
      self
        ? `<circle cx="${x}" cy="${y}" r="9" fill="${BLUE_DARK}" stroke="${sel ? TEXT : "#fff"}" stroke-width="2"/>`
        : `<circle cx="${x}" cy="${y}" r="6.5" fill="#fff" stroke="${BLUE}" stroke-width="${sel ? 3.5 : 2}"/>`,
      `<text x="${tx}" y="${y + 4}" font-size="${self ? 14 : 12}" font-weight="${self ? 700 : 400}" fill="${self ? BLUE_DARK : TEXT}" text-anchor="${anchor}">${escXml(clip(p.label, 22))}</text>`,
    );
  }
  return wrap(parts, width, height);
}

function axisText(s: string, x: number, y: number, anchor: string, placeholder: boolean): string {
  return `<text x="${x}" y="${y}" font-size="12" fill="${placeholder ? GRID : TEXT}" text-anchor="${anchor}">${escXml(clip(s, 16))}</text>`;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.5));

function wrap(parts: string[], width: number, height: number): Svg {
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family='${FONT}'><rect width="${width}" height="${height}" fill="#fff"/>${parts.join("")}</svg>`,
    width,
    height,
  };
}
