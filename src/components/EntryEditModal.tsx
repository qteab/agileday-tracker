import { useState } from "react";
import { useApp } from "../store/context";
import { ProjectPicker } from "./ProjectPicker";
import type { TimeEntry } from "../api/types";

interface EntryEditModalProps {
  entry: TimeEntry;
  onClose: () => void;
}

function timeFromISO(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const s = 0;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function EntryEditModal({ entry, onClose }: EntryEditModalProps) {
  const { state, api, dispatch } = useApp();
  const [description, setDescription] = useState(entry.description);
  const [projectId, setProjectId] = useState(entry.projectId);
  const [date, setDate] = useState(entry.date);
  const [startTimeStr, setStartTimeStr] = useState(
    entry.startTime ? timeFromISO(entry.startTime) : ""
  );
  const [endTimeStr, setEndTimeStr] = useState(entry.endTime ? timeFromISO(entry.endTime) : "");
  const [duration, setDuration] = useState(formatDuration(entry.minutes));

  async function handleSave() {
    if (!state.employee) return;

    // Parse duration back to minutes
    const parts = duration.split(":");
    const mins = parseInt(parts[0] || "0") * 60 + parseInt(parts[1] || "0");

    try {
      await api.updateTimeEntry(state.employee.id, entry.id, {
        description,
        projectId,
        date,
        minutes: mins,
      });
      dispatch({
        type: "UPDATE_ENTRY",
        payload: {
          id: entry.id,
          updates: {
            description,
            projectId,
            projectName: state.projects.find((p) => p.id === projectId)?.name,
            date,
            minutes: mins,
          },
        },
      });
      onClose();
    } catch {
      dispatch({ type: "SET_ERROR", payload: "Failed to update entry" });
    }
  }

  async function handleDelete() {
    try {
      await api.deleteTimeEntry([entry.id]);
      dispatch({ type: "DELETE_ENTRY", payload: entry.id });
      onClose();
    } catch {
      dispatch({ type: "SET_ERROR", payload: "Failed to delete entry" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-muted hover:text-text"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Details</h3>

        {/* Description */}
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add description"
          className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg focus:outline-none focus:border-primary"
        />

        {/* Project */}
        <ProjectPicker selectedId={projectId} onSelect={setProjectId} />

        {/* Duration */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Duration
          </label>
          <input
            type="text"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg focus:outline-none focus:border-primary tabular-nums"
          />
        </div>

        {/* Time range */}
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={startTimeStr}
            onChange={(e) => setStartTimeStr(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-bg focus:outline-none focus:border-primary"
          />
          <span className="text-text-muted text-sm">&rarr;</span>
          <input
            type="time"
            value={endTimeStr}
            onChange={(e) => setEndTimeStr(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-bg focus:outline-none focus:border-primary"
          />
        </div>

        {/* Date */}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg focus:outline-none focus:border-primary"
        />

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleDelete}
            className="text-sm text-danger hover:text-danger/80 font-medium"
          >
            Delete
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-sm text-white bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
