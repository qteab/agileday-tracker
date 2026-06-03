import { useState, useRef, useEffect } from "react";
import { useApp, useApi } from "../store/context";
import { BillableIndicator } from "./BillableIndicator";

interface TaskPickerProps {
  projectId: string | null;
  selectedId: string | null;
  onSelect: (taskId: string | null) => void;
  variant?: "field" | "chip";
}

export function TaskPicker({
  projectId,
  selectedId,
  onSelect,
  variant = "field",
}: TaskPickerProps) {
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
      const billable: Record<string, boolean> = {};
      const names: Record<string, string> = {};
      for (const t of tasks) {
        billable[t.id] = t.billable;
        names[t.id] = t.name;
      }
      dispatch({ type: "MERGE_TASK_BILLABLE", payload: billable });
      dispatch({ type: "MERGE_TASK_NAMES", payload: names });
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

  const rootClass = variant === "chip" ? "relative min-w-0 flex-1" : "relative min-w-0 w-full";
  const buttonClass =
    variant === "chip"
      ? "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-sm rounded-md bg-bg-card border border-divider hover:border-border cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
      : "flex w-full items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg bg-bg-card border border-divider hover:border-border cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <div ref={ref} className={rootClass}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={buttonClass}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <svg
            className="w-3.5 h-3.5 text-text-muted shrink-0"
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
          <span className={`truncate ${selected ? "text-text" : "text-text-muted"}`}>
            {selected ? selected.name : "Select task"}
          </span>
        </span>
        <svg
          className={`w-3 h-3 text-text-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed left-3 right-3 mt-1 bg-bg-card rounded-lg shadow-lg border border-divider z-50 py-1 max-h-56 overflow-y-auto"
          style={{
            top: ref.current ? ref.current.getBoundingClientRect().bottom + "px" : undefined,
          }}
        >
          {state.tasks
            .filter((t) => t.active)
            .map((task) => (
              <button
                type="button"
                key={task.id}
                onClick={() => {
                  onSelect(task.id);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-sm hover:bg-bg/70 cursor-pointer transition-colors flex items-center gap-2 ${
                  task.id === selectedId ? "bg-primary/10" : ""
                }`}
              >
                <BillableIndicator billable={task.billable} />
                <span className="truncate text-left flex-1">{task.name}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
