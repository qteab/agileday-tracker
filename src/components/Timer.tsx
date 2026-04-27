import { useTimer, formatTime } from "../hooks/useTimer";
import { ProjectPicker } from "./ProjectPicker";
import { TaskPicker } from "./TaskPicker";

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

  return (
    <div>
      {/* Timer row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What are you working on?"
          className="flex-1 bg-transparent text-sm text-text placeholder:text-text-muted outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isRunning && projectId) start();
          }}
        />

        <span className="text-sm font-mono text-text-muted tabular-nums w-[72px] text-right">
          {formatTime(elapsed)}
        </span>

        <button
          onClick={isRunning ? stop : start}
          disabled={!isRunning && !projectId}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
            isRunning
              ? "bg-danger hover:bg-danger/90"
              : projectId
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
