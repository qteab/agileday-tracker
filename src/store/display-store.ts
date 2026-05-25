import { load } from "@tauri-apps/plugin-store";

export interface DisplayPrefs {
  showTimerInMenuBar: boolean;
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  showTimerInMenuBar: false,
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

export async function loadDisplayPrefs(): Promise<DisplayPrefs> {
  const store = await getStore();
  const saved = await store.get<Partial<DisplayPrefs>>(DISPLAY_KEY);
  return { ...DEFAULT_DISPLAY_PREFS, ...(saved ?? {}) };
}

export async function saveDisplayPrefs(prefs: DisplayPrefs): Promise<void> {
  const store = await getStore();
  await store.set(DISPLAY_KEY, prefs);
  await store.save();
}
