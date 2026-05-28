import { load } from "@tauri-apps/plugin-store";

export type MenuBarMode = "off" | "compact" | "full";

export interface DisplayPrefs {
  menuBarMode: MenuBarMode;
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  menuBarMode: "compact",
};

const DISPLAY_STORE_FILE = "display.json";
const DISPLAY_KEY = "displayPrefs";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(DISPLAY_STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

interface LegacyDisplayPrefs {
  showTimerInMenuBar?: boolean;
  menuBarMode?: MenuBarMode;
}

export async function loadDisplayPrefs(): Promise<DisplayPrefs> {
  const store = await getStore();
  const saved = await store.get<LegacyDisplayPrefs>(DISPLAY_KEY);
  if (!saved) return { ...DEFAULT_DISPLAY_PREFS };
  if (saved.menuBarMode) {
    return { menuBarMode: saved.menuBarMode };
  }
  if (typeof saved.showTimerInMenuBar === "boolean") {
    return { menuBarMode: saved.showTimerInMenuBar ? "full" : "off" };
  }
  return { ...DEFAULT_DISPLAY_PREFS };
}

export async function saveDisplayPrefs(prefs: DisplayPrefs): Promise<void> {
  const store = await getStore();
  await store.set(DISPLAY_KEY, prefs);
  await store.save();
}
