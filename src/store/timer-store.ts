import { load } from "@tauri-apps/plugin-store";
import type { TimerState } from "./reducer";

const TIMER_STORE_FILE = "timer.json";
const TIMER_KEY = "timerState";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(TIMER_STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadTimerState(): Promise<TimerState | null> {
  const store = await getStore();
  return (await store.get<TimerState>(TIMER_KEY)) ?? null;
}

export async function saveTimerState(state: TimerState): Promise<void> {
  const store = await getStore();
  await store.set(TIMER_KEY, state);
  await store.save();
}

export async function clearTimerState(): Promise<void> {
  const store = await getStore();
  await store.delete(TIMER_KEY);
  await store.save();
}
