import type { Allocation, Employee, Holiday, Project, Task, TimeEntry } from "../api/types";
import type { FlexConfig } from "./flex-store";

export interface TimerState {
  isRunning: boolean;
  description: string;
  projectId: string | null;
  taskId: string | null;
  startTime: string | null; // ISO timestamp
}

export interface AppState {
  employee: Employee | null;
  projects: Project[];
  myProjectIds: string[];
  projectOpeningMap: Record<string, string>;
  tasks: Task[];
  /** Per-task billable flag, used to render billable indicators on entries. */
  taskBillableById: Record<string, boolean>;
  entries: TimeEntry[];
  allocations: Allocation[];
  allocationsFetchedAt: number | null;
  timer: TimerState;
  flexConfig: FlexConfig | null;
  flexEntries: TimeEntry[] | null;
  holidays: Holiday[];
  loading: boolean;
  error: string | null;
}

export const initialState: AppState = {
  employee: null,
  projects: [],
  myProjectIds: [],
  projectOpeningMap: {},
  tasks: [],
  taskBillableById: {},
  entries: [],
  allocations: [],
  allocationsFetchedAt: null,
  timer: {
    isRunning: false,
    description: "",
    projectId: null,
    taskId: null,
    startTime: null,
  },
  flexConfig: null,
  flexEntries: null,
  holidays: [],
  loading: false,
  error: null,
};

export type AppAction =
  | { type: "SET_EMPLOYEE"; payload: Employee }
  | { type: "SET_PROJECTS"; payload: Project[] }
  | { type: "SET_MY_PROJECT_IDS"; payload: string[] }
  | { type: "SET_PROJECT_OPENING_MAP"; payload: Record<string, string> }
  | { type: "SET_TASKS"; payload: Task[] }
  | { type: "MERGE_TASK_BILLABLE"; payload: Record<string, boolean> }
  | { type: "SET_ENTRIES"; payload: TimeEntry[] }
  | { type: "SET_ALLOCATIONS"; payload: { allocations: Allocation[]; fetchedAt: number } }
  | { type: "CLEAR_ALLOCATIONS" }
  | { type: "ADD_ENTRY"; payload: TimeEntry }
  | { type: "UPDATE_ENTRY"; payload: { id: string; updates: Partial<TimeEntry> } }
  | { type: "DELETE_ENTRY"; payload: string }
  | { type: "SET_TIMER"; payload: Partial<TimerState> }
  | { type: "RESET_TIMER" }
  | { type: "SET_FLEX_CONFIG"; payload: FlexConfig | null }
  | { type: "SET_FLEX_ENTRIES"; payload: TimeEntry[] | null }
  | { type: "SET_HOLIDAYS"; payload: Holiday[] }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_EMPLOYEE":
      return { ...state, employee: action.payload };
    case "SET_PROJECTS":
      return { ...state, projects: action.payload };
    case "SET_MY_PROJECT_IDS":
      return { ...state, myProjectIds: action.payload };
    case "SET_PROJECT_OPENING_MAP":
      return { ...state, projectOpeningMap: action.payload };
    case "SET_TASKS":
      return { ...state, tasks: action.payload };
    case "MERGE_TASK_BILLABLE":
      return {
        ...state,
        taskBillableById: { ...state.taskBillableById, ...action.payload },
      };
    case "SET_ENTRIES":
      return { ...state, entries: action.payload };
    case "SET_ALLOCATIONS":
      return {
        ...state,
        allocations: action.payload.allocations,
        allocationsFetchedAt: action.payload.fetchedAt,
      };
    case "CLEAR_ALLOCATIONS":
      return { ...state, allocations: [], allocationsFetchedAt: null };
    case "ADD_ENTRY":
      return { ...state, entries: [action.payload, ...state.entries] };
    case "UPDATE_ENTRY":
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.id === action.payload.id ? { ...e, ...action.payload.updates } : e
        ),
      };
    case "DELETE_ENTRY":
      return {
        ...state,
        entries: state.entries.filter((e) => e.id !== action.payload),
      };
    case "SET_TIMER":
      return { ...state, timer: { ...state.timer, ...action.payload } };
    case "RESET_TIMER":
      return { ...state, timer: initialState.timer };
    case "SET_FLEX_CONFIG":
      return { ...state, flexConfig: action.payload };
    case "SET_FLEX_ENTRIES":
      return { ...state, flexEntries: action.payload };
    case "SET_HOLIDAYS":
      return { ...state, holidays: action.payload };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    default:
      return state;
  }
}
