import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { appReducer, initialState, type AppState, type AppAction } from "./reducer";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ApiProvider } from "../api/provider";
import { createAgileDayProvider, type AgileDayConfig } from "../api/agileday";
import type { AuthState } from "../api/auth";
import { isTokenExpired, refreshAuthState } from "../api/auth";
import {
  loadAuthState,
  saveAuthState,
  clearAuth,
  buildAuthConfig,
  buildApiBaseUrl,
  DEFAULT_CONNECTION,
} from "../api/auth-manager";
import type { TimeEntry } from "../api/types";
import { loadTimerState, saveTimerState, clearTimerState } from "./timer-store";
import { loadFlexConfig } from "./flex-store";
import { loadDisplayPrefs } from "./display-store";
import { loadWindowLayout, saveWindowLayout, type WindowLayout } from "./window-store";
import { applyTheme, watchSystemTheme } from "../utils/theme";
import type { ThemeMode } from "./display-store";

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  api: ApiProvider | null;
  isConnected: boolean;
  isAuthLoading: boolean;
  logout: () => Promise<void>;
  onLogin: (auth: AuthState) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [syncCounter, setSyncCounter] = useState(0);
  const [timerLoaded, setTimerLoaded] = useState(false);
  const authStateRef = useRef<AuthState | null>(null);

  authStateRef.current = authState;

  const api = useMemo<ApiProvider | null>(() => {
    if (!isConnected) return null;
    return createAgileDayProvider(
      {
        apiBaseUrl: buildApiBaseUrl(DEFAULT_CONNECTION),
        authConfig: buildAuthConfig(DEFAULT_CONNECTION),
      } as AgileDayConfig,
      () => authStateRef.current,
      (newState: AuthState) => {
        setAuthState(newState);
        saveAuthState(newState).catch(() => {});
      },
      () => {
        setAuthState(null);
        setIsConnected(false);
        dispatch({ type: "SET_ERROR", payload: "Session expired — please sign in again" });
        clearAuth().catch(() => {});
      }
    );
  }, [isConnected]);

  function onLogin(auth: AuthState) {
    dispatch({ type: "SET_ERROR", payload: null });
    setAuthState(auth);
    setIsConnected(true);
  }

  async function logout() {
    await clearAuth().catch(() => {});
    setAuthState(null);
    setIsConnected(false);
    dispatch({ type: "SET_ENTRIES", payload: [] });
    dispatch({ type: "SET_PROJECTS", payload: [] });
    dispatch({ type: "CLEAR_ALLOCATIONS" });
    dispatch({ type: "SET_ERROR", payload: null });
    dispatch({ type: "SET_LOADING", payload: false });
  }

  useTrayMenuSyncTrigger(setSyncCounter);
  useVisibilityTokenRefresh(authStateRef, setAuthState);
  useDisplayPrefsBootstrap(dispatch);
  useThemeSync(state.displayPrefs.theme);
  useInactivitySync(dispatch);
  useWindowDockSnap();
  useTimerRestore(dispatch, setTimerLoaded);
  useTimerPersistence(state.timer, timerLoaded);
  useTrayDisplayPush(state);
  useAuthBootstrap(setAuthState, setIsConnected, setIsAuthLoading);
  useBackgroundTokenRefresh(isConnected, authState?.refreshToken, authStateRef, setAuthState);
  useConnectedDataLoad(api, isConnected, syncCounter, dispatch);

  return (
    <AppContext.Provider
      value={{ state, dispatch, api, isConnected, isAuthLoading, logout, onLogin }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function useApi(): ApiProvider {
  const { api } = useApp();
  if (!api) throw new Error("useApi called without authentication");
  return api;
}

// --- helpers ------------------------------------------------------------

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function findLatestEntryForDate(entries: readonly TimeEntry[], date: string): TimeEntry | null {
  return entries.reduce<TimeEntry | null>(
    (best, entry) =>
      entry.date === date && (best === null || entry.startTime > best.startTime) ? entry : best,
    null
  );
}

function sumMinutesForDayTask(
  entries: readonly TimeEntry[],
  projectId: string,
  taskId: string,
  date: string,
  excludeStartTime: string | null
): number {
  return entries
    .filter(
      (entry) =>
        entry.projectId === projectId &&
        entry.taskId === taskId &&
        entry.date === date &&
        entry.startTime !== excludeStartTime
    )
    .reduce((sum, entry) => sum + (entry.minutes || 0), 0);
}

function resolveTaskName(state: AppState, taskId: string | null): string | null {
  if (!taskId) return null;
  return (
    state.taskNamesById[taskId] ?? state.tasks.find((task) => task.id === taskId)?.name ?? null
  );
}

// --- hooks --------------------------------------------------------------

function useTrayMenuSyncTrigger(setSyncCounter: (updater: (n: number) => number) => void) {
  useEffect(() => {
    const unlisten = listen("sync-data", () => {
      setSyncCounter((n) => n + 1);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setSyncCounter]);
}

// setInterval doesn't fire during sleep, so we re-check the access token
// each time the window becomes visible again.
function useVisibilityTokenRefresh(
  authStateRef: React.RefObject<AuthState | null>,
  setAuthState: (auth: AuthState) => void
) {
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      const current = authStateRef.current;
      if (!current?.refreshToken) return;
      if (!isTokenExpired(current, 60_000)) return;
      try {
        const authConfig = buildAuthConfig(DEFAULT_CONNECTION);
        const newState = await refreshAuthState(authConfig, current);
        setAuthState(newState);
        await saveAuthState(newState).catch(() => {});
      } catch {
        // Refresh failed — let the next API call surface it
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [authStateRef, setAuthState]);
}

function useDisplayPrefsBootstrap(dispatch: React.Dispatch<AppAction>) {
  useEffect(() => {
    loadDisplayPrefs()
      .then((prefs) => dispatch({ type: "SET_DISPLAY_PREFS", payload: prefs }))
      .catch(() => {});
  }, [dispatch]);
}

// Apply the chosen theme to the document, and while "system" is selected keep
// it in sync with live macOS appearance changes.
function useThemeSync(mode: ThemeMode) {
  useEffect(() => {
    applyTheme(mode);
    if (mode !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [mode]);
}

// Persist where the user drags the window. Dropping it near the top edge
// counts as docking; on the next open Rust positions the window centered
// under the tray icon. Anywhere else stores the absolute position so the
// window comes back to where the user left it.
function useWindowDockSnap() {
  useEffect(() => {
    const SNAP_THRESHOLD_LOGICAL_PIXELS = 40;
    const MOVE_DEBOUNCE_MS = 250;
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | null = null;

    async function pushLayoutToRust(layout: WindowLayout) {
      await invoke("set_window_layout", {
        docked: layout.docked,
        freeX: layout.freeX ?? null,
        freeY: layout.freeY ?? null,
      }).catch(() => {});
    }

    async function classifyAndPersist(window: ReturnType<typeof getCurrentWindow>) {
      const position = await window.outerPosition().catch(() => null);
      if (!position) return;
      const scaleFactor = await window.scaleFactor().catch(() => 1);
      const topInLogicalPixels = position.y / scaleFactor;
      const docked = topInLogicalPixels < SNAP_THRESHOLD_LOGICAL_PIXELS;
      const next: WindowLayout = docked
        ? { docked: true }
        : { docked: false, freeX: position.x, freeY: position.y };
      await saveWindowLayout(next).catch(() => {});
      await pushLayoutToRust(next);
      if (docked) {
        await invoke("snap_window_to_tray").catch(() => {});
      }
    }

    async function init() {
      const layout = await loadWindowLayout().catch(() => null);
      if (cancelled || !layout) return;
      await pushLayoutToRust(layout);

      const window = getCurrentWindow();
      unlisten = await window.onMoved(() => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => classifyAndPersist(window), MOVE_DEBOUNCE_MS);
      });
    }

    init();
    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      unlisten?.();
    };
  }, []);
}

// Restore a running timer that survived a quit/crash. Elapsed is derived
// from startTime + now(), so time the app was closed is naturally counted.
function useTimerRestore(
  dispatch: React.Dispatch<AppAction>,
  setLoaded: (loaded: boolean) => void
) {
  useEffect(() => {
    loadTimerState()
      .then((saved) => {
        if (saved?.isRunning && saved.startTime) {
          dispatch({ type: "SET_TIMER", payload: saved });
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [dispatch, setLoaded]);
}

// Wait for the initial restore before writing — otherwise the default empty
// timer would overwrite a saved running timer on first render.
function useTimerPersistence(timer: AppState["timer"], timerLoaded: boolean) {
  useEffect(() => {
    if (!timerLoaded) return;
    if (timer.isRunning) {
      saveTimerState(timer).catch(() => {});
    } else {
      clearTimerState().catch(() => {});
    }
  }, [timerLoaded, timer]);
}

// Tray contents have to keep updating while the Timer view is unmounted
// (Settings panel open, etc.), so the push lives in the always-mounted
// provider rather than the useTimer hook.
function useTrayDisplayPush(state: AppState) {
  const todayDate = formatLocalDate(new Date());

  // When paused, fall back to the most recent entry from today so the menu
  // bar keeps showing the last task and ▶ has a sensible target to resume.
  const lastEntryToday = !state.timer.isRunning
    ? findLatestEntryForDate(state.entries, todayDate)
    : null;

  const displayProjectId = state.timer.isRunning
    ? state.timer.projectId
    : (lastEntryToday?.projectId ?? null);
  const displayTaskId = state.timer.isRunning
    ? state.timer.taskId
    : (lastEntryToday?.taskId ?? null);
  const displayDescription = state.timer.isRunning
    ? state.timer.description
    : (lastEntryToday?.description ?? null);

  const displayProjectName =
    (displayProjectId && state.projects.find((project) => project.id === displayProjectId)?.name) ||
    null;
  const displayTaskName = resolveTaskName(state, displayTaskId);

  // While running we exclude the current session — Rust adds the elapsed
  // seconds on each tick. While paused the just-stopped session is already
  // in entries, so a plain sum gives the correct day total.
  const todayBaseMinutes =
    displayProjectId && displayTaskId
      ? sumMinutesForDayTask(
          state.entries,
          displayProjectId,
          displayTaskId,
          todayDate,
          state.timer.startTime
        )
      : 0;

  useEffect(() => {
    const startMillis =
      state.timer.isRunning && state.timer.startTime
        ? new Date(state.timer.startTime).getTime()
        : null;
    invoke("set_timer_status", {
      running: state.timer.isRunning,
      startTimeMs: startMillis,
      projectName: displayProjectName,
      taskName: displayTaskName,
      description: displayDescription,
      dayBaseSeconds: todayBaseMinutes * 60,
      menuBarMode: state.displayPrefs.menuBarMode,
      inactivityEnabled: state.displayPrefs.inactivityEnabled,
      inactivityMinutes: state.displayPrefs.inactivityMinutes,
    }).catch(() => {});
  }, [
    state.timer.isRunning,
    state.timer.startTime,
    displayProjectName,
    displayTaskName,
    displayDescription,
    todayBaseMinutes,
    state.displayPrefs.menuBarMode,
    state.displayPrefs.inactivityEnabled,
    state.displayPrefs.inactivityMinutes,
  ]);
}

// Rust owns idle detection (system-wide, survives the WebView being hidden) and
// emits an `inactivity` event whenever the away state or idle minute changes.
function useInactivitySync(dispatch: React.Dispatch<AppAction>) {
  useEffect(() => {
    const unlisten = listen<{ idle_seconds: number; is_away: boolean }>("inactivity", (event) => {
      dispatch({
        type: "SET_INACTIVITY",
        payload: { idleSeconds: event.payload.idle_seconds, isAway: event.payload.is_away },
      });
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [dispatch]);
}

function useAuthBootstrap(
  setAuthState: (auth: AuthState | null) => void,
  setIsConnected: (connected: boolean) => void,
  setIsAuthLoading: (loading: boolean) => void
) {
  useEffect(() => {
    loadAuthState()
      .then(async (saved) => {
        if (!saved) return;
        if (saved.expiresAt > Date.now()) {
          setAuthState(saved);
          setIsConnected(true);
          return;
        }
        if (!saved.refreshToken) {
          await clearAuth().catch(() => {});
          return;
        }
        try {
          const authConfig = buildAuthConfig(DEFAULT_CONNECTION);
          const newState = await refreshAuthState(authConfig, saved);
          await saveAuthState(newState).catch(() => {});
          setAuthState(newState);
          setIsConnected(true);
        } catch {
          await clearAuth().catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setIsAuthLoading(false));
  }, [setAuthState, setIsConnected, setIsAuthLoading]);
}

function useBackgroundTokenRefresh(
  isConnected: boolean,
  refreshToken: string | undefined,
  authStateRef: React.RefObject<AuthState | null>,
  setAuthState: (auth: AuthState) => void
) {
  useEffect(() => {
    if (!isConnected || !refreshToken) return;
    const REFRESH_CHECK_INTERVAL_MS = 30_000;
    const REFRESH_BUFFER_MS = 60_000;

    const interval = setInterval(async () => {
      const current = authStateRef.current;
      if (!current?.refreshToken) return;
      if (!isTokenExpired(current, REFRESH_BUFFER_MS)) return;
      try {
        const authConfig = buildAuthConfig(DEFAULT_CONNECTION);
        const newState = await refreshAuthState(authConfig, current);
        setAuthState(newState);
        await saveAuthState(newState).catch(() => {});
      } catch {
        // Token will expire and the user will see a session-expired error
        // on the next API call — don't clear auth here.
      }
    }, REFRESH_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isConnected, refreshToken, authStateRef, setAuthState]);
}

function useConnectedDataLoad(
  api: ApiProvider | null,
  isConnected: boolean,
  syncCounter: number,
  dispatch: React.Dispatch<AppAction>
) {
  useEffect(() => {
    if (!api || !isConnected) return;
    let cancelled = false;

    async function init() {
      if (!api) return;
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      try {
        const employee = await api.getCurrentEmployee();
        if (cancelled) return;
        dispatch({ type: "SET_EMPLOYEE", payload: employee });

        const [projects, myProjects] = await Promise.all([
          api.getProjects(),
          api.getMyProjects(employee.id),
        ]);
        if (cancelled) return;
        const typeById = new Map(myProjects.map((project) => [project.id, project.projectType]));
        const enrichedProjects = projects.map((project) =>
          typeById.has(project.id) ? { ...project, projectType: typeById.get(project.id) } : project
        );
        dispatch({ type: "SET_PROJECTS", payload: enrichedProjects });
        dispatch({ type: "SET_MY_PROJECT_IDS", payload: myProjects.map((project) => project.id) });
        const openingMap: Record<string, string> = {};
        for (const project of myProjects) {
          if (project.openingId) openingMap[project.id] = project.openingId;
        }
        dispatch({ type: "SET_PROJECT_OPENING_MAP", payload: openingMap });

        // Window extends 30 days ahead so future-logged entries (e.g. vacation)
        // show up in the allocation view's weekly/monthly totals.
        const now = new Date();
        const past = new Date(now);
        past.setDate(past.getDate() - 30);
        const future = new Date(now);
        future.setDate(future.getDate() + 30);
        const pastStr = formatLocalDate(past);
        const futureStr = formatLocalDate(future);
        const entries = await api.getTimeEntries(employee.id, pastStr, futureStr);
        if (cancelled) return;
        dispatch({ type: "SET_ENTRIES", payload: entries });

        loadAndApplyFlexConfig(api, employee.id, pastStr, () => cancelled, dispatch);
        hydrateTaskMetadataForEntries(api, entries, () => cancelled, dispatch);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to connect to AgileDay";
        dispatch({ type: "SET_ERROR", payload: message });
      } finally {
        if (!cancelled) dispatch({ type: "SET_LOADING", payload: false });
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [api, isConnected, syncCounter, dispatch]);
}

async function loadAndApplyFlexConfig(
  api: ApiProvider,
  employeeId: string,
  windowStartDate: string,
  isCancelled: () => boolean,
  dispatch: React.Dispatch<AppAction>
) {
  const flexConfig = await loadFlexConfig().catch(() => null);
  if (isCancelled() || !flexConfig) return;
  dispatch({ type: "SET_FLEX_CONFIG", payload: flexConfig });

  await fetchFlexHolidays(api, flexConfig.startDate, isCancelled, dispatch);

  if (flexConfig.startDate < windowStartDate) {
    try {
      const flexEntries = await api.getTimeEntries(
        employeeId,
        flexConfig.startDate,
        windowStartDate
      );
      if (!isCancelled()) dispatch({ type: "SET_FLEX_ENTRIES", payload: flexEntries });
    } catch {
      // Flex will use available entries only
    }
  }
}

async function fetchFlexHolidays(
  api: ApiProvider,
  flexStartDate: string,
  isCancelled: () => boolean,
  dispatch: React.Dispatch<AppAction>
) {
  const startYear = new Date(flexStartDate + "T12:00:00").getFullYear();
  const currentYear = new Date().getFullYear();
  try {
    const allHolidays = [];
    for (let year = startYear; year <= currentYear; year++) {
      const yearHolidays = await api.getHolidays("SE", `${year}-01-01`, `${year + 1}-01-01`);
      allHolidays.push(...yearHolidays);
    }
    if (!isCancelled()) dispatch({ type: "SET_HOLIDAYS", payload: allHolidays });
  } catch {
    // Flex will calculate without holidays
  }
}

// Per-task billable + name caches so the UI can render entries with the right
// labels even before any picker has loaded that project's task list.
async function hydrateTaskMetadataForEntries(
  api: ApiProvider,
  entries: readonly TimeEntry[],
  isCancelled: () => boolean,
  dispatch: React.Dispatch<AppAction>
) {
  const projectIds = [...new Set(entries.map((entry) => entry.projectId))];
  const taskLists = await Promise.all(
    projectIds.map((projectId) => api.getTasks(projectId).catch(() => []))
  );
  if (isCancelled()) return;
  const billable: Record<string, boolean> = {};
  const names: Record<string, string> = {};
  for (const tasks of taskLists) {
    for (const task of tasks) {
      billable[task.id] = task.billable;
      names[task.id] = task.name;
    }
  }
  dispatch({ type: "MERGE_TASK_BILLABLE", payload: billable });
  dispatch({ type: "MERGE_TASK_NAMES", payload: names });
}
