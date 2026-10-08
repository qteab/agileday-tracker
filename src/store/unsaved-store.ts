import { load } from "@tauri-apps/plugin-store";
import type { TimeEntry } from "../api/types";

// Entries whose save to AgileDay failed. Kept on disk so a sync or restart
// doesn't drop logged time before the user retries it.
const UNSAVED_STORE_FILE = "unsaved.json";
const UNSAVED_KEY = "entries";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(UNSAVED_STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadUnsavedEntries(): Promise<TimeEntry[]> {
  const store = await getStore();
  return (await store.get<TimeEntry[]>(UNSAVED_KEY)) ?? [];
}

export async function saveUnsavedEntries(entries: TimeEntry[]): Promise<void> {
  const store = await getStore();
  await store.set(UNSAVED_KEY, entries);
  await store.save();
}

/**
 * Lay unsaved local entries over freshly fetched ones. The local copy wins for
 * the same id (the app is the source of truth when saving); local-only entries
 * are added.
 */
export function mergeUnsaved(fetched: TimeEntry[], unsaved: TimeEntry[]): TimeEntry[] {
  const byId = new Map(unsaved.map((e) => [e.id, e]));
  const merged = fetched.map((e) => byId.get(e.id) ?? e);
  const fetchedIds = new Set(fetched.map((e) => e.id));
  return [...unsaved.filter((e) => !fetchedIds.has(e.id)), ...merged];
}
