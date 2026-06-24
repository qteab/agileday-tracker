import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useApp, useApi } from "../store/context";
import { useTimer, formatTime, formatMinutes } from "../hooks/useTimer";
import { BillableIndicator } from "./BillableIndicator";
import { ProjectPicker } from "./ProjectPicker";
import { TaskPicker } from "./TaskPicker";
import {
  parseDurationInput,
  formatDurationInput,
  computeRunningTimeEdit,
  isLocalOnlyEntry,
  usedTaskIds,
} from "./entry-edit";
import type { TimeEntry } from "../api/types";

/** Split an AgileDay description string into individual lines. */
export function splitDescriptions(description: string): string[] {
  if (!description.trim()) return [];
  return description
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("- ") ? l.slice(2) : l));
}

/** Join description lines back into AgileDay's bullet format. */
export function joinDescriptions(lines: string[]): string {
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0) return "";
  if (nonEmpty.length === 1) return `- ${nonEmpty[0]}`;
  return nonEmpty.map((l) => `- ${l}`).join("\n");
}

interface ProjectCardProps {
  entry: TimeEntry;
  isToday: boolean;
}

type EditMode = "none" | "time" | "project" | "task" | "delete";

export function ProjectCard({ entry, isToday }: ProjectCardProps) {
  const { state, dispatch } = useApp();
  const api = useApi();
  const {
    isRunning,
    projectId: timerProjectId,
    taskId: timerTaskId,
    elapsed,
    startForCard,
    stop,
  } = useTimer();

  const project = state.projects.find((p) => p.id === entry.projectId);
  const taskName = entry.taskId ? state.taskNamesById[entry.taskId] : undefined;
  const billable = entry.taskId ? state.taskBillableById[entry.taskId] : undefined;
  const isSubmitted = entry.status === "SUBMITTED" || entry.status === "APPROVED";
  const isEditable = !isSubmitted && entry.syncStatus !== "pending";

  const isThisRunning =
    isRunning &&
    timerProjectId === entry.projectId &&
    (timerTaskId ?? null) === (entry.taskId ?? null) &&
    isToday;

  // Project/task can only be changed while the card's timer is not running
  // (the timer state references the current projectId/taskId).
  const canEditMeta = isEditable && !isThisRunning;

  // Descriptions state for inline editing
  const [descriptions, setDescriptions] = useState(() => splitDescriptions(entry.description));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const editRef = useRef<HTMLSpanElement>(null);

  // Inline field editing (time / project / task / delete-confirm)
  const [editMode, setEditMode] = useState<EditMode>("none");
  const [timeInput, setTimeInput] = useState("");
  const timeInputRef = useRef<HTMLInputElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync descriptions when entry changes from server
  useEffect(() => {
    if (editingIndex === null) {
      setDescriptions(splitDescriptions(entry.description));
    }
  }, [entry.description, editingIndex]);

  // Focus newly added description line
  useEffect(() => {
    if (editingIndex !== null && editRef.current) {
      editRef.current.focus();
    }
  }, [editingIndex]);

  // Focus the time input when it opens
  useEffect(() => {
    if (editMode === "time" && timeInputRef.current) {
      timeInputRef.current.focus();
      timeInputRef.current.select();
    }
  }, [editMode]);

  // Re-render every second while running for elapsed time display
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isThisRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isThisRunning]);

  /** POST-or-PATCH the entry with overridden fields (description and/or minutes). */
  const persistViaCreate = useCallback(
    async (overrides: { description?: string; minutes?: number }) => {
      dispatch({
        type: "UPDATE_ENTRY",
        payload: { id: entry.id, updates: { ...overrides, syncStatus: "pending" } },
      });

      try {
        const saved = await api.createTimeEntry(state.employee!.id, {
          description: overrides.description ?? entry.description,
          projectId: entry.projectId,
          projectName: entry.projectName,
          openingId: entry.openingId,
          taskId: entry.taskId,
          date: entry.date,
          startTime: entry.startTime,
          minutes: overrides.minutes ?? entry.minutes,
          status: entry.status,
        });
        dispatch({
          type: "UPDATE_ENTRY",
          payload: {
            id: entry.id,
            updates: {
              id: saved.id,
              description: saved.description,
              minutes: saved.minutes,
              syncStatus: "synced",
            },
          },
        });
      } catch {
        dispatch({
          type: "UPDATE_ENTRY",
          payload: { id: entry.id, updates: { syncStatus: "unsaved" } },
        });
      }
    },
    [api, dispatch, entry, state.employee]
  );

  const saveDescriptions = useCallback(
    async (newLines: string[]) => {
      const newDesc = joinDescriptions(newLines);
      if (newDesc === entry.description) return;
      await persistViaCreate({ description: newDesc });
    },
    [entry.description, persistViaCreate]
  );

  const handleBlur = useCallback(
    (index: number, text: string) => {
      const trimmed = text.trim();
      const newLines = [...descriptions];
      if (!trimmed) {
        // Remove empty lines
        newLines.splice(index, 1);
      } else {
        newLines[index] = trimmed;
      }
      setDescriptions(newLines);
      setEditingIndex(null);
      void saveDescriptions(newLines);
    },
    [descriptions, saveDescriptions]
  );

  const handleAddDescription = useCallback(() => {
    if (!isEditable) return;
    const newLines = [...descriptions, ""];
    setDescriptions(newLines);
    setEditingIndex(newLines.length - 1);
  }, [descriptions, isEditable]);

  // Show accumulated total: entry.minutes + current session elapsed
  const totalSeconds = isThisRunning ? entry.minutes * 60 + elapsed : entry.minutes * 60;
  const displayTime = isThisRunning ? formatTime(totalSeconds) : formatMinutes(entry.minutes);

  /** Open the inline time editor seeded with the current total. */
  const openTimeEdit = useCallback(() => {
    if (!isEditable) return;
    setTimeInput(formatDurationInput(Math.round(totalSeconds / 60)));
    setEditMode("time");
  }, [isEditable, totalSeconds]);

  /** Commit the inline time edit. While running, snap the clock and keep counting. */
  const commitTime = useCallback(() => {
    setEditMode("none");
    const mins = parseDurationInput(timeInput);
    if (mins === null) return;
    if (isThisRunning) {
      const { bankedMinutes } = computeRunningTimeEdit(mins);
      // Reset the timer start so the clock continues from the entered total.
      dispatch({ type: "SET_TIMER", payload: { startTime: new Date().toISOString() } });
      if (bankedMinutes !== entry.minutes) void persistViaCreate({ minutes: bankedMinutes });
    } else {
      if (mins !== entry.minutes) void persistViaCreate({ minutes: mins });
    }
  }, [timeInput, isThisRunning, entry.minutes, dispatch, persistViaCreate]);

  // Task ids already used for this (project, date) — hidden from the inline picker
  // so changing the task can't create a duplicate entry.
  const usedTasks = useMemo(
    () => usedTaskIds(state.entries, entry.id, entry.projectId, entry.date),
    [state.entries, entry.id, entry.projectId, entry.date]
  );

  /** Change the project: update locally, clear task, then prompt for a new task. */
  const handleProjectSelect = useCallback(
    (newProjectId: string) => {
      if (newProjectId === entry.projectId) {
        setEditMode("none");
        return;
      }
      const newProject = state.projects.find((p) => p.id === newProjectId);
      const openingId = state.projectOpeningMap[newProjectId];
      dispatch({
        type: "UPDATE_ENTRY",
        payload: {
          id: entry.id,
          updates: {
            projectId: newProjectId,
            projectName: newProject?.name,
            openingId,
            taskId: undefined,
          },
        },
      });
      // Force a task selection for the new project before persisting.
      setEditMode("task");
    },
    [entry.id, entry.projectId, state.projects, state.projectOpeningMap, dispatch]
  );

  /** Change the task (and persist the project+task change). */
  const handleTaskSelect = useCallback(
    async (newTaskId: string | null) => {
      setEditMode("none");
      if (!newTaskId || newTaskId === entry.taskId) return;
      setActionError(null);

      dispatch({
        type: "UPDATE_ENTRY",
        payload: { id: entry.id, updates: { taskId: newTaskId, syncStatus: "pending" } },
      });

      // Local-only entries aren't on AgileDay yet — they'll be POSTed correctly
      // on the next save (timer stop / description / minutes edit).
      if (isLocalOnlyEntry(entry)) {
        dispatch({
          type: "UPDATE_ENTRY",
          payload: { id: entry.id, updates: { syncStatus: "synced" } },
        });
        return;
      }

      try {
        const saved = await api.updateTimeEntry(state.employee!.id, entry.id, {
          projectId: entry.projectId,
          openingId: entry.openingId,
          taskId: newTaskId,
        });
        dispatch({
          type: "UPDATE_ENTRY",
          payload: {
            id: entry.id,
            updates: {
              projectId: saved.projectId,
              taskId: saved.taskId,
              syncStatus: "synced",
            },
          },
        });
      } catch (err) {
        dispatch({
          type: "UPDATE_ENTRY",
          payload: { id: entry.id, updates: { syncStatus: "unsaved" } },
        });
        setActionError(err instanceof Error ? err.message : "Failed to update task");
      }
    },
    [api, dispatch, entry, state.employee]
  );

  /** Delete the entry (with the inline confirmation already shown). */
  const confirmDelete = useCallback(async () => {
    setEditMode("none");
    setActionError(null);

    // Discard any running session for this card — we're removing it.
    if (isThisRunning) dispatch({ type: "RESET_TIMER" });

    // Local-only entries were never persisted — remove without an API call.
    if (isLocalOnlyEntry(entry)) {
      dispatch({ type: "DELETE_ENTRY", payload: entry.id });
      return;
    }

    try {
      await api.deleteTimeEntry([entry.id]);
      dispatch({ type: "DELETE_ENTRY", payload: entry.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete entry");
    }
  }, [api, dispatch, entry, isThisRunning]);

  // Dot color: green for active/external, purple for internal, intense for absence/idle
  const dotColor = (() => {
    const pt = entry.projectType ?? project?.projectType;
    if (pt === "ABSENCE" || pt === "IDLE") return "bg-primary-light";
    if (pt === "INTERNAL") return "bg-primary";
    return "bg-[#18a058]"; // green for external/active
  })();

  return (
    <div
      className={`bg-bg-card border border-border rounded-xl shadow-[0_1px_2px_rgba(11,4,21,0.04)]`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        {/* Left: project info */}
        <div className="flex-1 min-w-0">
          {editMode === "project" ? (
            <ProjectPicker
              selectedId={entry.projectId}
              onSelect={handleProjectSelect}
              variant="chip"
              usageDate={entry.date}
              onClose={() => setEditMode("none")}
            />
          ) : (
            <button
              type="button"
              onClick={() => canEditMeta && setEditMode("project")}
              disabled={!canEditMeta}
              className={`block w-full text-left font-bold text-[17px] leading-[1.25] text-text truncate ${
                canEditMeta
                  ? "cursor-pointer hover:text-primary transition-colors"
                  : "cursor-default"
              }`}
            >
              {project?.name ?? entry.projectName ?? "Unknown project"}
            </button>
          )}

          <div className="flex items-center gap-2 mt-[7px] text-[13.5px] text-text-muted">
            <span className={`w-[9px] h-[9px] rounded-full shrink-0 ${dotColor}`} />
            {editMode === "task" ? (
              <TaskPicker
                projectId={entry.projectId}
                selectedId={entry.taskId ?? null}
                onSelect={handleTaskSelect}
                excludeIds={usedTasks}
                variant="chip"
                onClose={() => setEditMode("none")}
              />
            ) : (
              <button
                type="button"
                onClick={() => canEditMeta && setEditMode("task")}
                disabled={!canEditMeta}
                className={`flex items-center gap-[5px] min-w-0 ${
                  canEditMeta
                    ? "cursor-pointer hover:text-primary transition-colors"
                    : "cursor-default"
                }`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-text-subtle shrink-0"
                >
                  <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
                  <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
                </svg>
                <span className="truncate">{taskName ?? "Select task"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Right: billable, time, play/stop */}
        <div className="flex items-center gap-3 shrink-0">
          <BillableIndicator billable={billable} />
          {editMode === "time" ? (
            <input
              ref={timeInputRef}
              type="text"
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              onBlur={commitTime}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTime();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditMode("none");
                }
              }}
              className="w-[72px] px-2 py-0.5 text-[17px] font-semibold tabular-nums text-right border border-primary rounded-md bg-bg-edit outline-none focus:ring-2 focus:ring-primary/25"
              aria-label="Edit time"
            />
          ) : (
            <span
              onClick={openTimeEdit}
              className={`text-[17px] font-semibold tabular-nums ${
                isThisRunning ? "text-primary" : "text-text"
              } ${isEditable ? "cursor-pointer hover:opacity-70" : ""}`}
            >
              {displayTime}
            </span>
          )}
          {isToday && !isSubmitted && (
            <button
              onClick={() => {
                if (isThisRunning) {
                  void stop();
                } else {
                  void startForCard(entry.projectId, entry.taskId!);
                }
              }}
              disabled={!entry.taskId && !isThisRunning}
              className={`w-[38px] h-[38px] rounded-full flex items-center justify-center text-white transition-all active:scale-[0.94] disabled:opacity-40 disabled:cursor-not-allowed ${
                isThisRunning ? "bg-danger hover:bg-[#d8363c]" : "bg-primary hover:bg-primary-dark"
              }`}
              aria-label={isThisRunning ? "Stop timer" : "Start timer"}
            >
              {isThisRunning ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2.5" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Empty description warning while running */}
      {isThisRunning && descriptions.length === 0 && (
        <div className="flex items-center gap-2 mx-4 mb-2 px-3 py-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg">
          <svg
            className="w-3.5 h-3.5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>No description — the customer sees this on the invoice</span>
        </div>
      )}

      {/* Sync status indicators */}
      {entry.syncStatus === "unsaved" && (
        <div className="px-4 pb-2">
          <span className="text-xs text-danger font-medium">Unsaved</span>
        </div>
      )}
      {entry.syncStatus === "pending" && (
        <div className="px-4 pb-2">
          <span className="text-xs text-text-muted font-medium">Saving...</span>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="px-4 pb-2">
          <span className="text-xs text-danger font-medium">{actionError}</span>
        </div>
      )}

      {/* Description stack */}
      <div className="px-4 pb-3">
        <div className="border-l-2 border-border ml-1 pl-[14px] flex flex-col gap-[9px]">
          {descriptions.map((desc, i) => (
            <div key={i} className="flex gap-[9px] items-start text-sm text-text leading-[1.4]">
              <span className="w-[5px] h-[5px] rounded-full bg-primary shrink-0 mt-[7px]" />
              {isEditable ? (
                <span
                  ref={editingIndex === i ? editRef : undefined}
                  contentEditable
                  suppressContentEditableWarning
                  className="desc-editable flex-1 outline-none rounded-[4px] focus:bg-bg-edit focus:ring-2 focus:ring-primary/25"
                  data-placeholder="Describe what you worked on…"
                  onFocus={() => setEditingIndex(i)}
                  onBlur={(e) => handleBlur(i, e.currentTarget.textContent ?? "")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLElement).blur();
                    }
                  }}
                >
                  {desc}
                </span>
              ) : (
                <span className="flex-1">{desc || "—"}</span>
              )}
            </div>
          ))}

          {/* Empty state placeholder */}
          {descriptions.length === 0 && !isEditable && (
            <div className="text-sm text-text-subtle">No description</div>
          )}

          {/* Add description button */}
          {isEditable && (
            <button
              onClick={handleAddDescription}
              className="inline-flex items-center gap-[6px] text-[13px] font-semibold text-text-subtle hover:text-primary transition-colors py-1 -ml-1"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              add description
            </button>
          )}
        </div>
      </div>

      {/* Delete confirmation row */}
      {editMode === "delete" ? (
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1">
          <span className="text-xs text-text-muted">Delete this entry?</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditMode("none")}
              className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text rounded-md"
            >
              Cancel
            </button>
            <button
              onClick={() => void confirmDelete()}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-danger hover:bg-[#d8363c] rounded-md transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        isEditable && (
          <div className="flex justify-end px-4 pb-3 -mt-1">
            <button
              onClick={() => {
                setActionError(null);
                setEditMode("delete");
              }}
              className="inline-flex items-center gap-1.5 text-[12px] leading-none text-text-subtle hover:text-danger transition-colors"
              aria-label="Delete entry"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              <span>Delete</span>
            </button>
          </div>
        )
      )}

      {/* Lock indicator for submitted entries */}
      {isSubmitted && (
        <div className="px-4 pb-3">
          <span className="text-[10px] text-text-muted/50 flex items-center gap-0.5">
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M12 15v2m0 0v2m0-2h2m-2 0H10m-4-6V7a4 4 0 118 0v4m-8 0h12a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6a2 2 0 012-2z"
              />
            </svg>
            Submitted — edit in AgileDay
          </span>
        </div>
      )}
    </div>
  );
}
