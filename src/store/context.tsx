import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createAgileDayProvider } from "../api/agileday";
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
import {
  ClickUpRateLimitError,
  createClickUpClient,
  loadClickUp,
  saveClickUp,
  type ClickUpAccount,
  type ClickUpClient,
  type ClickUpStored,
} from "../api/clickup";
import type { ApiProvider, MyProjectInfo } from "../api/provider";
import type { Project, TimeEntry } from "../api/types";
import { addDays } from "../utils/date-range";
import { applyTheme, watchSystemTheme } from "../utils/theme";
import { loadDisplayPrefs } from "./display-store";
import type { ThemeMode } from "./display-store";
import { loadFlexConfig } from "./flex-store";
import { appReducer, initialState, type AppState, type AppAction } from "./reducer";
import { loadTimerState, saveTimerState, clearTimerState } from "./timer-store";
import { loadUnsavedEntries, saveUnsavedEntries } from "./unsaved-store";
import { loadVacationConfig } from "./vacation-store";
import { loadWindowLayout, saveWindowLayout, type WindowLayout } from "./window-store";

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  api: ApiProvider | null;
  isConnected: boolean;
  isAuthLoading: boolean;
  logout: () => Promise<void>;
  onLogin: (auth: AuthState) => void;
  /** Re-run the full data load (entries, flex entries, holidays). */
  resync: () => void;
  /** ClickUp API client; null when ClickUp isn't connected. */
  clickupClient: ClickUpClient | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [api, setApi] = useState<ApiProvider | null>(null);
  const isConnected = api !== null;
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [syncCounter, setSyncCounter] = useState(0);
  const [timerLoaded, setTimerLoaded] = useState(false);
  const [unsavedLoaded, setUnsavedLoaded] = useState(false);
  const authStateRef = useRef<AuthState | null>(null);

  useLayoutEffect(() => {
    authStateRef.current = authState;
  });

  // The client is built on connect rather than during render: it reads the
  // live auth state through authStateRef on every request.
  const setIsConnected = useCallback((connected: boolean) => {
    setApi((current) => {
      if (!connected) return null;
      return (
        current ??
        createAgileDayProvider(
          {
            apiBaseUrl: buildApiBaseUrl(DEFAULT_CONNECTION),
            authConfig: buildAuthConfig(DEFAULT_CONNECTION),
          },
          () => authStateRef.current,
          (newState: AuthState) => {
            setAuthState(newState);
            saveAuthState(newState).catch(() => {});
          },
          () => {
            setAuthState(null);
            setApi(null);
            dispatch({ type: "SET_ERROR", payload: "Session expired — please sign in again" });
            clearAuth().catch(() => {});
          }
        )
      );
    });
  }, []);

  function onLogin(auth: AuthState) {
    dispatch({ type: "SET_ERROR", payload: null });
    setAuthState(auth);
    setIsConnected(true);
  }

  async function logout() {
    await clearAuth().catch(() => {});
    setAuthState(null);
    setIsConnected(false);
    dispatch({ type: "CLEAR_ENTRIES" });
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
  useUnsavedRestore(dispatch, setUnsavedLoaded);
  useUnsavedPersistence(state.entries, unsavedLoaded);
  useTrayDisplayPush(state);
  useAuthBootstrap(setAuthState, setIsConnected, setIsAuthLoading);
  useBackgroundTokenRefresh(isConnected, authState?.refreshToken, authStateRef, setAuthState);
  useConnectedDataLoad(api, isConnected, syncCounter, dispatch);

  const clickupAccounts = state.clickup?.config.accounts;
  const clickupClient = useMemo(
    () => (clickupAccounts?.length ? createClickUpClient(clickupAccounts) : null),
    [clickupAccounts]
  );
  useClickUpPersistence(state.clickup, dispatch);
  useClickUpDataLoad(clickupAccounts, isConnected, syncCounter, dispatch);

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
        api,
        isConnected,
        isAuthLoading,
        logout,
        onLogin,
        resync: () => {
          setSyncCounter((n) => n + 1);
        },
        clickupClient,
      }}
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

// Color for absence projectlikes surfaced from openings (the /v2/opening
// fallback) — these don't come with a color the way /v1/absence entries do.
const ABSENCE_FALLBACK_COLOR = "#10B981";

