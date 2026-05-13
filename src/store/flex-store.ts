import { load } from "@tauri-apps/plugin-store";

export interface FlexConfig {
  startDate: string; // YYYY-MM-DD — flex counting starts the day AFTER this
  initialHours: number; // flex balance as of startDate (can be negative)
}

const FLEX_STORE_FILE = "flex.json";
const FLEX_KEY = "flexConfig";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(FLEX_STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadFlexConfig(): Promise<FlexConfig | null> {
  const store = await getStore();
  return (await store.get<FlexConfig>(FLEX_KEY)) ?? null;
}

export async function saveFlexConfig(config: FlexConfig): Promise<void> {
  const store = await getStore();
  await store.set(FLEX_KEY, config);
  await store.save();
}

export async function clearFlexConfig(): Promise<void> {
  const store = await getStore();
  await store.delete(FLEX_KEY);
  await store.save();
}
