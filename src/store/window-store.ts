import { load } from "@tauri-apps/plugin-store";

export interface WindowLayout {
  docked: boolean;
  freeX?: number;
  freeY?: number;
}

export const DEFAULT_LAYOUT: WindowLayout = { docked: false };

const WINDOW_STORE_FILE = "window.json";
const WINDOW_KEY = "layout";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(WINDOW_STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadWindowLayout(): Promise<WindowLayout> {
  const store = await getStore();
  const saved = await store.get<Partial<WindowLayout>>(WINDOW_KEY);
  return { ...DEFAULT_LAYOUT, ...(saved ?? {}) };
}

export async function saveWindowLayout(layout: WindowLayout): Promise<void> {
  const store = await getStore();
  await store.set(WINDOW_KEY, layout);
  await store.save();
}
