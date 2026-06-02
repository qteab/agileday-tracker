import { load } from "@tauri-apps/plugin-store";

export type MenuBarMode = "off" | "compact" | "full";

/** "system" follows the macOS appearance via prefers-color-scheme. */
export type ThemeMode = "system" | "light" | "dark";

export interface DisplayPrefs {
  menuBarMode: MenuBarMode;
  theme: ThemeMode;
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  menuBarMode: "compact",
  theme: "system",
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
  theme?: ThemeMode;
}

export async function loadDisplayPrefs(): Promise<DisplayPrefs> {
  const store = await getStore();
  const saved = await store.get<LegacyDisplayPrefs>(DISPLAY_KEY);
  if (!saved) return { ...DEFAULT_DISPLAY_PREFS };
  const theme: ThemeMode = saved.theme ?? DEFAULT_DISPLAY_PREFS.theme;
  if (saved.menuBarMode) {
    return { menuBarMode: saved.menuBarMode, theme };
  }
  if (typeof saved.showTimerInMenuBar === "boolean") {
    return { menuBarMode: saved.showTimerInMenuBar ? "full" : "off", theme };
  }
  return { ...DEFAULT_DISPLAY_PREFS, theme };
}

export async function saveDisplayPrefs(prefs: DisplayPrefs): Promise<void> {
  const store = await getStore();
  await store.set(DISPLAY_KEY, prefs);
  await store.save();
}
