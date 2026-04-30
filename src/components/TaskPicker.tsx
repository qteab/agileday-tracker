import { useState, useRef, useEffect } from "react";
import { useApp, useApi } from "../store/context";

interface TaskPickerProps {
  projectId: string | null;
  selectedId: string | null;
  onSelect: (taskId: string | null) => void;
}

export function TaskPicker({ projectId, selectedId, onSelect }: TaskPickerProps) {
  const { state, dispatch } = useApp();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = state.tasks.find((t) => t.id === selectedId);

  useEffect(() => {
    if (!projectId) {
      dispatch({ type: "SET_TASKS", payload: [] });
      return;
    }
    api.getTasks(projectId).then((tasks) => {
      dispatch({ type: "SET_TASKS", payload: tasks });
    });
  }, [projectId, api, dispatch]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!projectId || state.tasks.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg hover:bg-white/60 transition-colors"
      >
        <svg
          className="w-3.5 h-3.5 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <span className={selected ? "text-text" : "text-text-muted"}>
          {selected ? selected.name : "Select task"}
        </span>
      </button>

      {open && (
        <div
          className="fixed left-3 right-3 mt-1 bg-white rounded-xl shadow-lg border border-border z-50 py-1 max-h-56 overflow-y-auto"
          style={{
            top: ref.current ? ref.current.getBoundingClientRect().bottom + "px" : undefined,
          }}
        >
          {state.tasks
            .filter((t) => t.active)
            .map((task) => (
              <button
                key={task.id}
                onClick={() => {
                  onSelect(task.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-bg transition-colors ${
                  task.id === selectedId ? "bg-bg" : ""
                }`}
              >
                {task.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
