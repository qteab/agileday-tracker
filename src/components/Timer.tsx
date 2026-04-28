import { useState, useRef, useEffect, useMemo } from "react";
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

export function Timer() {
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
  } = useTimer();
  const { state } = useApp();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

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
            className="w-full bg-transparent text-sm text-text placeholder:text-text-muted outline-none"
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

        <span className="text-sm font-mono text-text-muted tabular-nums w-[72px] text-right">
          {formatTime(elapsed)}
        </span>

        <button
          onClick={() => {
            setShowSuggestions(false);
            if (isRunning) {
              stop();
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

      {/* Project & task row */}
      <div className="flex items-center gap-1 px-3 pb-3">
        <ProjectPicker selectedId={projectId} onSelect={setProject} />
        <TaskPicker projectId={projectId} selectedId={taskId} onSelect={setTask} />
      </div>
    </div>
  );
}
