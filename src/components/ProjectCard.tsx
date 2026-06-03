import { useState, useEffect, useRef, useCallback } from "react";
import { useApp, useApi } from "../store/context";
import { useTimer, formatTime, formatMinutes } from "../hooks/useTimer";
import { BillableIndicator } from "./BillableIndicator";
import { EntryEditModal } from "./EntryEditModal";
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

  // Descriptions state for inline editing
  const [descriptions, setDescriptions] = useState(() => splitDescriptions(entry.description));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const editRef = useRef<HTMLSpanElement>(null);

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

  // Re-render every second while running for elapsed time display
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isThisRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isThisRunning]);

  const saveDescriptions = useCallback(
    async (newLines: string[]) => {
      const newDesc = joinDescriptions(newLines);
      if (newDesc === entry.description) return;

      dispatch({
        type: "UPDATE_ENTRY",
        payload: { id: entry.id, updates: { description: newDesc, syncStatus: "pending" } },
      });

      try {
        // Use createTimeEntry (POST-or-PATCH) so it works whether
        // the entry exists on AgileDay yet or not.
        const saved = await api.createTimeEntry(state.employee!.id, {
          description: newDesc,
          projectId: entry.projectId,
          projectName: entry.projectName,
          openingId: entry.openingId,
          taskId: entry.taskId,
          date: entry.date,
          startTime: entry.startTime,
          minutes: entry.minutes,
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

  // Dot color: green for active/external, purple for internal, intense for absence/idle
  const dotColor = (() => {
    const pt = entry.projectType ?? project?.projectType;
    if (pt === "ABSENCE" || pt === "IDLE") return "bg-primary-light";
    if (pt === "INTERNAL") return "bg-primary";
    return "bg-[#18a058]"; // green for external/active
  })();

  // Show accumulated total: entry.minutes + current session elapsed
  const totalSeconds = isThisRunning ? entry.minutes * 60 + elapsed : entry.minutes * 60;
  const displayTime = isThisRunning ? formatTime(totalSeconds) : formatMinutes(entry.minutes);

  const [showEditModal, setShowEditModal] = useState(false);

  return (
    <div
      className={`bg-bg-card border border-border rounded-xl shadow-[0_1px_2px_rgba(11,4,21,0.04)]`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        {/* Left: project info */}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[17px] leading-[1.25] text-text truncate">
            {project?.name ?? entry.projectName ?? "Unknown project"}
          </div>
          <div className="flex items-center gap-2 mt-[7px] text-[13.5px] text-text-muted">
            <span className={`w-[9px] h-[9px] rounded-full shrink-0 ${dotColor}`} />
            {taskName && (
              <span className="flex items-center gap-[5px]">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-text-subtle"
                >
                  <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
                  <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
                </svg>
                {taskName}
              </span>
            )}
          </div>
        </div>

        {/* Right: billable, time, play/stop */}
        <div className="flex items-center gap-3 shrink-0">
          <BillableIndicator billable={billable} />
          <span
            onClick={() => {
              if (isEditable && !isThisRunning) setShowEditModal(true);
            }}
            className={`text-[17px] font-semibold tabular-nums ${
              isThisRunning ? "text-primary" : "text-text"
            } ${isEditable && !isThisRunning ? "cursor-pointer hover:opacity-70" : ""}`}
          >
            {displayTime}
          </span>
          {isToday && !isSubmitted && (
            <button
              onClick={() => {
                if (isThisRunning) {
                  void stop();
                } else {
                  void startForCard(entry.projectId, entry.taskId!);
                }
              }}
              className={`w-[38px] h-[38px] rounded-full flex items-center justify-center text-white transition-all active:scale-[0.94] ${
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
                  className="desc-editable flex-1 outline-none rounded-[4px] focus:bg-[#faf6ff] focus:ring-2 focus:ring-primary/25"
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

      {/* Edit modal for duration/date changes */}
      {showEditModal && isEditable && (
        <EntryEditModal entry={entry} onClose={() => setShowEditModal(false)} />
      )}
    </div>
  );
}
