import { load } from "@tauri-apps/plugin-store";
import type { UserSettings } from "../api/types";
import { DEFAULT_SETTINGS } from "../api/types";

const SETTINGS_STORE_FILE = "settings.json";
const SETTINGS_KEY = "userSettings";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(SETTINGS_STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadSettings(): Promise<UserSettings> {
  const store = await getStore();
  const saved = await store.get<UserSettings>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  const store = await getStore();
  await store.set(SETTINGS_KEY, settings);
  await store.save();
}
