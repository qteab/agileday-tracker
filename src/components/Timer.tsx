import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTimer, formatTime } from "../hooks/useTimer";
import { useApp } from "../store/context";
import { ProjectPicker } from "./ProjectPicker";
import { TaskPicker } from "./TaskPicker";

interface Suggestion {
  description: string;
  projectId: string;
  projectName?: string;
  projectColor?: string;
  taskId?: string;
}

interface TimerProps {
  onStopRef?: React.MutableRefObject<(() => void) | null>;
}

export function Timer({ onStopRef }: TimerProps) {
  const {
    isRunning,
    description,
    projectId,
    taskId,
    elapsed,
    start,
    stop,
    setDescription,
    setProject,
    setTask,
    setElapsedSeconds,
  } = useTimer();
  const { state } = useApp();

  // Expose stop to parent via ref
  useEffect(() => {
    if (onStopRef) onStopRef.current = stop;
    return () => {
      if (onStopRef) onStopRef.current = null;
    };
  }, [onStopRef, stop]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const [timeInput, setTimeInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const emptyDescription = isRunning && !description.trim();

  // Build unique suggestions from existing entries
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const result: Suggestion[] = [];
    for (const entry of state.entries) {
      if (!entry.description) continue;
      const key = `${entry.description}::${entry.projectId}::${entry.taskId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const project = state.projects.find((p) => p.id === entry.projectId);
      result.push({
        description: entry.description,
        projectId: entry.projectId,
        projectName: project?.name ?? entry.projectName,
        projectColor: project?.color,
        taskId: entry.taskId,
      });
    }
    return result;
  }, [state.entries, state.projects]);

  const filtered = useMemo(() => {
    if (!description.trim()) return suggestions.slice(0, 8);
    const q = description.toLowerCase();
    return suggestions.filter((s) => s.description.toLowerCase().includes(q)).slice(0, 8);
  }, [description, suggestions]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function parseTimeInput(input: string): number | null {
    const trimmed = input.trim();
    // h:mm:ss
    const full = trimmed.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
    if (full) {
      return parseInt(full[1]) * 3600 + parseInt(full[2]) * 60 + parseInt(full[3]);
    }
    // m:ss or mm:ss
    const short = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
    if (short) {
      return parseInt(short[1]) * 60 + parseInt(short[2]);
    }
    return null;
  }

  const startEditingTime = useCallback(() => {
    if (!isRunning) return;
    setTimeInput(formatTime(elapsed));
    setEditingTime(true);
    setTimeout(() => timeInputRef.current?.select(), 0);
  }, [isRunning, elapsed]);

  const commitTimeEdit = useCallback(() => {
    const seconds = parseTimeInput(timeInput);
    if (seconds !== null && seconds >= 0) {
      setElapsedSeconds(seconds);
    }
    setEditingTime(false);
  }, [timeInput, setElapsedSeconds]);

  function selectSuggestion(s: Suggestion) {
    setDescription(s.description);
    setProject(s.projectId);
    if (s.taskId) setTask(s.taskId);
    setShowSuggestions(false);
  }

  return (
    <div>
      {/* Timer row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="What are you working on?"
            className={`w-full bg-transparent text-sm text-text placeholder:text-text-muted outline-none ${emptyDescription ? "placeholder:text-amber-500" : ""}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isRunning && projectId && taskId) {
                setShowSuggestions(false);
                start();
              }
              if (e.key === "Escape") setShowSuggestions(false);
            }}
          />

          {/* Suggestions dropdown */}
          {showSuggestions && !isRunning && filtered.length > 0 && (
            <div
              ref={suggestionsRef}
              className="absolute left-0 right-0 top-full mt-2 bg-white rounded-lg shadow-lg border border-border z-50 overflow-hidden"
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wide">
                Previously tracked
              </div>
              <div className="max-h-48 overflow-y-auto pb-1">
                {filtered.map((s, i) => (
                  <button
                    key={`${s.description}-${s.projectId}-${i}`}
                    onClick={() => selectSuggestion(s)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-bg transition-colors text-sm"
                  >
                    <span className="truncate font-medium text-text">{s.description}</span>
                    {s.projectColor && (
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: s.projectColor }}
                      />
                    )}
                    {s.projectName && (
                      <span className="text-xs text-text-muted shrink-0">{s.projectName}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {editingTime ? (
          <input
            ref={timeInputRef}
            type="text"
            value={timeInput}
            onChange={(e) => setTimeInput(e.target.value)}
            onBlur={commitTimeEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTimeEdit();
              if (e.key === "Escape") setEditingTime(false);
            }}
            className="text-sm font-mono text-text tabular-nums w-[72px] text-right bg-transparent outline-none border-b border-primary"
          />
        ) : (
          <span
            onClick={startEditingTime}
            className={`text-sm font-mono text-text-muted tabular-nums w-[72px] text-right ${isRunning ? "cursor-pointer hover:text-text" : ""}`}
          >
            {formatTime(elapsed)}
          </span>
        )}

        <button
          onClick={() => {
            setShowSuggestions(false);
            if (isRunning) {
              if (!description.trim()) {
                setShowEmptyConfirm(true);
              } else {
                stop();
              }
            } else {
              start();
            }
          }}
          disabled={!isRunning && (!projectId || !taskId)}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
            isRunning
              ? "bg-danger hover:bg-danger/90"
              : projectId && taskId
                ? "bg-primary hover:bg-primary-dark"
                : "bg-primary/30 cursor-not-allowed"
          }`}
        >
          {isRunning ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>

      {/* Empty description warning */}
      {emptyDescription && !showEmptyConfirm && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-amber-700 bg-amber-50">
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

      {/* Empty description confirmation */}
      {showEmptyConfirm && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-t border-amber-200">
          <span className="text-xs text-amber-800 flex-1">
            Save without a description? The customer will see a blank line on their invoice.
          </span>
          <button
            onClick={() => {
              setShowEmptyConfirm(false);
              stop();
            }}
            className="px-3 py-1 text-xs font-medium text-white bg-danger rounded-lg hover:bg-danger/90 transition-colors"
          >
            Save anyway
          </button>
          <button
            onClick={() => {
              setShowEmptyConfirm(false);
              inputRef.current?.focus();
            }}
            className="px-3 py-1 text-xs font-medium text-amber-800 bg-amber-100 rounded-lg hover:bg-amber-200 transition-colors"
          >
            Add description
          </button>
        </div>
      )}

      {/* Project & task row */}
      <div className="flex items-center gap-1 px-3 pb-3">
        <ProjectPicker selectedId={projectId} onSelect={setProject} />
        <TaskPicker projectId={projectId} selectedId={taskId} onSelect={setTask} />
      </div>
    </div>
  );
}
