import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { appReducer, initialState, type AppState, type AppAction } from "./reducer";
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
  const authStateRef = useRef<AuthState | null>(null);

  authStateRef.current = authState;

  const api: ApiProvider | null =
    isConnected && authState
      ? createAgileDayProvider(
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
        )
      : null;

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
    dispatch({ type: "SET_ERROR", payload: null });
    dispatch({ type: "SET_LOADING", payload: false });
  }

  // On mount: check for saved auth state
  useEffect(() => {
    loadAuthState()
      .then((saved) => {
        if (saved && saved.expiresAt > Date.now()) {
          setAuthState(saved);
          setIsConnected(true);
        } else if (saved) {
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

        const projects = await api!.getProjects();
        if (cancelled) return;
        dispatch({ type: "SET_PROJECTS", payload: projects });

        const endDate = new Date().toISOString().split("T")[0];
        const startDate = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
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
  }, [isConnected]);

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
