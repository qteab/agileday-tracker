import type { ApiProvider } from "./provider";
import type { Allocation, Employee, Project, Task, TimeEntry } from "./types";

export const MOCK_PROJECTS: Project[] = [
  { id: "p1", name: "Fokus", customerName: "QTE", color: "#E5B80B", projectType: "INTERNAL" },
  { id: "p2", name: "DHL - PIL", customerName: "DHL", color: "#AEA7FF", projectType: "EXTERNAL" },
  {
    id: "p3",
    name: "maverick",
    customerName: "Maverick",
    color: "#D946EF",
    projectType: "EXTERNAL",
  },
  { id: "p4", name: "KBV", customerName: "KBV", color: "#374151", projectType: "EXTERNAL" },
  { id: "p5", name: "QTE - möten", customerName: "QTE", color: "#7A59FC", projectType: "INTERNAL" },
];

export const MOCK_TASKS: Record<string, Task[]> = {
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
  p4: [{ id: "t8", projectId: "p4", name: "Operations", billable: true, active: true }],
  p5: [{ id: "t9", projectId: "p5", name: "Internal", billable: false, active: true }],
};

export const MOCK_EMPLOYEE: Employee = {
  id: "emp1",
  name: "Test User",
  email: "test@qte.se",
};

export interface EntryStore {
  getEntries(): Promise<TimeEntry[]>;
  setEntries(entries: TimeEntry[]): Promise<void>;
}

export const MOCK_ALLOCATIONS: Allocation[] = [
  {
    projectId: "p1",
    projectName: "Fokus",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    percentage: 50,
    hours: 400,
    allocationMode: "allocation",
    periods: [{ percentage: 50, startDate: "2026-04-01" }],
  },
  {
    projectId: "p2",
    projectName: "DHL - PIL",
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    percentage: 25,
    hours: 160,
    allocationMode: "allocation",
    periods: [{ percentage: 25, startDate: "2026-04-01" }],
  },
];

export function createMockProvider(
  store: EntryStore,
  projects: Project[],
  tasks: Record<string, Task[]>,
  employee: Employee,
  allocations: Allocation[] = MOCK_ALLOCATIONS
): ApiProvider {
  return {
    async getCurrentEmployee() {
      return employee;
    },

    async getProjects() {
      return projects;
    },

    async getTasks(projectId: string) {
      return tasks[projectId] ?? [];
    },

    async getTimeEntries(_employeeId: string, startDate: string, endDate: string) {
      const entries = await store.getEntries();
      return entries.filter((e) => e.date >= startDate && e.date <= endDate);
    },

    async createTimeEntry(_employeeId: string, entry) {
      const entries = await store.getEntries();
      const newEntry: TimeEntry = {
        ...entry,
        id: crypto.randomUUID(),
        syncStatus: "synced",
      };
      entries.push(newEntry);
      await store.setEntries(entries);
      return newEntry;
    },

    async updateTimeEntry(_employeeId: string, id: string, updates) {
      const entries = await store.getEntries();
      const index = entries.findIndex((e) => e.id === id);
      if (index === -1) throw new Error(`Entry ${id} not found`);
      entries[index] = { ...entries[index], ...updates };
      await store.setEntries(entries);
      return entries[index];
    },

    async deleteTimeEntry(ids: string[]) {
      const entries = await store.getEntries();
      await store.setEntries(entries.filter((e) => !ids.includes(e.id)));
    },

    async getAllocations(_employeeId: string) {
      return allocations;
    },

    async getMyProjects(_employeeId: string) {
      return projects.map((p) => ({
        id: p.id,
        projectType: p.projectType,
        openingId: `opening-${p.id}`,
      }));
    },
  };
}
