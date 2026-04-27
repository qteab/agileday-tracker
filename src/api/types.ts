export interface Project {
  id: string;
  name: string;
  customerName?: string;
  color: string;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  billable: boolean;
  active: boolean;
}

export type TimeEntryStatus = "NEW" | "SAVED" | "CHANGE_REQUESTED" | "SUBMITTED" | "APPROVED";

export type SyncStatus = "synced" | "unsaved" | "pending";

export interface TimeEntry {
  id: string;
  description: string;
  projectId: string;
  projectName?: string;
  taskId?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // ISO timestamp
  endTime?: string; // ISO timestamp (null = running)
  minutes: number;
  status: TimeEntryStatus;
  syncStatus: SyncStatus;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
}

export interface Allocation {
  projectId: string;
  projectName: string;
  /** Total allocated minutes for this period */
  allocatedMinutes: number;
  startDate: string;
  endDate: string;
}
