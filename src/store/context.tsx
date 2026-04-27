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
import { mockProvider } from "../api/mock";
import { createAgileDayProvider, type AgileDayConfig } from "../api/agileday";
import type { AuthState } from "../api/auth";
import {
  loadAuthState,
  saveAuthState,
  clearAuth,
  listenForAuthCallback,
  completeLogin,
  buildAuthConfig,
  buildApiBaseUrl,
  DEFAULT_CONNECTION,
} from "../api/auth-manager";

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  api: ApiProvider;
  isConnected: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const authStateRef = useRef<AuthState | null>(null);

  // Keep ref in sync for the closure in createAgileDayProvider
  authStateRef.current = authState;

  // Build the appropriate API provider
  const api: ApiProvider =
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
      : mockProvider;

  // On mount: check for existing auth + listen for deep link callbacks
  useEffect(() => {
    loadAuthState().then((saved) => {
      if (saved) {
        setAuthState(saved);
        setIsConnected(true);
      }
    });

    listenForAuthCallback(async (code, returnedState) => {
      try {
        const auth = await completeLogin(code, returnedState);
        setAuthState(auth);
        setIsConnected(true);
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          payload: err instanceof Error ? err.message : "Login failed",
        });
      }
    });
  }, []);

  // Load data whenever the API provider changes
  useEffect(() => {
    async function init() {
      dispatch({ type: "SET_LOADING", payload: true });
      try {
        const [employee, projects] = await Promise.all([
          api.getCurrentEmployee(),
          api.getProjects(),
        ]);
        dispatch({ type: "SET_EMPLOYEE", payload: employee });
        dispatch({ type: "SET_PROJECTS", payload: projects });

        const endDate = new Date().toISOString().split("T")[0];
        const startDate = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
        const entries = await api.getTimeEntries(employee.id, startDate, endDate);
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
    <AppContext.Provider value={{ state, dispatch, api, isConnected }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
