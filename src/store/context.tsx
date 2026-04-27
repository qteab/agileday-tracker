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
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const authStateRef = useRef<AuthState | null>(null);

  authStateRef.current = authState;

  // Build AgileDay provider only when authenticated
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
            saveAuthState(newState);
          },
          () => {
            setAuthState(null);
            setIsConnected(false);
            clearAuth();
          }
        )
      : null;

  async function logout() {
    await clearAuth();
    setAuthState(null);
    setIsConnected(false);
    dispatch({ type: "SET_ENTRIES", payload: [] });
    dispatch({ type: "SET_PROJECTS", payload: [] });
    dispatch({ type: "SET_EMPLOYEE", payload: null as never });
  }

  // On mount: check for saved auth state
  useEffect(() => {
    loadAuthState().then((saved) => {
      if (saved) {
        setAuthState(saved);
        setIsConnected(true);
      }
      setIsAuthLoading(false);
    });
  }, []);

  // Load data when connected
  useEffect(() => {
    if (!api || !isConnected) return;

    async function init() {
      dispatch({ type: "SET_LOADING", payload: true });
      try {
        const [employee, projects] = await Promise.all([
          api!.getCurrentEmployee(),
          api!.getProjects(),
        ]);
        dispatch({ type: "SET_EMPLOYEE", payload: employee });
        dispatch({ type: "SET_PROJECTS", payload: projects });

        const endDate = new Date().toISOString().split("T")[0];
        const startDate = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
        const entries = await api!.getTimeEntries(employee.id, startDate, endDate);
        dispatch({ type: "SET_ENTRIES", payload: entries });
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          payload: err instanceof Error ? err.message : "Failed to load data",
        });
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    }
    init();
  }, [isConnected]);

  return (
    <AppContext.Provider value={{ state, dispatch, api, isConnected, isAuthLoading, logout }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

/** Use in components that are only rendered when authenticated */
export function useApi(): ApiProvider {
  const { api } = useApp();
  if (!api) throw new Error("useApi called without authentication");
  return api;
}
