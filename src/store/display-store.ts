import { load } from "@tauri-apps/plugin-store";

export type MenuBarMode = "off" | "compact" | "full";

/** "system" follows the macOS appearance via prefers-color-scheme. */
export type ThemeMode = "system" | "light" | "dark";

export const INACTIVITY_MIN_MINUTES = 1;
export const INACTIVITY_MAX_MINUTES = 120;

export interface DisplayPrefs {
  menuBarMode: MenuBarMode;
  theme: ThemeMode;
  /** Warn after this many idle minutes while a timer runs. Off by default. */
  inactivityEnabled: boolean;
  inactivityMinutes: number;
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  menuBarMode: "compact",
  theme: "system",
  inactivityEnabled: false,
  inactivityMinutes: 10,
};

export function clampInactivityMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_DISPLAY_PREFS.inactivityMinutes;
  return Math.min(INACTIVITY_MAX_MINUTES, Math.max(INACTIVITY_MIN_MINUTES, Math.round(minutes)));
}

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
  inactivityEnabled?: boolean;
  inactivityMinutes?: number;
}

export async function loadDisplayPrefs(): Promise<DisplayPrefs> {
  const store = await getStore();
  const saved = await store.get<LegacyDisplayPrefs>(DISPLAY_KEY);
  if (!saved) return { ...DEFAULT_DISPLAY_PREFS };
  const theme: ThemeMode = saved.theme ?? DEFAULT_DISPLAY_PREFS.theme;
  const inactivityEnabled = saved.inactivityEnabled ?? DEFAULT_DISPLAY_PREFS.inactivityEnabled;
  const inactivityMinutes = clampInactivityMinutes(
    saved.inactivityMinutes ?? DEFAULT_DISPLAY_PREFS.inactivityMinutes
  );
  const menuBarMode: MenuBarMode = saved.menuBarMode
    ? saved.menuBarMode
    : typeof saved.showTimerInMenuBar === "boolean"
      ? saved.showTimerInMenuBar
        ? "full"
        : "off"
      : DEFAULT_DISPLAY_PREFS.menuBarMode;
  return { menuBarMode, theme, inactivityEnabled, inactivityMinutes };
}

export async function saveDisplayPrefs(prefs: DisplayPrefs): Promise<void> {
  const store = await getStore();
  await store.set(DISPLAY_KEY, prefs);
  await store.save();
}