// Build the full project list the picker draws from, combining three sources:
//   1. Regular projects (/v1/project), enriched with allocation projectType.
//   2. Absence projects (/v1/absence) — a separate AgileDay entity.
//   3. Fallback: ABSENCE-typed projectlikes we're allocated to (/v2/opening),
//      for tenants where /v1/absence is not authorized for the user's token.
// Deduped by id; a regular project that shares an id is never clobbered.
function mergeProjectSources(
  projects: Project[],
  absenceProjects: Project[],
  myProjects: MyProjectInfo[]
): Project[] {
  const typeById = new Map(myProjects.map((project) => [project.id, project.projectType]));
  const byId = new Map<string, Project>();

  for (const project of projects) {
    const projectType = typeById.get(project.id);
    byId.set(project.id, projectType ? { ...project, projectType } : project);
  }

  for (const absence of absenceProjects) {
    if (!byId.has(absence.id)) byId.set(absence.id, absence);
  }

  for (const mp of myProjects) {
    if (mp.projectType === "ABSENCE" && !byId.has(mp.id)) {
      byId.set(mp.id, {
        id: mp.id,
        name: mp.name ?? "Absence",
        color: ABSENCE_FALLBACK_COLOR,
        projectType: "ABSENCE",
      });
    }
  }

  return [...byId.values()];
}

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
      unlisten
        .then((fn) => {
          fn();
        })
        .catch(() => {});
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
    const onVisibilityChange = () => {
      void handleVisibility();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authStateRef, setAuthState]);
}

function useDisplayPrefsBootstrap(dispatch: React.Dispatch<AppAction>) {
  useEffect(() => {
    loadDisplayPrefs()
      .then((prefs) => {
        dispatch({ type: "SET_DISPLAY_PREFS", payload: prefs });
      })
      .catch(() => {});
  }, [dispatch]);
}

// Apply the chosen theme to the document, and while "system" is selected keep
// it in sync with live macOS appearance changes.
function useThemeSync(mode: ThemeMode) {
  useEffect(() => {
    applyTheme(mode);
    if (mode !== "system") return;
    return watchSystemTheme(() => {
      applyTheme("system");
    });
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
    const handles: { debounce?: ReturnType<typeof setTimeout>; unlisten?: () => void } = {};

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
      handles.unlisten = await window.onMoved(() => {
        clearTimeout(handles.debounce);
        handles.debounce = setTimeout(() => classifyAndPersist(window), MOVE_DEBOUNCE_MS);
      });
    }

    init().catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(handles.debounce);
      handles.unlisten?.();
    };
  }, []);
}

// Load the ClickUp connection once, then write every change back. Writing
// waits for the load so the initial null never wipes the stored token.
function useClickUpPersistence(clickup: ClickUpStored | null, dispatch: React.Dispatch<AppAction>) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    loadClickUp()
      .then((stored) => {
        dispatch({ type: "SET_CLICKUP", payload: stored });
      })
      .catch(() => {})
      .finally(() => {
        setLoaded(true);
      });
  }, [dispatch]);
  useEffect(() => {
    if (loaded) saveClickUp(clickup).catch(() => {});
  }, [loaded, clickup]);
}

