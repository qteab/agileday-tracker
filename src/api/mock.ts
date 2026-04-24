import { load } from "@tauri-apps/plugin-store";
import type { ApiProvider } from "./provider";
import type { Employee, Project, Task, TimeEntry } from "./types";

const STORE_FILE = "mock-data.json";

const MOCK_PROJECTS: Project[] = [
  { id: "p1", name: "Fokus", customerName: "QTE", color: "#E5B80B" },
  { id: "p2", name: "DHL - PIL", customerName: "DHL", color: "#AEA7FF" },
  { id: "p3", name: "maverick", customerName: "Maverick", color: "#D946EF" },
  { id: "p4", name: "KBV", customerName: "KBV", color: "#374151" },
  { id: "p5", name: "QTE - möten", customerName: "QTE", color: "#7A59FC" },
];

const MOCK_TASKS: Record<string, Task[]> = {
  p1: [
    { id: "t1", projectId: "p1", name: "Development", billable: true, active: true },
    { id: "t2", projectId: "p1", name: "Design", billable: true, active: true },
    { id: "t3", projectId: "p1", name: "Meetings", billable: false, active: true },
  ],
  p2: [
    { id: "t4", projectId: "p2", name: "Fältbeskrivningar", billable: true, active: true },
    { id: "t5", projectId: "p2", name: "Integration", billable: true, active: true },
  ],
  p3: [
    { id: "t6", projectId: "p3", name: "Development", billable: true, active: true },
    { id: "t7", projectId: "p3", name: "Planning", billable: false, active: true },
  ],
  p4: [
    { id: "t8", projectId: "p4", name: "Operations", billable: true, active: true },
  ],
  p5: [
    { id: "t9", projectId: "p5", name: "Internal", billable: false, active: true },
  ],
};

const MOCK_EMPLOYEE: Employee = {
  id: "emp1",
  name: "Test User",
  email: "test@qte.se",
};

async function getStore() {
  return await load(STORE_FILE, { autoSave: true, defaults: {} });
}

async function getEntries(): Promise<TimeEntry[]> {
  const store = await getStore();
  return (await store.get<TimeEntry[]>("timeEntries")) ?? [];
}

async function setEntries(entries: TimeEntry[]): Promise<void> {
  const store = await getStore();
  await store.set("timeEntries", entries);
}

export const mockProvider: ApiProvider = {
  async getCurrentEmployee() {
    return MOCK_EMPLOYEE;
  },

  async getProjects() {
    return MOCK_PROJECTS;
  },

  async getTasks(projectId: string) {
    return MOCK_TASKS[projectId] ?? [];
  },

  async getTimeEntries(_employeeId: string, startDate: string, endDate: string) {
    const entries = await getEntries();
    return entries.filter((e) => e.date >= startDate && e.date <= endDate);
  },

  async createTimeEntry(_employeeId: string, entry) {
    const entries = await getEntries();
    const newEntry: TimeEntry = {
      ...entry,
      id: crypto.randomUUID(),
      syncStatus: "synced",
    };
    entries.push(newEntry);
    await setEntries(entries);
    return newEntry;
  },

  async updateTimeEntry(_employeeId: string, id: string, updates) {
    const entries = await getEntries();
    const index = entries.findIndex((e) => e.id === id);
    if (index === -1) throw new Error(`Entry ${id} not found`);
    entries[index] = { ...entries[index], ...updates };
    await setEntries(entries);
    return entries[index];
  },

  async deleteTimeEntry(ids: string[]) {
    const entries = await getEntries();
    await setEntries(entries.filter((e) => !ids.includes(e.id)));
  },
};
