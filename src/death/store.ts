import { db, fs, joinPath } from "@/core/store/tauri";
import { getMeta, setMeta } from "@/core/store/db";
import type { Grave, Prisoner } from "./logic";
import { newPrisoner } from "./logic";

export async function loadPrisoner(): Promise<Prisoner | null> {
  const rows = await db.query<{ state: string; meat: number; born_at: string }>("SELECT state, meat, born_at FROM prisoner WHERE id = 1");
  const r = rows[0];
  return r ? { state: r.state as Prisoner["state"], meat: Number(r.meat), born_at: r.born_at } : null;
}

export async function savePrisoner(p: Prisoner): Promise<void> {
  await db.execute(
    "INSERT INTO prisoner(id, state, meat, born_at, grace_days) VALUES(1, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET state = excluded.state, meat = excluded.meat, born_at = excluded.born_at",
    [p.state, p.meat, p.born_at],
  );
}

export async function ensurePrisoner(today: string): Promise<Prisoner> {
  const p = await loadPrisoner();
  if (p) return p;
  const np = newPrisoner(today);
  await savePrisoner(np);
  return np;
}

export async function addGraves(graves: Grave[]): Promise<void> {
  for (const g of graves) await db.execute("INSERT INTO graves(died_on, streak, meat) VALUES(?, ?, ?)", [g.died_on, g.streak, g.meat]);
}

export async function listGraves(): Promise<Grave[]> {
  const rows = await db.query<{ died_on: string; streak: number; meat: number }>("SELECT died_on, streak, meat FROM graves ORDER BY died_on DESC");
  return rows.map((r) => ({ died_on: r.died_on, streak: Number(r.streak), meat: Number(r.meat) }));
}

export const ENABLED_ON_KEY = "death_enabled_on";
export const LAST_PROCESSED_KEY = "death_last_processed_date";

export async function getEnabledOn(): Promise<string | null> {
  return getMeta(ENABLED_ON_KEY);
}
export async function setEnabledOn(date: string): Promise<void> {
  await setMeta(ENABLED_ON_KEY, date);
}
export async function getLastProcessed(): Promise<string | null> {
  return getMeta(LAST_PROCESSED_KEY);
}
export async function setLastProcessed(date: string): Promise<void> {
  await setMeta(LAST_PROCESSED_KEY, date);
}

// ---- アバター(仕様 10.3) ----

export interface AvatarParts {
  skin: number;
  hair: number;
  stripes: number;
  accessory: number;
}

export const DEFAULT_AVATAR: AvatarParts = { skin: 0, hair: 0, stripes: 0, accessory: 0 };

export async function loadAvatar(dataDir: string): Promise<AvatarParts> {
  const p = joinPath(dataDir, "avatar.json");
  if (!(await fs.exists(p))) return DEFAULT_AVATAR;
  try {
    return { ...DEFAULT_AVATAR, ...(JSON.parse(await fs.readText(p)) as Partial<AvatarParts>) };
  } catch {
    return DEFAULT_AVATAR;
  }
}

export async function saveAvatar(dataDir: string, a: AvatarParts): Promise<void> {
  await fs.writeText(joinPath(dataDir, "avatar.json"), JSON.stringify(a, null, 2));
}
