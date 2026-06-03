import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { TabSwitcher } from "./components/TabSwitcher";
import { ProjectCardList } from "./components/ProjectCardList";
import { AllocationView } from "./components/AllocationView";
import { LoginScreen } from "./components/LoginScreen";
import { UpdateChecker } from "./components/UpdateChecker";
import { SettingsView, type SettingsTab } from "./components/SettingsView";
import { FinalizeView } from "./components/FinalizeView";
import { SubmissionAlert } from "./components/SubmissionAlert";
import { FlexBadge } from "./components/FlexBadge";
import { FlexSetupAlert } from "./components/FlexSetupAlert";
import { Fab } from "./components/Fab";
import { useApp } from "./store/context";
import { formatMinutes } from "./hooks/useTimer";

export function App() {
  const { isConnected, isAuthLoading, onLogin } = useApp();

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <span className="text-sm text-text-muted">Loading...</span>
      </div>
    );
  }

  if (!isConnected) {
    return <LoginScreen onLoginSuccess={onLogin} />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { state, dispatch } = useApp();
  const [activeTab, setActiveTab] = useState<"list" | "allocation">("list");
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [showFinalize, setShowFinalize] = useState(false);
  const [dismissedWeeks, setDismissedWeeks] = useState<Set<string>>(new Set());

  // Listen for tray menu items
  useEffect(() => {
    const unlistenSettings = listen("tray-open-settings", () => {
      setShowFinalize(false);
      setSettingsTab("account");
    });
    const unlistenFinalize = listen("tray-open-finalize", () => {
      setSettingsTab(null);
      setShowFinalize(true);
    });
    return () => {
      unlistenSettings.then((fn) => fn()).catch(() => {});
      unlistenFinalize.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // Today's running total for the title bar
  const todayDate = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  const [, setTick] = useState(0);
  const timerRunning = state.timer.isRunning;
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  const todayTotalMinutes = useMemo(() => {
    const entryMinutes = state.entries
      .filter((e) => e.date === todayDate)
      .reduce((sum, e) => sum + e.minutes, 0);
    const runningMinutes =
      state.timer.isRunning && state.timer.startTime
        ? Math.max(0, Math.round((Date.now() - new Date(state.timer.startTime).getTime()) / 60000))
        : 0;
    return entryMinutes + runningMinutes;
  }, [state.entries, todayDate, state.timer.isRunning, state.timer.startTime]);

  const showMainContent = !settingsTab && !showFinalize;

  return (
    <div className="flex flex-col h-screen bg-bg relative">
      {/* Draggable title bar */}
      <div
        onMouseDown={(e) => {
          if (e.button === 0 && e.detail === 1) {
            e.preventDefault();
            getCurrentWindow().startDragging();
          }
        }}
        className="grid grid-cols-[1fr_auto_1fr] items-center px-4 pt-[13px] pb-3 bg-bg-card border-b border-border cursor-default"
      >
        {/* Left: traffic lights space */}
        <div className="w-16" />

        {/* Center: wordmark */}
        <span className="font-bold text-sm tracking-[0.12em] text-primary uppercase pointer-events-none whitespace-nowrap">
          QTE Time Tracker
        </span>

        {/* Right: running total + icons */}
        <div className="flex items-center justify-end gap-3">
          {todayTotalMinutes > 0 && (
            <span className="font-bold text-sm text-accent-green tabular-nums">
              +{formatMinutes(todayTotalMinutes)}
            </span>
          )}
          <FlexBadge
            onClick={() => {
              setShowFinalize(false);
              setSettingsTab("flex");
            }}
          />
          <button
            onClick={() => {
              setSettingsTab(null);
              setShowFinalize(true);
            }}
            className="inline-flex text-text-muted hover:opacity-60 transition-opacity"
            title="Finalize Timesheet"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="8" y="2" width="8" height="4" rx="1" />
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <path d="m9 14 2 2 4-4" />
            </svg>
          </button>
          <button
            onClick={() => {
              setShowFinalize(false);
              setSettingsTab("account");
            }}
            className="inline-flex text-text-muted hover:opacity-60 transition-opacity"
            title="Settings"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Update banner */}
      <UpdateChecker />

      {/* Submission deadline alert */}
      <SubmissionAlert
        entries={state.entries}
        dismissedWeeks={dismissedWeeks}
        onOpenFinalize={() => {
          setSettingsTab(null);
          setShowFinalize(true);
        }}
      />

      {/* Flex setup prompt */}
      <FlexSetupAlert
        onOpenSettings={() => {
          setShowFinalize(false);
          setSettingsTab("flex");
        }}
      />

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

      {settingsTab ? (
        <SettingsView onBack={() => setSettingsTab(null)} defaultTab={settingsTab} />
      ) : showFinalize ? (
        <FinalizeView
          onBack={() => setShowFinalize(false)}
          onMarkSubmitted={(weekStart) =>
            setDismissedWeeks((prev) => new Set([...prev, weekStart]))
          }
        />
      ) : (
        <>
          {/* Tab switcher */}
          <TabSwitcher active={activeTab} onChange={setActiveTab} />

          {/* Tab content */}
          {activeTab === "list" ? <ProjectCardList /> : <AllocationView />}
        </>
      )}

      {/* FAB — only visible on the list tab */}
      {showMainContent && activeTab === "list" && <Fab />}
    </div>
  );
}
