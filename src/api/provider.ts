import type { Allocation, Employee, Holiday, Project, ProjectType, Task, TimeEntry } from "./types";

/** The two timecard statuses this app sets. */
export type TimecardStatus = "SUBMITTED" | "SAVED";

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
  /** `dates` lets auto-submit resolve which weeks the delete touched. */
  deleteTimeEntry(ids: string[], dates?: string[]): Promise<void>;
  batchUpdateEntries(
    employeeId: string,
    updates: Array<{ id: string } & Partial<TimeEntry>>
  ): Promise<TimeEntry[]>;
  /** Submit the timecard for one week of one month (weekStart = Monday, month = 1st). */
  submitTimesheet(employeeId: string, weekStart: string, month: string): Promise<void>;
  /** Move one week's timecard to an explicit status. Submitting is the common case. */
  setTimesheetStatus(
    employeeId: string,
    weekStart: string,
    month: string,
    status: TimecardStatus
  ): Promise<void>;
  getAllocations(employeeId: string): Promise<Allocation[]>;
  getMyProjects(employeeId: string): Promise<MyProjectInfo[]>;
  getHolidays(countryCode: string, startDate: string, endDate: string): Promise<Holiday[]>;
}
