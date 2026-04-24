import { useApp } from "../store/context";
import { formatMinutes } from "../hooks/useTimer";
import type { TimeEntry as TimeEntryType } from "../api/types";

interface TimeEntryProps {
  entry: TimeEntryType;
}

export function TimeEntry({ entry }: TimeEntryProps) {
  const { state, api, dispatch } = useApp();
  const project = state.projects.find((p) => p.id === entry.projectId);

  async function handleRetry() {
    if (!state.employee) return;
    dispatch({
      type: "UPDATE_ENTRY",
      payload: { id: entry.id, updates: { syncStatus: "pending" } },
    });
    try {
      const saved = await api.createTimeEntry(state.employee.id, entry);
      dispatch({
        type: "UPDATE_ENTRY",
        payload: { id: entry.id, updates: { ...saved, syncStatus: "synced" } },
      });
    } catch {
      dispatch({
        type: "UPDATE_ENTRY",
        payload: { id: entry.id, updates: { syncStatus: "unsaved" } },
      });
    }
  }

  async function handleDelete() {
    try {
      await api.deleteTimeEntry([entry.id]);
      dispatch({ type: "DELETE_ENTRY", payload: entry.id });
    } catch {
      dispatch({ type: "SET_ERROR", payload: "Failed to delete entry" });
    }
  }

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-white/60 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text truncate">
          {entry.description || <span className="text-text-muted italic">No description</span>}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {project && (
            <>
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: project.color }}
              />
              <span className="text-xs text-text-muted truncate">
                {project.name}
              </span>
            </>
          )}
        </div>
      </div>

      {entry.syncStatus === "unsaved" && (
        <button
          onClick={handleRetry}
          className="text-xs text-danger hover:text-danger/80 font-medium shrink-0"
          title="Failed to save — click to retry"
        >
          Retry
        </button>
      )}

      {entry.syncStatus === "pending" && (
        <span className="text-xs text-text-muted shrink-0">Saving...</span>
      )}

      <button
        onClick={handleDelete}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger transition-all shrink-0"
        title="Delete entry"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <span className="text-sm text-text-muted tabular-nums shrink-0">
        {formatMinutes(entry.minutes)}
      </span>
    </div>
  );
}
