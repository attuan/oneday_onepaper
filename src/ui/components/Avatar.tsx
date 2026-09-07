// 囚人アバター(仕様 10.3)。パーツ選択 + 肉の段階 + 状態で見た目が変わる。ピクセル風 SVG

import type { AvatarParts, Prisoner } from "@/death";
import { meatStage } from "@/death";

export const SKINS = ["#f6d3b3", "#d9a066", "#8d5524"];
export const HAIRS = ["#2b2b2b", "#7a4b1e", "#c9a227", "#9e9e9e"];
export const STRIPES = [
  ["#ffffff", "#1e5fb8"],
  ["#ffffff", "#2b2b2b"],
  ["#fff3c4", "#b83232"],
];
export const ACCESSORIES = ["なし", "眼鏡", "帽子", "ひげ"];

export function Avatar({ parts, prisoner, size = 120 }: { parts: AvatarParts; prisoner: Prisoner; size?: number }) {
  if (prisoner.state === "dead") return <Tombstone size={size} />;
  const stage = meatStage(prisoner.meat);
  const w = 10 + stage * 2; // 体の幅(肉で太る)
  const skin = prisoner.state === "warning" ? "#cfe0f0" : SKINS[parts.skin % SKINS.length];
  const hair = HAIRS[parts.hair % HAIRS.length];
  const [s1, s2] = STRIPES[parts.stripes % STRIPES.length];
  const cx = 16;
  const bodyX = cx - w / 2;
  const stripes = [];
  for (let y = 0; y < 12; y += 2) stripes.push(<rect key={y} x={bodyX} y={16 + y} width={w} height={1} fill={s2} />);
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} shapeRendering="crispEdges" style={{ imageRendering: "pixelated" }}>
      {/* 髪 */}
      <rect x={10} y={3} width={12} height={4} fill={hair} />
      {parts.hair % 4 === 1 && <rect x={9} y={5} width={14} height={4} fill={hair} />}
      {parts.hair % 4 === 3 && <rect x={10} y={3} width={12} height={2} fill={skin} />}
      {/* 顔 */}
      <rect x={10} y={6} width={12} height={9} fill={skin} />
      <rect x={12} y={9} width={2} height={2} fill="#222" />
      <rect x={18} y={9} width={2} height={2} fill="#222" />
      {prisoner.state === "warning" ? <rect x={13} y={13} width={6} height={1} fill="#555" /> : <rect x={13} y={12} width={6} height={1} fill="#7a3b2e" />}
      {prisoner.state === "warning" && <rect x={23} y={7} width={1} height={3} fill="#4aa3ff" />}
      {/* アクセサリ */}
      {parts.accessory % 4 === 1 && (
        <>
          <rect x={11} y={8} width={4} height={4} fill="none" stroke="#333" strokeWidth={0.6} />
          <rect x={17} y={8} width={4} height={4} fill="none" stroke="#333" strokeWidth={0.6} />
        </>
      )}
      {parts.accessory % 4 === 2 && (
        <>
          <rect x={8} y={2} width={16} height={2} fill="#333" />
          <rect x={11} y={0} width={10} height={3} fill="#333" />
        </>
      )}
      {parts.accessory % 4 === 3 && <rect x={12} y={13} width={8} height={2} fill={hair} />}
      {/* 体(縞) */}
      <rect x={bodyX} y={15} width={w} height={13} fill={s1} />
      {stripes}
      {/* 手足 */}
      <rect x={bodyX - 2} y={16} width={2} height={7} fill={skin} />
      <rect x={bodyX + w} y={16} width={2} height={7} fill={skin} />
      <rect x={cx - 4} y={28} width={3} height={3} fill="#333" />
      <rect x={cx + 1} y={28} width={3} height={3} fill="#333" />
    </svg>
  );
}

export function Tombstone({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} shapeRendering="crispEdges">
      <rect x={4} y={28} width={24} height={3} fill="#5a7a4a" />
      <rect x={9} y={10} width={14} height={18} fill="#9a9a9a" />
      <rect x={10} y={7} width={12} height={4} fill="#9a9a9a" />
      <rect x={12} y={5} width={8} height={3} fill="#9a9a9a" />
      <rect x={15} y={12} width={2} height={8} fill="#555" />
      <rect x={12} y={14} width={8} height={2} fill="#555" />
    </svg>
  );
}
