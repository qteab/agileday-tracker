import { useState, useRef, useEffect } from "react";
import { useApp, useApi } from "../store/context";
import { BillableIndicator } from "./BillableIndicator";
import { describeTaskPickerState, type TaskLoadStatus } from "../utils/task-picker";

interface TaskPickerProps {
  projectId: string | null;
  selectedId: string | null;
  onSelect: (taskId: string | null) => void;
  variant?: "field" | "chip";
  /** Task ids to hide from the list (e.g. already used for this project+date). */
  excludeIds?: Set<string>;
  /** Called when the picker is dismissed by clicking outside it. */
  onClose?: () => void;
}

export function TaskPicker({
  projectId,
  selectedId,
  onSelect,
  variant = "field",
  excludeIds,
  onClose,
}: TaskPickerProps) {
  const { state, dispatch } = useApp();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<TaskLoadStatus>("ready");
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const selected = state.tasks.find((t) => t.id === selectedId);

  useEffect(() => {
    if (!projectId) {
      setStatus("ready");
      dispatch({ type: "SET_TASKS", payload: [] });
      return;
    }
    let cancelled = false;
    setStatus("loading");
    api
      .getTasks(projectId)
      .then((tasks) => {
        if (cancelled) return;
        setStatus("ready");
        dispatch({ type: "SET_TASKS", payload: tasks });
        const billable: Record<string, boolean> = {};
        const names: Record<string, string> = {};
        for (const t of tasks) {
          billable[t.id] = t.billable;
          names[t.id] = t.name;
        }
        dispatch({ type: "MERGE_TASK_BILLABLE", payload: billable });
        dispatch({ type: "MERGE_TASK_NAMES", payload: names });
        // Derived from the project's own tasks only. The tenant-wide global
        // default is billable and is appended to every project, so counting it
        // here would mark every project billable.
        const ownTasks = tasks.filter((t) => !t.defaultTemplate);
        if (ownTasks.length > 0) {
          dispatch({
            type: "MERGE_PROJECT_BILLABLE",
            payload: { [projectId]: ownTasks.some((t) => t.billable) },
          });
        }
      })
      .catch(() => {
        // Surfaced in the picker rather than swallowed — an unreachable task
        // list used to look identical to a project with no tasks.
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, api, dispatch]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onCloseRef.current?.();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const pickerState = describeTaskPickerState({ projectId, tasks: state.tasks, status });

  if (pickerState.kind === "hidden") return null;

  const rootClass = variant === "chip" ? "relative min-w-0 flex-1" : "relative min-w-0 w-full";
  const sizingClass = variant === "chip" ? "px-2.5 py-1.5 rounded-md" : "px-3 py-2 rounded-lg";
  const buttonClass = `flex w-full items-center justify-between gap-2 ${sizingClass} text-sm bg-bg-card border border-divider hover:border-border cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20`;

  const clipboardIcon = (
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
  );

  // A project the user cannot track must say why instead of rendering nothing.
  if (pickerState.kind === "notice") {
    return (
      <div className={rootClass}>
        <div
          className={`flex w-full items-center gap-2 ${sizingClass} text-sm bg-bg-card border border-divider text-text-muted cursor-not-allowed`}
          aria-disabled="true"
        >
          {clipboardIcon}
          <span className="truncate">{pickerState.label}</span>
        </div>
      </div>
    );
  }

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
          {clipboardIcon}
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
          className="fixed mt-1 bg-bg-card rounded-lg shadow-lg border border-divider z-50 py-1 max-h-56 overflow-y-auto"
          style={{
            // Anchor below the trigger, matching its width exactly.
            top: ref.current?.getBoundingClientRect().bottom,
            left: ref.current?.getBoundingClientRect().left,
            width: ref.current?.getBoundingClientRect().width,
          }}
        >
          {pickerState.rows
            .filter(({ task }) => !excludeIds?.has(task.id) || task.id === selectedId)
            .map(({ task, hint }) => (
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
                {hint && <span className="text-xs text-text-muted shrink-0">{hint}</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
