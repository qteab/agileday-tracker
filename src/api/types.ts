export type ProjectType = "INTERNAL" | "EXTERNAL" | "ABSENCE" | "IDLE";

export interface Project {
  id: string;
  name: string;
  customerName?: string;
  color: string;
  projectType?: ProjectType;
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
  projectType?: ProjectType;
  openingId?: string;
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

export interface AllocationPeriod {
  /** Allocation percentage (0-100) for this period */
  percentage: number;
  startDate: string;
}

export interface Allocation {
  projectId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  /** Overall allocation percentage */
  percentage: number;
  /** Total hours for this opening */
  hours: number;
  /** Allocation mode: "allocation" (percentage) or "hours" */
  allocationMode: string;
  /** Allocation periods with changing percentages */
  periods: AllocationPeriod[];
}
