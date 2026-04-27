import { load } from "@tauri-apps/plugin-store";
import { createMockProvider, MOCK_EMPLOYEE, MOCK_PROJECTS, MOCK_TASKS } from "./mock-core";
import type { TimeEntry } from "./types";

async function getStore() {
  return await load("mock-data.json", { autoSave: true, defaults: {} });
}

async function getEntries(): Promise<TimeEntry[]> {
  const store = await getStore();
  return (await store.get<TimeEntry[]>("timeEntries")) ?? [];
}

async function setEntries(entries: TimeEntry[]): Promise<void> {
  const store = await getStore();
  await store.set("timeEntries", entries);
}

export const mockProvider = createMockProvider(
  { getEntries, setEntries },
  MOCK_PROJECTS,
  MOCK_TASKS,
  MOCK_EMPLOYEE
);
