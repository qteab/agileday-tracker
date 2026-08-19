import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useApp, useApi } from "../store/context";
import { useTimer, formatTime, formatMinutes } from "../hooks/useTimer";
import { ProjectPicker } from "./ProjectPicker";
import { TaskPicker } from "./TaskPicker";
import { Modal } from "./Modal";
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
  const isSubmitted = entry.status === "SUBMITTED" || entry.status === "APPROVED";
  const isEditable = !isSubmitted && entry.syncStatus !== "pending";

  const isThisRunning =
    isRunning &&
    timerProjectId === entry.projectId &&
    (timerTaskId ?? null) === (entry.taskId ?? null) &&
    isToday;

  // Project/task are editable on any non-submitted card. When the card's timer
  // is running, the timer state is re-pointed to the new project/task so it
  // keeps counting on the re-categorized entry (see handleProject/TaskSelect).
  const canEditMeta = isEditable;

  // Descriptions state for inline editing
  const [descriptions, setDescriptions] = useState(() => splitDescriptions(entry.description));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const editRef = useRef<HTMLSpanElement>(null);

  // Collapsed cards show only a one-line summary (see the early return below).
  const [collapsed, setCollapsed] = useState(false);

  // Inline field editing (time / project / task / delete-confirm)
  const [editMode, setEditMode] = useState<EditMode>("none");
  const [timeInput, setTimeInput] = useState("");
  const timeInputRef = useRef<HTMLInputElement>(null);
  // Value the time editor was seeded with — an unchanged input commits as a
  // no-op so a running timer keeps its sub-minute seconds.
  const timeSeedRef = useRef("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Snapshot of the entry's project/task taken when a project change begins, so
  // cancelling (clicking outside) restores it instead of leaving a half-changed
  // entry. Cleared once a task is committed.
  const pendingRevertRef = useRef<{
    projectId: string;
    projectName?: string;
    openingId?: string;
    taskId?: string;
    wasRunning: boolean;
  } | null>(null);

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

  // The stop button only exists on the expanded card, so a card whose timer
  // starts running expands itself to keep it reachable.
  useEffect(() => {
    if (isThisRunning) setCollapsed(false);
  }, [isThisRunning]);

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
    const seed = formatDurationInput(Math.round(totalSeconds / 60));
    timeSeedRef.current = seed;
    setTimeInput(seed);
    setEditMode("time");
  }, [isEditable, totalSeconds]);

  /** Commit the inline time edit. While running, snap the clock and keep counting. */
  const commitTime = useCallback(() => {
    setEditMode("none");
    // Untouched input → treat as cancel, so a running timer keeps its seconds.
    if (timeInput === timeSeedRef.current) return;
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
      // Remember the pre-change state (only the first change in this session)
      // so cancelling can restore it.
      if (!pendingRevertRef.current) {
        pendingRevertRef.current = {
          projectId: entry.projectId,
          projectName: entry.projectName,
          openingId: entry.openingId,
          taskId: entry.taskId,
          wasRunning: isThisRunning,
        };
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
      // If this card's timer is running, re-point it to the new project so it
      // keeps counting (task cleared until the user picks one below).
      if (isThisRunning) {
        dispatch({ type: "SET_TIMER", payload: { projectId: newProjectId, taskId: null } });
      }
      // Force a task selection for the new project before persisting.
      setEditMode("task");
    },
    [
      entry.id,
      entry.projectId,
      entry.projectName,
      entry.openingId,
      entry.taskId,
      state.projects,
      state.projectOpeningMap,
      dispatch,
      isThisRunning,
    ]
  );

  /** Change the task (and persist the project+task change). */
  const handleTaskSelect = useCallback(
    async (newTaskId: string | null) => {
      setEditMode("none");
      if (!newTaskId || newTaskId === entry.taskId) return;
      setActionError(null);
      // A task was chosen — the project/task change is committed, nothing to revert.
      pendingRevertRef.current = null;

      dispatch({
        type: "UPDATE_ENTRY",
        payload: { id: entry.id, updates: { taskId: newTaskId, syncStatus: "pending" } },
      });

      // Keep a running timer pointed at the re-categorized project+task so it
      // keeps counting and stop() finds this entry.
      if (isThisRunning) {
        dispatch({
          type: "SET_TIMER",
          payload: { projectId: entry.projectId, taskId: newTaskId },
        });
      }

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
    [api, dispatch, entry, state.employee, isThisRunning]
  );

  /** Exit project/task editing. Restores the pre-change project/task if a
   *  project change was started but no task was committed. */
  const handleCancelEdit = useCallback(() => {
    const snap = pendingRevertRef.current;
    pendingRevertRef.current = null;
    if (snap) {
      dispatch({
        type: "UPDATE_ENTRY",
        payload: {
          id: entry.id,
          updates: {
            projectId: snap.projectId,
            projectName: snap.projectName,
            openingId: snap.openingId,
            taskId: snap.taskId,
          },
        },
      });
      if (snap.wasRunning) {
        dispatch({
          type: "SET_TIMER",
          payload: { projectId: snap.projectId, taskId: snap.taskId ?? null },
        });
      }
    }
    setEditMode("none");
  }, [dispatch, entry.id]);

  const closeDeleteModal = useCallback(() => setEditMode("none"), []);

  /** Delete the entry (after the confirmation modal). */
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

  // Quick-open: from a past-day card, start a new entry today with the same
  // project + task. Blocked if that project+task is already tracked today.
  const todayStr = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  })();
  const canQuickOpen = !isToday && !!entry.taskId;
  const alreadyTrackedToday = entry.taskId
    ? usedTaskIds(state.entries, "", entry.projectId, todayStr).has(entry.taskId)
    : false;

  const handleQuickOpen = useCallback(() => {
    if (!entry.taskId || alreadyTrackedToday || !state.employee) return;
    const proj = state.projects.find((p) => p.id === entry.projectId);
    const openingId = state.projectOpeningMap[entry.projectId];
    dispatch({
      type: "ADD_ENTRY",
      payload: {
        id: `local-${crypto.randomUUID()}`,
        description: "",
        projectId: entry.projectId,
        projectName: proj?.name ?? entry.projectName,
        openingId,
        taskId: entry.taskId,
        date: todayStr,
        startTime: new Date().toISOString(),
        minutes: 0,
        status: "SAVED",
        syncStatus: "synced",
      },
    });
    void startForCard(entry.projectId, entry.taskId);
  }, [
    entry.taskId,
    entry.projectId,
    entry.projectName,
    alreadyTrackedToday,
    state.employee,
    state.projects,
    state.projectOpeningMap,
    todayStr,
    dispatch,
    startForCard,
  ]);

  // Dot color: green for active/external, purple for internal, intense for absence/idle
  const dotColor = (() => {
    const pt = entry.projectType ?? project?.projectType;
    if (pt === "ABSENCE" || pt === "IDLE") return "bg-primary-light";
    if (pt === "INTERNAL") return "bg-primary";
    return "bg-[#18a058]"; // green for external/active
  })();

  // Collapsed card: project, task, description count, time and an expand
  // button. No delete and no start/stop — those live on the expanded card.
  if (collapsed) {
    return (
      <div className="bg-bg-card border border-border rounded-xl shadow-[0_1px_2px_rgba(11,4,21,0.04)] px-4 py-[11px]">
        <div className="flex items-center gap-3">
          <span className={`w-[9px] h-[9px] rounded-full shrink-0 ${dotColor}`} />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[15px] leading-[1.3] text-text truncate">
              {project?.name ?? entry.projectName ?? "Unknown project"}
            </div>
            <div className="flex items-center gap-1.5 text-[12.5px] leading-[1.3] text-text-muted min-w-0">
              <span className="truncate">{taskName ?? "No task"}</span>
              <span className="shrink-0 text-text-subtle">·</span>
              <span className="shrink-0 inline-flex items-center gap-[3px] text-text-subtle tabular-nums">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                {descriptions.length}
              </span>
            </div>
          </div>
          <span
            className={`text-[16px] font-semibold tabular-nums shrink-0 ${
              isThisRunning ? "text-primary" : "text-text"
            }`}
          >
            {displayTime}
          </span>
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="shrink-0 w-[26px] h-[26px] -mr-1 rounded-md flex items-center justify-center text-text-subtle hover:text-primary hover:bg-bg-edit transition-colors cursor-pointer"
            aria-label="Expand entry"
            aria-expanded={false}
            title="Expand"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-bg-card border border-border rounded-xl shadow-[0_1px_2px_rgba(11,4,21,0.04)]`}
    >
      {/* Header */}
      <div className="px-4 pt-[14px] pb-3">
        {/* Row 1: project name, time, play/stop */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {editMode === "project" ? (
              <ProjectPicker
                selectedId={entry.projectId}
                onSelect={handleProjectSelect}
                variant="chip"
                usageDate={entry.date}
                onClose={handleCancelEdit}
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
          </div>

          <div className="flex items-center gap-3 shrink-0">
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
                className={`w-[36px] h-[36px] rounded-full flex items-center justify-center text-white transition-all active:scale-[0.94] disabled:opacity-40 disabled:cursor-not-allowed ${
                  isThisRunning
                    ? "bg-danger hover:bg-[#d8363c]"
                    : "bg-primary hover:bg-primary-dark"
                }`}
                aria-label={isThisRunning ? "Stop timer" : "Start timer"}
              >
                {isThisRunning ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2.5" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6 4 20 12 6 20 6 4" />
                  </svg>
                )}
              </button>
            )}
            {canQuickOpen && (
              <button
                onClick={handleQuickOpen}
                disabled={alreadyTrackedToday}
                title={alreadyTrackedToday ? "Already tracked today" : "Start today"}
                className="w-[36px] h-[36px] rounded-full flex items-center justify-center transition-all active:scale-[0.94] border-2 border-primary text-primary hover:bg-primary hover:text-white disabled:opacity-40 disabled:border-border disabled:text-text-subtle disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-subtle"
                aria-label="Start today"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: status dot + task selector (full width) */}
        <div className="flex items-center gap-2 mt-1 text-[13.5px] text-text-muted">
          <span className={`w-[9px] h-[9px] rounded-full shrink-0 ${dotColor}`} />
          {editMode === "task" ? (
            <TaskPicker
              projectId={entry.projectId}
              selectedId={entry.taskId ?? null}
              onSelect={handleTaskSelect}
              excludeIds={usedTasks}
              variant="chip"
              onClose={handleCancelEdit}
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

      {/* Footer: delete (left), collapse (right), lock indicator when submitted */}
      <div className="flex items-center gap-3 px-4 pb-3 -mt-1">
        {isEditable && (
          <button
            onClick={() => {
              setActionError(null);
              setEditMode("delete");
            }}
            className="inline-flex items-center gap-1.5 text-[12px] leading-[13px] text-text-subtle hover:text-danger transition-colors cursor-pointer"
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
        )}
        {isSubmitted && (
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
        )}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="ml-auto inline-flex items-center gap-1.5 text-[12px] leading-[13px] text-text-subtle hover:text-primary transition-colors cursor-pointer"
          aria-label="Collapse entry"
          aria-expanded={true}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
          <span>Collapse</span>
        </button>
      </div>

      {/* Delete confirmation modal */}
      {editMode === "delete" && (
        <Modal
          onClose={closeDeleteModal}
          title="Delete this entry?"
          subtitle={`${entry.projectName ?? "This entry"} · ${displayTime}${
            isThisRunning ? " — the running timer will be discarded." : ""
          } This can't be undone.`}
          actions={[
            { label: "Cancel", variant: "secondary", onClick: closeDeleteModal },
            {
              label: "Delete",
              variant: "danger",
              autoFocus: true,
              onClick: () => void confirmDelete(),
            },
          ]}
        />
      )}
    </div>
  );
}
