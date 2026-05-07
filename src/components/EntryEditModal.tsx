import { useState } from "react";
import { useApp, useApi } from "../store/context";
import { ProjectPicker } from "./ProjectPicker";
import { removeDescription } from "../api/agileday";
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
  const { state, dispatch } = useApp();
  const api = useApi();
  const [description, setDescription] = useState(entry.description);
  const [projectId, setProjectId] = useState(entry.projectId);
  const date = entry.date;
  const [startTimeStr, setStartTimeStr] = useState(
    entry.startTime ? timeFromISO(entry.startTime) : ""
  );
  const [endTimeStr, setEndTimeStr] = useState(entry.endTime ? timeFromISO(entry.endTime) : "");
  const [duration, setDuration] = useState(formatDuration(entry.minutes));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleSave() {
    if (!state.employee) return;
    setSaving(true);
    setSaveError("");

    const parts = duration.split(":");
    const mins = parseInt(parts[0] || "0") * 60 + parseInt(parts[1] || "0");

    try {
      const groupMode = state.settings.groupDescriptions;

      // Calculate group total: other sessions sharing the same AgileDay entry + this session's new value
      const otherSessions = state.entries.filter((e) => {
        if (e.id === entry.id || e.projectId !== entry.projectId || e.date !== entry.date)
          return false;
        if (groupMode) {
          return (e.taskId ?? "") === (entry.taskId ?? "");
        }
        return e.description === entry.description;
      });
      const groupTotal = otherSessions.reduce((s, e) => s + e.minutes, 0) + mins;

      // Find the real AgileDay entry to update
      const allRecent = await api.getTimeEntries(state.employee.id, entry.date, entry.date);
      const agileMatch = allRecent.find((e) => {
        if (e.projectId !== entry.projectId || e.id.startsWith("summary-")) return false;
        if (groupMode) {
          return (e.taskId ?? "") === (entry.taskId ?? "");
        }
        return e.description === entry.description;
      });

      if (agileMatch) {
        await api.updateTimeEntry(state.employee.id, agileMatch.id, {
          description: groupMode ? agileMatch.description : description,
          projectId,
          minutes: groupTotal,
        });
      }

      // Update local state
      dispatch({
        type: "UPDATE_ENTRY",
        payload: {
          id: entry.id,
          updates: {
            description,
            projectId,
            projectName: state.projects.find((p) => p.id === projectId)?.name,
            minutes: mins,
          },
        },
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update entry";
      setSaveError(msg);
      setSaving(false);
    }
  }

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function handleDelete() {
    if (!state.employee) return;
    setDeleting(true);
    setDeleteError("");

    const groupMode = state.settings.groupDescriptions;

    // Calculate remaining total BEFORE removing from local state.
    // In group mode, all sessions for the same project+task+date share one AgileDay entry.
    const remaining = state.entries.filter((e) => {
      if (e.id === entry.id || e.projectId !== entry.projectId || e.date !== entry.date)
        return false;
      if (groupMode) {
        return (e.taskId ?? "") === (entry.taskId ?? "");
      }
      return e.description === entry.description;
    });
    const remainingMinutes = remaining.reduce((s, e) => s + e.minutes, 0);

    try {
      // Sync to AgileDay first — if this fails, local state stays intact
      const allRecent = await api.getTimeEntries(state.employee.id, entry.date, entry.date);
      const agileMatch = allRecent.find((e) => {
        if (e.projectId !== entry.projectId || e.id.startsWith("summary-")) return false;
        if (groupMode) {
          return (e.taskId ?? "") === (entry.taskId ?? "");
        }
        return e.description === entry.description;
      });

      if (agileMatch) {
        if (remainingMinutes > 0) {
          const updates: Partial<TimeEntry> = { minutes: remainingMinutes };

          // In group mode, also remove this session's description from the grouped description
          if (groupMode && entry.description) {
            updates.description = removeDescription(agileMatch.description, entry.description);
          }

          await api.updateTimeEntry(state.employee.id, agileMatch.id, updates);
        } else {
          await api.deleteTimeEntry([agileMatch.id]);
        }
      }

      // API succeeded — now remove from local state
      dispatch({ type: "DELETE_ENTRY", payload: entry.id });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete";
      setDeleteError(msg);
      setDeleting(false);
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

        {/* Date — read-only, change in AgileDay */}
        <div className="space-y-1">
          <input
            type="date"
            value={date}
            disabled
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg/50 text-text-muted cursor-not-allowed"
          />
          <p className="text-[10px] text-text-muted">
            To change the date, edit in AgileDay and sync.
          </p>
        </div>

        {/* Errors */}
        {(deleteError || saveError) && (
          <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">
            {deleteError || saveError}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm text-danger hover:text-danger/80 font-medium disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm text-white bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
