import { load } from "@tauri-apps/plugin-store";

export type MenuBarMode = "off" | "compact" | "full";

/** "system" follows the macOS appearance via prefers-color-scheme. */
export type ThemeMode = "system" | "light" | "dark";

/**
 * Which entry cards in the day list start collapsed:
 * - "off":   nothing is auto-collapsed
 * - "days":  everything before today
 * - "weeks": everything before the current week (Monday)
 */
export type ListAutoCollapse = "off" | "days" | "weeks";

export const INACTIVITY_MIN_MINUTES = 1;
export const INACTIVITY_MAX_MINUTES = 120;

export interface DisplayPrefs {
  menuBarMode: MenuBarMode;
  /** Show the bear icon next to the menu bar time, or just the text. */
  showTrayIcon: boolean;
  theme: ThemeMode;
  /** Warn after this many idle minutes while a timer runs. Off by default. */
  inactivityEnabled: boolean;
  inactivityMinutes: number;
  /** Which day-list cards start collapsed. */
  listAutoCollapse: ListAutoCollapse;
  /** Render a week heading in the day list whenever a new week starts. */
  listGroupByWeek: boolean;
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  menuBarMode: "compact",
  showTrayIcon: true,
  theme: "system",
  inactivityEnabled: false,
  inactivityMinutes: 10,
  listAutoCollapse: "weeks",
  listGroupByWeek: true,
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
  showTrayIcon?: boolean;
  theme?: ThemeMode;
  inactivityEnabled?: boolean;
  inactivityMinutes?: number;
  listAutoCollapse?: ListAutoCollapse;
  listGroupByWeek?: boolean;
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
  const showTrayIcon = saved.showTrayIcon ?? DEFAULT_DISPLAY_PREFS.showTrayIcon;
  const listAutoCollapse = saved.listAutoCollapse ?? DEFAULT_DISPLAY_PREFS.listAutoCollapse;
  const listGroupByWeek = saved.listGroupByWeek ?? DEFAULT_DISPLAY_PREFS.listGroupByWeek;
  return {
    menuBarMode,
    showTrayIcon,
    theme,
    inactivityEnabled,
    inactivityMinutes,
    listAutoCollapse,
    listGroupByWeek,
  };
}

export async function saveDisplayPrefs(prefs: DisplayPrefs): Promise<void> {
  const store = await getStore();
  await store.set(DISPLAY_KEY, prefs);
  await store.save();
}
