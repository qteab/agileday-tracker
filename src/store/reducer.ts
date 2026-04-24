import type { Employee, Project, Task, TimeEntry } from "../api/types";

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
  tasks: Task[];
  entries: TimeEntry[];
  timer: TimerState;
  loading: boolean;
  error: string | null;
}

export const initialState: AppState = {
  employee: null,
  projects: [],
  tasks: [],
  entries: [],
  timer: {
    isRunning: false,
    description: "",
    projectId: null,
    taskId: null,
    startTime: null,
  },
  loading: false,
  error: null,
};

export type AppAction =
  | { type: "SET_EMPLOYEE"; payload: Employee }
  | { type: "SET_PROJECTS"; payload: Project[] }
  | { type: "SET_TASKS"; payload: Task[] }
  | { type: "SET_ENTRIES"; payload: TimeEntry[] }
  | { type: "ADD_ENTRY"; payload: TimeEntry }
  | { type: "UPDATE_ENTRY"; payload: { id: string; updates: Partial<TimeEntry> } }
  | { type: "DELETE_ENTRY"; payload: string }
  | { type: "SET_TIMER"; payload: Partial<TimerState> }
  | { type: "RESET_TIMER" }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_EMPLOYEE":
      return { ...state, employee: action.payload };
    case "SET_PROJECTS":
      return { ...state, projects: action.payload };
    case "SET_TASKS":
      return { ...state, tasks: action.payload };
    case "SET_ENTRIES":
      return { ...state, entries: action.payload };
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
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    default:
      return state;
  }
}
