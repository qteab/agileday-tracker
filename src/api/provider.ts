import type { Allocation, Employee, Holiday, Project, ProjectType, Task, TimeEntry } from "./types";

export interface MyProjectInfo {
  id: string;
  /** Name from the opening (projectlikeName). Used to surface allocated
   *  projectlikes — e.g. absence — that /v1/project doesn't return. */
  name?: string;
  projectType?: ProjectType;
  openingId?: string;
}

export interface ApiProvider {
  getCurrentEmployee(): Promise<Employee>;
  getProjects(): Promise<Project[]>;
  /** Absence projects (vacation, sick leave, etc.) from the dedicated /v1/absence endpoint. */
  getAbsenceProjects(): Promise<Project[]>;
  getTasks(projectId: string): Promise<Task[]>;
  getTimeEntries(employeeId: string, startDate: string, endDate: string): Promise<TimeEntry[]>;
  createTimeEntry(
    employeeId: string,
    entry: Omit<TimeEntry, "id" | "syncStatus">
  ): Promise<TimeEntry>;
  updateTimeEntry(employeeId: string, id: string, updates: Partial<TimeEntry>): Promise<TimeEntry>;
  deleteTimeEntry(ids: string[]): Promise<void>;
  batchUpdateEntries(
    employeeId: string,
    updates: Array<{ id: string } & Partial<TimeEntry>>
  ): Promise<TimeEntry[]>;
  getAllocations(employeeId: string): Promise<Allocation[]>;
  getMyProjects(employeeId: string): Promise<MyProjectInfo[]>;
  getHolidays(countryCode: string, startDate: string, endDate: string): Promise<Holiday[]>;
}
