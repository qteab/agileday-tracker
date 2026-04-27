import { useCallback, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Timer } from "./components/Timer";
import { TabSwitcher } from "./components/TabSwitcher";
import { TimeEntryList } from "./components/TimeEntryList";
import { AllocationView } from "./components/AllocationView";
import { LoginScreen } from "./components/LoginScreen";
import { UpdateChecker } from "./components/UpdateChecker";
import { useApp } from "./store/context";
import type { TimeEntry } from "./api/types";

export function App() {
  const { isConnected, isAuthLoading, onLogin } = useApp();

  // Show nothing while checking saved auth
  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <span className="text-sm text-text-muted">Loading...</span>
      </div>
    );
  }

  // Not authenticated → login screen
  if (!isConnected) {
    return <LoginScreen onLoginSuccess={onLogin} />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { state, dispatch, logout } = useApp();
  const [activeTab, setActiveTab] = useState<"list" | "allocation">("list");

  const handleContinue = useCallback(
    (entry: TimeEntry) => {
      dispatch({
        type: "SET_TIMER",
        payload: {
          description: entry.description,
          projectId: entry.projectId,
          taskId: entry.taskId ?? null,
          isRunning: true,
          startTime: new Date().toISOString(),
        },
      });
    },
    [dispatch]
  );

  return (
    <div className="flex flex-col h-screen bg-bg">
      {/* Draggable title bar */}
      <div
        onMouseDown={(e) => {
          if (e.button === 0 && e.detail === 1) {
            e.preventDefault();
            getCurrentWindow().startDragging();
          }
        }}
        className="flex items-center justify-between px-4 pt-5 pb-2 bg-bg-card border-b border-border cursor-default"
      >
        <div className="w-8" />
        <span className="text-xs font-semibold tracking-wide text-primary uppercase pointer-events-none">
          QTE Time Tracker
        </span>
        <button
          onClick={logout}
          className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-danger transition-colors rounded-lg hover:bg-bg"
          title="Sign out"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
        </button>
      </div>

      {/* Update banner */}
      <UpdateChecker />

      {/* Error banner */}
      {state.error && (
        <div className="flex items-center justify-between px-4 py-2 bg-danger/10 text-danger text-xs">
          <span>{state.error}</span>
          <button
            onClick={() => dispatch({ type: "SET_ERROR", payload: null })}
            className="hover:text-danger/70"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Timer */}
      <div className="bg-bg-card border-b border-border">
        <Timer />
      </div>

      {/* Tab switcher */}
      <TabSwitcher active={activeTab} onChange={setActiveTab} />

      {/* Tab content */}
      {activeTab === "list" ? <TimeEntryList onContinue={handleContinue} /> : <AllocationView />}
    </div>
  );
}
