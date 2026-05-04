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
import type { ApiProvider } from "../api/provider";
import { createAgileDayProvider, type AgileDayConfig } from "../api/agileday";
import type { AuthState } from "../api/auth";
import { isTokenExpired, refreshAccessToken, tokenResponseToAuthState } from "../api/auth";
import {
  loadAuthState,
  saveAuthState,
  clearAuth,
  buildAuthConfig,
  buildApiBaseUrl,
  DEFAULT_CONNECTION,
} from "../api/auth-manager";
import { loadTimerState, saveTimerState, clearTimerState } from "./timer-store";

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
            const tokens = await refreshAccessToken(authConfig, saved.refreshToken);
            const newState = tokenResponseToAuthState(tokens);
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
          const tokens = await refreshAccessToken(authConfig, current.refreshToken);
          const newState = tokenResponseToAuthState(tokens);
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

        const [projects, myProjectIds] = await Promise.all([
          api!.getProjects(),
          api!.getMyProjectIds(employee.id),
        ]);
        if (cancelled) return;
        dispatch({ type: "SET_PROJECTS", payload: projects });
        dispatch({ type: "SET_MY_PROJECT_IDS", payload: myProjectIds });

        // Use local dates (not UTC) to avoid timezone issues
        const now = new Date();
        const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const past = new Date(now);
        past.setDate(past.getDate() - 30);
        const startDate = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}-${String(past.getDate()).padStart(2, "0")}`;
        const entries = await api!.getTimeEntries(employee.id, startDate, endDate);
        if (cancelled) return;
        dispatch({ type: "SET_ENTRIES", payload: entries });
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
