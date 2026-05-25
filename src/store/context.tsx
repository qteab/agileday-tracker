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
import { loadTimerState, saveTimerState, clearTimerState } from "./timer-store";
import { loadFlexConfig } from "./flex-store";
import { loadDisplayPrefs } from "./display-store";
import { loadWindowLayout, saveWindowLayout, type WindowLayout } from "./window-store";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
        saveAuthState(newState).catch(() => {
          // Store save failed — token is in memory but won't persist across restarts
        });
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
    try {
      await clearAuth();
    } catch {
      // Best effort — clear local state regardless
    }
    setAuthState(null);
    setIsConnected(false);
    dispatch({ type: "SET_ENTRIES", payload: [] });
    dispatch({ type: "SET_PROJECTS", payload: [] });
    dispatch({ type: "CLEAR_ALLOCATIONS" });
    dispatch({ type: "SET_ERROR", payload: null });
    dispatch({ type: "SET_LOADING", payload: false });
  }

  // Listen for sync event from native menu
  useEffect(() => {
    const unlisten = listen("sync-data", () => {
      setSyncCounter((c) => c + 1);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Force a token refresh check when the window regains visibility (e.g. after
  // sleep/wake). setInterval doesn't fire during sleep, so the background refresh
  // loop can miss expiry windows.
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      const current = authStateRef.current;
      if (!current?.refreshToken) return;
      if (isTokenExpired(current, 60_000)) {
        try {
          const authConfig = buildAuthConfig(DEFAULT_CONNECTION);
          const newState = await refreshAuthState(authConfig, current);
          setAuthState(newState);
          await saveAuthState(newState).catch(() => {});
        } catch {
          // Refresh failed — let the next API call handle it
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    loadDisplayPrefs()
      .then((prefs) => dispatch({ type: "SET_DISPLAY_PREFS", payload: prefs }))
      .catch(() => {});
  }, []);

  // Persist where the user drags the window. Dropping it near the top edge
  // counts as docking; on the next open Rust positions the window centered
  // under the tray icon. Anywhere else stores the absolute position so the
  // window comes back to where the user left it.
  useEffect(() => {
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | null = null;
    const SNAP_THRESHOLD_LOGICAL_PIXELS = 40;
    const MOVE_DEBOUNCE_MS = 250;

    async function pushLayoutToRust(layout: WindowLayout) {
      await invoke("set_window_layout", {
        docked: layout.docked,
        freeX: layout.freeX ?? null,
        freeY: layout.freeY ?? null,
      }).catch(() => {});
    }

    async function init() {
      const layout = await loadWindowLayout().catch(() => null);
      if (cancelled || !layout) return;
      await pushLayoutToRust(layout);

      const window = getCurrentWindow();
      unlisten = await window.onMoved(() => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(async () => {
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
        }, MOVE_DEBOUNCE_MS);
      });
    }

    init();
    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      unlisten?.();
    };
  }, []);

  // Restore a running timer that survived a quit/crash. Elapsed is derived
  // from startTime + now(), so time the app was closed is naturally counted.
  useEffect(() => {
    loadTimerState()
      .then((saved) => {
        if (saved?.isRunning && saved.startTime) {
          dispatch({ type: "SET_TIMER", payload: saved });
        }
      })
      .catch(() => {
        // Best effort — if the store can't be read, the user starts with a fresh timer
      })
      .finally(() => setTimerLoaded(true));
  }, []);

  // Persist the timer whenever it changes, but only after the initial load —
  // otherwise the default empty timer would overwrite a saved running timer.
  useEffect(() => {
    if (!timerLoaded) return;
    if (state.timer.isRunning) {
      saveTimerState(state.timer).catch(() => {});
    } else {
      clearTimerState().catch(() => {});
    }
  }, [timerLoaded, state.timer]);

  // Tray contents have to keep updating while the Timer view is unmounted
  // (Settings panel open, etc.), so the push lives in the always-mounted
  // provider rather than the useTimer hook.
  const todayDate = (() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  })();

  // When paused, fall back to the most recent entry from today so the menu
  // bar keeps showing the last task and ▶ has a sensible target to resume.
  const lastEntryToday = !state.timer.isRunning
    ? state.entries.reduce<(typeof state.entries)[number] | null>(
        (best, entry) =>
          entry.date === todayDate && (best === null || entry.startTime > best.startTime)
            ? entry
            : best,
        null
      )
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
    (displayProjectId && state.projects.find((p) => p.id === displayProjectId)?.name) || null;
  // The cache survives project switches; the currently-picked project's list
  // is only consulted as a fallback while the cache is still warming up.
  const displayTaskName = displayTaskId
    ? (state.taskNamesById[displayTaskId] ??
      state.tasks.find((task) => task.id === displayTaskId)?.name ??
      null)
    : null;

  // While running we exclude the current session — Rust adds the elapsed
  // seconds on each tick. While paused the just-stopped session is already
  // in entries, so the plain sum gives the correct day total.
  const todayBaseMinutes =
    displayProjectId && displayTaskId
      ? state.entries
          .filter(
            (e) =>
              e.projectId === displayProjectId &&
              e.taskId === displayTaskId &&
              e.date === todayDate &&
              e.startTime !== state.timer.startTime
          )
          .reduce((sum, e) => sum + (e.minutes || 0), 0)
      : 0;

  useEffect(() => {
    const startMs =
      state.timer.isRunning && state.timer.startTime
        ? new Date(state.timer.startTime).getTime()
        : null;
    invoke("set_timer_status", {
      running: state.timer.isRunning,
      startTimeMs: startMs,
      projectName: displayProjectName,
      taskName: displayTaskName,
      description: displayDescription,
      dayBaseSeconds: todayBaseMinutes * 60,
      showInMenuBar: state.displayPrefs.showTimerInMenuBar,
    }).catch(() => {});
  }, [
    state.timer.isRunning,
    state.timer.startTime,
    displayProjectName,
    displayTaskName,
    displayDescription,
    todayBaseMinutes,
    state.displayPrefs.showTimerInMenuBar,
  ]);

  // On mount: check for saved auth state, refresh if expired
  useEffect(() => {
    loadAuthState()
      .then(async (saved) => {
        if (!saved) return;

        if (saved.expiresAt > Date.now()) {
          // Token still valid
          setAuthState(saved);
          setIsConnected(true);
        } else if (saved.refreshToken) {
          // Access token expired but we have a refresh token — try to refresh
          try {
            const authConfig = buildAuthConfig(DEFAULT_CONNECTION);
            const newState = await refreshAuthState(authConfig, saved);
            await saveAuthState(newState).catch(() => {});
            setAuthState(newState);
            setIsConnected(true);
          } catch {
            // Refresh failed — clear auth, user needs to log in again
            clearAuth().catch(() => {});
          }
        } else {
          // No refresh token — clear
          clearAuth().catch(() => {});
        }
      })
      .catch(() => {
        // Store read failed — treat as not authenticated
      })
      .finally(() => {
        setIsAuthLoading(false);
      });
  }, []);

  // Background token refresh — check every 30 seconds, refresh when < 1 min to expiry
  useEffect(() => {
    if (!isConnected || !authState?.refreshToken) return;

    const REFRESH_CHECK_INTERVAL = 30_000; // 30 seconds
    const REFRESH_BUFFER = 60_000; // refresh when < 1 minute left

    const interval = setInterval(async () => {
      const current = authStateRef.current;
      if (!current?.refreshToken) return;

      if (isTokenExpired(current, REFRESH_BUFFER)) {
        try {
          const authConfig = buildAuthConfig(DEFAULT_CONNECTION);
          const newState = await refreshAuthState(authConfig, current);
          setAuthState(newState);
          await saveAuthState(newState).catch(() => {});
        } catch {
          // Refresh failed — token will expire and user will see session expired message
          // Don't clear auth here — let the next API call handle it
        }
      }
    }, REFRESH_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [isConnected, authState?.refreshToken]);

  // Load data when connected
  useEffect(() => {
    if (!api || !isConnected) return;

    let cancelled = false;

    async function init() {
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      try {
        const employee = await api!.getCurrentEmployee();
        if (cancelled) return;
        dispatch({ type: "SET_EMPLOYEE", payload: employee });

        const [projects, myProjects] = await Promise.all([
          api!.getProjects(),
          api!.getMyProjects(employee.id),
        ]);
        if (cancelled) return;
        const typeById = new Map(myProjects.map((p) => [p.id, p.projectType]));
        const enrichedProjects = projects.map((p) =>
          typeById.has(p.id) ? { ...p, projectType: typeById.get(p.id) } : p
        );
        dispatch({ type: "SET_PROJECTS", payload: enrichedProjects });
        dispatch({ type: "SET_MY_PROJECT_IDS", payload: myProjects.map((p) => p.id) });
        const openingMap: Record<string, string> = {};
        for (const p of myProjects) {
          if (p.openingId) openingMap[p.id] = p.openingId;
        }
        dispatch({ type: "SET_PROJECT_OPENING_MAP", payload: openingMap });

        // Use local dates (not UTC) to avoid timezone issues. Window extends
        // 30 days ahead so future-logged entries (e.g. vacation) show up in
        // the allocation view's weekly/monthly totals.
        const fmt = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const now = new Date();
        const past = new Date(now);
        past.setDate(past.getDate() - 30);
        const future = new Date(now);
        future.setDate(future.getDate() + 30);
        const entries = await api!.getTimeEntries(employee.id, fmt(past), fmt(future));
        if (cancelled) return;
        dispatch({ type: "SET_ENTRIES", payload: entries });

        // Load flex config and fetch holidays + extended entries if needed
        loadFlexConfig()
          .then(async (flexConfig) => {
            if (cancelled || !flexConfig) return;
            dispatch({ type: "SET_FLEX_CONFIG", payload: flexConfig });

            // Fetch holidays for the flex date range (by year)
            const startYear = new Date(flexConfig.startDate + "T12:00:00").getFullYear();
            const currentYear = new Date().getFullYear();
            try {
              const allHolidays = [];
              for (let year = startYear; year <= currentYear; year++) {
                const yearHolidays = await api!.getHolidays(
                  "SE",
                  `${year}-01-01`,
                  `${year + 1}-01-01`
                );
                allHolidays.push(...yearHolidays);
              }
              if (!cancelled) {
                dispatch({ type: "SET_HOLIDAYS", payload: allHolidays });
              }
            } catch {
              // Holiday fetch failed — flex will calculate without holidays
            }

            // If start date is older than our entry window, fetch the gap
            const pastStr = fmt(past);
            if (flexConfig.startDate < pastStr) {
              try {
                const flexEntries = await api!.getTimeEntries(
                  employee.id,
                  flexConfig.startDate,
                  pastStr
                );
                if (!cancelled) {
                  dispatch({ type: "SET_FLEX_ENTRIES", payload: flexEntries });
                }
              } catch {
                // Extended fetch failed — flex will use available entries only
              }
            }
          })
          .catch(() => {
            // Flex config load failed — flex feature just won't be configured
          });

        // Hydrate per-task billable flags so the UI can label entries as
        // billable/non-billable. We fetch tasks for every project that has
        // entries — these results are cached on the provider side and the
        // requests run in parallel.
        const projectIdsWithEntries = [...new Set(entries.map((e) => e.projectId))];
        Promise.all(projectIdsWithEntries.map((id) => api!.getTasks(id).catch(() => []))).then(
          (taskLists) => {
            if (cancelled) return;
            const billable: Record<string, boolean> = {};
            const names: Record<string, string> = {};
            for (const tasks of taskLists) {
              for (const t of tasks) {
                billable[t.id] = t.billable;
                names[t.id] = t.name;
              }
            }
            dispatch({ type: "MERGE_TASK_BILLABLE", payload: billable });
            dispatch({ type: "MERGE_TASK_NAMES", payload: names });
          }
        );
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to connect to AgileDay";
        dispatch({ type: "SET_ERROR", payload: msg });
      } finally {
        if (!cancelled) {
          dispatch({ type: "SET_LOADING", payload: false });
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [isConnected, syncCounter]);

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
