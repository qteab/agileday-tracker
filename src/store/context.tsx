import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  type ReactNode,
} from "react";
import { appReducer, initialState, type AppState, type AppAction } from "./reducer";
import type { ApiProvider } from "../api/provider";
import { mockProvider } from "../api/mock";

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  api: ApiProvider;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const api = mockProvider; // Swap to agileday provider when ready

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

        // Load last 30 days of entries
        const endDate = new Date().toISOString().split("T")[0];
        const startDate = new Date(Date.now() - 30 * 86400000)
          .toISOString()
          .split("T")[0];
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
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch, api }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
