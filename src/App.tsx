import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Timer } from "./components/Timer";
import { TabSwitcher } from "./components/TabSwitcher";
import { TimeEntryList } from "./components/TimeEntryList";
import { AllocationView } from "./components/AllocationView";
import { LoginScreen } from "./components/LoginScreen";
import { UpdateChecker } from "./components/UpdateChecker";
import { SettingsView } from "./components/SettingsView";
import { FinalizeView } from "./components/FinalizeView";
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
  const { state, dispatch } = useApp();
  const [activeTab, setActiveTab] = useState<"list" | "allocation">("list");
  const [showSettings, setShowSettings] = useState(false);
  const [showFinalize, setShowFinalize] = useState(false);

  // Listen for tray menu items
  useEffect(() => {
    const unlistenSettings = listen("tray-open-settings", () => {
      setShowFinalize(false);
      setShowSettings(true);
    });
    const unlistenFinalize = listen("tray-open-finalize", () => {
      setShowSettings(false);
      setShowFinalize(true);
    });
    return () => {
      unlistenSettings.then((fn) => fn()).catch(() => {});
      unlistenFinalize.then((fn) => fn()).catch(() => {});
    };
  }, []);

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
        <div className="w-16" />
        <span className="text-xs font-semibold tracking-wide text-primary uppercase pointer-events-none">
          QTE Time Tracker
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setShowSettings(false);
              setShowFinalize(true);
            }}
            className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text transition-colors rounded-lg hover:bg-bg"
            title="Finalize Timesheet"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </button>
          <button
            onClick={() => {
              setShowFinalize(false);
              setShowSettings(true);
            }}
            className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text transition-colors rounded-lg hover:bg-bg"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
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

      {showSettings ? (
        <SettingsView onBack={() => setShowSettings(false)} />
      ) : showFinalize ? (
        <FinalizeView onBack={() => setShowFinalize(false)} />
      ) : (
        <>
          {/* Timer */}
          <div className="bg-bg-card border-b border-border">
            <Timer />
          </div>

          {/* Tab switcher */}
          <TabSwitcher active={activeTab} onChange={setActiveTab} />

          {/* Tab content */}
          {activeTab === "list" ? (
            <TimeEntryList onContinue={handleContinue} />
          ) : (
            <AllocationView />
          )}
        </>
      )}
    </div>
  );
}
