import { DEFAULT_SETTINGS, type Settings } from "@/core/types";
import { fs, joinPath } from "./backend";

// appConfigDir/config.json = { data_dir } → data_dir/settings.json

async function pointerPath(): Promise<string> {
  const dir = await fs.appConfigDir();
  return joinPath(dir, "config.json");
}

export async function resolveDataDir(): Promise<string> {
  try {
    const p = await pointerPath();
    if (await fs.exists(p)) {
      const j = JSON.parse(await fs.readText(p)) as { data_dir?: string };
      if (j.data_dir) return j.data_dir;
    }
  } catch {
    /* fall through */
  }
  return fs.defaultDataDir();
}

export async function setDataDirPointer(dataDir: string): Promise<void> {
  await fs.writeText(await pointerPath(), JSON.stringify({ data_dir: dataDir }, null, 2));
}

export function settingsPath(dataDir: string): string {
  return joinPath(dataDir, "settings.json");
}

export async function loadSettings(dataDir: string): Promise<Settings> {
  const p = settingsPath(dataDir);
  let stored: Partial<Settings> = {};
  if (await fs.exists(p)) {
    try {
      stored = JSON.parse(await fs.readText(p)) as Partial<Settings>;
    } catch {
      stored = {};
    }
  }
  return mergeSettings(dataDir, stored);
}

export function mergeSettings(dataDir: string, stored: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    data_dir: dataDir,
    llm: { ...DEFAULT_SETTINGS.llm, ...(stored.llm ?? {}) },
    grace: { ...DEFAULT_SETTINGS.grace, ...(stored.grace ?? {}) },
    search: { ...DEFAULT_SETTINGS.search, ...(stored.search ?? {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(stored.notifications ?? {}) },
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await fs.writeText(settingsPath(s.data_dir), JSON.stringify(s, null, 2));
  await setDataDirPointer(s.data_dir);
}
