import { useEffect, useState } from "react";
import type { PageProps } from "../App";
import { listGraves } from "@/core/app";
import type { Grave } from "@/death";
import { Tombstone } from "../components/Avatar";

export function GraveyardPage(_: PageProps) {
  const [graves, setGraves] = useState<Grave[]>([]);
  useEffect(() => {
    listGraves().then(setGraves);
  }, []);
  return (
    <>
      <h1>墓地</h1>
      {graves.length === 0 && <p className="muted">まだ誰も死んでいません。</p>}
      <div className="row" style={{ alignItems: "flex-start" }}>
        {graves.map((g, i) => (
          <div className="card" key={i} style={{ width: 200, textAlign: "center" }}>
            <Tombstone size={80} />
            <div><strong>{g.died_on}</strong></div>
            <div className="muted">連続 {g.streak} 日 · 肉 {g.meat}</div>
          </div>
        ))}
      </div>
    </>
  );
}