// The user's ClickUp time in every workspace of every connected account, for
// the same 30-day window as the entry list, plus any timer running in ClickUp.
// Each account's workspaces are re-read every sync so newly joined ones show
// up. If nothing loads, entries stay null and ClickUp lines show as plain
// descriptions.
function useClickUpDataLoad(
  accounts: ClickUpAccount[] | undefined,
  isConnected: boolean,
  syncCounter: number,
  dispatch: React.Dispatch<AppAction>
) {
  // Bumped to reload once a rate limit has passed.
  const [retry, setRetry] = useState(0);
  // Keyed on tokens only, so a refreshed workspace list doesn't trigger another
  // load; the effect reads the latest list through the ref.
  const tokenKey = accounts?.map((a) => a.token).join(",");
  const accountsRef = useRef(accounts);
  useLayoutEffect(() => {
    accountsRef.current = accounts;
  });
  useEffect(() => {
    const accounts = accountsRef.current;
    if (!accounts?.length || !isConnected) {
      dispatch({ type: "SET_CLICKUP_ENTRIES", payload: null });
      dispatch({ type: "SET_CLICKUP_RUNNING", payload: null });
      return;
    }
    // Fields, not `let`s: the async load below writes them after the effect returns.
    const run: { cancelled: boolean; retryTimer?: ReturnType<typeof setTimeout> } = {
      cancelled: false,
    };
    // A function so TS doesn't keep `run.cancelled` narrowed to false across awaits.
    const isCancelled = (): boolean => run.cancelled;
    const now = Date.now();
    const reasonOf = (err: unknown) => (err instanceof Error ? err.message : "Unknown error");
    (async () => {
      // Refresh each account's workspaces; keep the stored list if that fails.
      const refreshed = await Promise.allSettled(
        accounts.map((a) => createClickUpClient([]).getAccount(a.token))
      );
      if (isCancelled()) return;
      const fresh = accounts.map((a, i) => {
        const r = refreshed[i];
        return r?.status === "fulfilled" ? r.value : a;
      });
      for (const r of refreshed)
        if (r.status === "fulfilled") dispatch({ type: "SET_CLICKUP_ACCOUNT", payload: r.value });
      const client = createClickUpClient(fresh);
      const teams = fresh.flatMap((a) => a.teams);
      const results = await Promise.allSettled(
        teams.map((t) =>
          Promise.all([
            client.getTimeEntries(t.id, now - 31 * 86_400_000, now),
            client.getRunning(t.id),
          ])
        )
      );
      if (isCancelled()) return;
      const loaded = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (loaded.length > 0) {
        dispatch({ type: "SET_CLICKUP_ENTRIES", payload: loaded.flatMap(([entries]) => entries) });
        dispatch({
          type: "SET_CLICKUP_RUNNING",
          payload: loaded.find(([, running]) => running)?.[1] ?? null,
        });
      }

      const errors = [...refreshed, ...results].flatMap((r) =>
        r.status === "rejected" ? [r.reason as unknown] : []
      );
      if (errors.length === 0) return;
      const limited = errors.filter(
        (e): e is ClickUpRateLimitError => e instanceof ClickUpRateLimitError
      );
      if (limited.length > 0) {
        const at = Math.max(...limited.map((e) => e.retryAt));
        run.retryTimer = setTimeout(() => {
          setRetry((n) => n + 1);
        }, at - Date.now());
        dispatch({
          type: "SET_ERROR",
          payload: `ClickUp is rate limiting requests — reloading ClickUp time in ${Math.ceil((at - Date.now()) / 1000)}s.`,
        });
        return;
      }
      const failed = teams.filter((_, i) => results[i]?.status === "rejected");
      dispatch({
        type: "SET_ERROR",
        payload: `Couldn't load ClickUp time${failed.length ? ` from ${failed.map((t) => t.name).join(", ")}` : ""}: ${reasonOf(errors[0])}`,
      });
    })().catch((err: unknown) => {
      if (!isCancelled())
        dispatch({ type: "SET_ERROR", payload: `Couldn't load ClickUp time: ${reasonOf(err)}` });
    });
    return () => {
      run.cancelled = true;
      clearTimeout(run.retryTimer);
    };
  }, [tokenKey, isConnected, syncCounter, retry, dispatch]);
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
      .finally(() => {
        setLoaded(true);
      });
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

// Bring back entries whose save failed in a previous run.
function useUnsavedRestore(
  dispatch: React.Dispatch<AppAction>,
  setLoaded: (loaded: boolean) => void
) {
  useEffect(() => {
    loadUnsavedEntries()
      .then((saved) => {
        dispatch({ type: "RESTORE_UNSAVED", payload: saved });
      })
      .catch(() => {})
      .finally(() => {
        setLoaded(true);
      });
  }, [dispatch, setLoaded]);
}

// Mirror unsaved entries to disk. Waits for the restore so the initial empty
// list can't overwrite what a previous run saved.
function useUnsavedPersistence(entries: TimeEntry[], unsavedLoaded: boolean) {
  useEffect(() => {
    if (!unsavedLoaded) return;
    saveUnsavedEntries(entries.filter((e) => e.syncStatus === "unsaved")).catch(() => {});
  }, [unsavedLoaded, entries]);
}

// Tray contents have to keep updating while the Timer view is unmounted
// (Settings panel open, etc.), so the push lives in the always-mounted
// provider rather than the useTimer hook.
function useTrayDisplayPush(state: AppState) {
  // Derived inside the effect because "today" depends on the clock. The last
  // payload is remembered so Rust is only called when something changed.
  const lastPushedRef = useRef<string | null>(null);

  useEffect(() => {
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
    // Description lives on the entry, not the timer. Find the matching entry.
    const runningEntry = state.timer.isRunning
      ? state.entries.find(
          (e) =>
            e.projectId === state.timer.projectId &&
            (e.taskId ?? null) === (state.timer.taskId ?? null) &&
            e.date === todayDate
        )
      : null;
    const displayDescription = state.timer.isRunning
      ? (state.timer.clickupTask?.name ?? runningEntry?.description ?? null)
      : (lastEntryToday?.description ?? null);

    const displayProjectName =
      (displayProjectId &&
        state.projects.find((project) => project.id === displayProjectId)?.name) ||
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

    const startMillis =
      state.timer.isRunning && state.timer.startTime
        ? new Date(state.timer.startTime).getTime()
        : null;
    const payload = {
      running: state.timer.isRunning,
      startTimeMs: startMillis,
      projectName: displayProjectName,
      taskName: displayTaskName,
      description: displayDescription,
      dayBaseSeconds: todayBaseMinutes * 60,
      menuBarMode: state.displayPrefs.menuBarMode,
      showTrayIcon: state.displayPrefs.showTrayIcon,
      inactivityEnabled: state.displayPrefs.inactivityEnabled,
      inactivityMinutes: state.displayPrefs.inactivityMinutes,
    };
    const key = JSON.stringify(payload);
    if (key === lastPushedRef.current) return;
    lastPushedRef.current = key;
    invoke("set_timer_status", payload).catch(() => {});
  });
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
      unlisten
        .then((fn) => {
          fn();
        })
        .catch(() => {});
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
      .finally(() => {
        setIsAuthLoading(false);
      });
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

    return () => {
      clearInterval(interval);
    };
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
    // A function, not the variable: TS narrows `cancelled` to false after the
    // first check, so later checks would look always-false.
    const isCancelled = (): boolean => cancelled;

    async function init() {
      if (!api) return;
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      try {
        const employee = await api.getCurrentEmployee();
        if (isCancelled()) return;
        dispatch({ type: "SET_EMPLOYEE", payload: employee });

        const [projects, absenceProjects, myProjects] = await Promise.all([
          api.getProjects(),
          api.getAbsenceProjects(),
          api.getMyProjects(employee.id),
        ]);
        if (isCancelled()) return;
        const mergedProjects = mergeProjectSources(projects, absenceProjects, myProjects);
        dispatch({ type: "SET_PROJECTS", payload: mergedProjects });
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
        if (isCancelled()) return;
        dispatch({ type: "SET_ENTRIES", payload: entries });

        void loadAndApplyBalanceConfigs(api, employee.id, pastStr, isCancelled, dispatch);
        void hydrateTaskMetadataForEntries(api, entries, isCancelled, dispatch);
      } catch (err) {
        if (isCancelled()) return;
        const message = err instanceof Error ? err.message : "Failed to connect to AgileDay";
        dispatch({ type: "SET_ERROR", payload: message });
      } finally {
        if (!isCancelled()) dispatch({ type: "SET_LOADING", payload: false });
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [api, isConnected, syncCounter, dispatch]);
}

async function loadAndApplyBalanceConfigs(
  api: ApiProvider,
  employeeId: string,
  windowStartDate: string,
  isCancelled: () => boolean,
  dispatch: React.Dispatch<AppAction>
) {
  const [flexConfig, vacationConfig] = await Promise.all([
    loadFlexConfig().catch(() => null),
    loadVacationConfig().catch(() => null),
  ]);
  if (isCancelled()) return;
  if (flexConfig) dispatch({ type: "SET_FLEX_CONFIG", payload: flexConfig });
  if (vacationConfig) dispatch({ type: "SET_VACATION_CONFIG", payload: vacationConfig });
  if (!flexConfig && !vacationConfig) return;

  if (flexConfig) await fetchFlexHolidays(api, flexConfig.startDate, isCancelled, dispatch);

  // Fetch pre-window entries back to the earliest configured start date so
  // both the flex and vacation balances see their full history.
  const startDates = [flexConfig?.startDate, vacationConfig?.startDate].filter(
    (d): d is string => !!d
  );
  const earliestStart = startDates.sort()[0];
  if (earliestStart && earliestStart < windowStartDate) {
    try {
      // getTimeEntries' endDate is inclusive and the window already has its
      // first day, so stop the day before or that day is counted twice
      const flexEntries = await api.getTimeEntries(
        employeeId,
        earliestStart,
        addDays(windowStartDate, -1)
      );
      if (!isCancelled()) dispatch({ type: "SET_FLEX_ENTRIES", payload: flexEntries });
    } catch {
      // Balances will use available entries only
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
    projectIds.map((projectId) => api.getTasks(projectId).catch(() => null))
  );
  if (isCancelled()) return;
  const billable: Record<string, boolean> = {};
  const names: Record<string, string> = {};
  const projectBillable: Record<string, boolean> = {};
  projectIds.forEach((projectId, index) => {
    const tasks = taskLists[index];
    // A null list means the fetch failed — leave that project unresolved rather
    // than recording it as having no billable tasks.
    if (!tasks || tasks.length === 0) return;
    projectBillable[projectId] = tasks.some((task) => task.billable);
    for (const task of tasks) {
      billable[task.id] = task.billable;
      names[task.id] = task.name;
    }
  });
  dispatch({ type: "MERGE_TASK_BILLABLE", payload: billable });
  dispatch({ type: "MERGE_PROJECT_BILLABLE", payload: projectBillable });
  dispatch({ type: "MERGE_TASK_NAMES", payload: names });
}
