import { useState, useMemo } from "react";
import { useApp } from "../store/context";
import { ProjectPicker } from "./ProjectPicker";
import { TaskPicker } from "./TaskPicker";
import { usedTaskIds } from "./entry-edit";
import { useTimer } from "../hooks/useTimer";

export function Fab() {
  const { state, dispatch } = useApp();
  const { startForCard } = useTimer();
  const [showDialog, setShowDialog] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Tasks already tracked today for the selected project — hidden so the FAB
  // can't create a duplicate (project, task, date) entry.
  const usedTasks = useMemo(
    () => (projectId ? usedTaskIds(state.entries, "", projectId, today) : new Set<string>()),
    [projectId, state.entries, today]
  );

  const handleCreate = async () => {
    if (!projectId || !taskId || !state.employee) return;

    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Check if an entry already exists for this project+task today
    const existing = state.entries.find(
      (e) => e.projectId === projectId && (e.taskId ?? null) === taskId && e.date === date
    );

    if (!existing) {
      const project = state.projects.find((p) => p.id === projectId);
      const openingId = state.projectOpeningMap[projectId];
      const localId = `local-${crypto.randomUUID()}`;

      // Add locally — will be synced to AgileDay on first description save or timer stop
      dispatch({
        type: "ADD_ENTRY",
        payload: {
          id: localId,
          description: "",
          projectId,
          projectName: project?.name,
          openingId,
          taskId: taskId ?? undefined,
          date,
          startTime: now.toISOString(),
          minutes: 0,
          status: "SAVED",
          syncStatus: "synced",
        },
      });
    }

    // Start the timer on this card
    void startForCard(projectId, taskId);

    // Reset dialog
    setShowDialog(false);
    setProjectId(null);
    setTaskId(null);
  };

  if (showDialog) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/20 z-40"
          onClick={() => {
            setShowDialog(false);
            setProjectId(null);
            setTaskId(null);
          }}
        />
        {/* Dialog — positioned at top of window below title bar */}
        <div className="absolute top-14 right-4 left-4 z-50 bg-bg-card rounded-xl shadow-[0_18px_40px_rgba(11,4,21,0.12)] border border-border p-4 flex flex-col gap-3">
          <div className="font-bold text-sm text-text">New time entry</div>
          <ProjectPicker
            selectedId={projectId}
            onSelect={(id) => {
              setProjectId(id);
              setTaskId(null);
            }}
            variant="field"
            usageDate={today}
          />
          <TaskPicker
            projectId={projectId}
            selectedId={taskId}
            onSelect={setTaskId}
            variant="field"
            excludeIds={usedTasks}
          />
          <button
            onClick={() => void handleCreate()}
            disabled={!projectId || !taskId}
            className={`w-full py-2.5 rounded-lg font-semibold text-sm text-white transition-all ${
              projectId && taskId
                ? "bg-primary hover:bg-primary-dark active:scale-[0.98]"
                : "bg-primary/30 cursor-not-allowed"
            }`}
          >
            Start tracking
          </button>
        </div>
      </>
    );
  }

  return (
    <button
      onClick={() => setShowDialog(true)}
      className="absolute right-4 bottom-4 w-[52px] h-[52px] rounded-full bg-primary text-white flex items-center justify-center shadow-[0_8px_22px_rgba(85,25,213,0.42)] hover:bg-primary-dark active:scale-[0.95] transition-all z-30"
      aria-label="New project"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  );
}
