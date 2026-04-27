import { useCallback, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Timer } from "./components/Timer";
import { TabSwitcher } from "./components/TabSwitcher";
import { TimeEntryList } from "./components/TimeEntryList";
import { AllocationView } from "./components/AllocationView";
import { Settings } from "./components/Settings";
import { UpdateChecker } from "./components/UpdateChecker";
import { useApp } from "./store/context";
import type { TimeEntry } from "./api/types";

export function App() {
  const { state, dispatch } = useApp();
  const [activeTab, setActiveTab] = useState<"list" | "allocation">("list");
  const [showSettings, setShowSettings] = useState(false);

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
        <div className="w-8" /> {/* Spacer for traffic lights */}
        <span className="text-xs font-semibold tracking-wide text-primary uppercase pointer-events-none">
          QTE Time Tracker
        </span>
        <button
          onClick={() => setShowSettings(true)}
          className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-bg"
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

      {/* Settings modal */}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onConnectionChange={() => {
            // TODO: swap API provider when connection changes
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}
