import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Timer } from "./components/Timer";
import { TimeEntryList } from "./components/TimeEntryList";
import { useApp } from "./store/context";
import type { TimeEntry } from "./api/types";

export function App() {
  const { state, dispatch } = useApp();

  const handleContinue = useCallback(
    (entry: TimeEntry) => {
      // Start a new timer with the same description and project
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
        className="flex items-center justify-center px-4 pt-5 pb-2 border-b border-border bg-white/40 cursor-default"
      >
        <span className="text-xs font-semibold tracking-wide text-primary uppercase pointer-events-none">
          QTE Time Tracker
        </span>
      </div>

      {/* Error banner */}
      {state.error && (
        <div className="flex items-center justify-between px-4 py-2 bg-danger/10 text-danger text-xs">
          <span>{state.error}</span>
          <button
            onClick={() => dispatch({ type: "SET_ERROR", payload: null })}
            className="hover:text-danger/70"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Timer */}
      <Timer />

      {/* Entry list */}
      <TimeEntryList onContinue={handleContinue} />
    </div>
  );
}
