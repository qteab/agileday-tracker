import { useState, useRef, useEffect, useLayoutEffect } from "react";

import { useApp, useApi } from "../store/context";
import { describeTaskPickerState, type TaskLoadStatus } from "../utils/task-picker";
import { BillableIndicator } from "./BillableIndicator";

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
  // Trigger rect, measured when the panel opens.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  // Load result for the project it was fetched for; any other project is still loading.
  const [loaded, setLoaded] = useState<{ projectId: string; status: TaskLoadStatus } | null>(null);
  const status: TaskLoadStatus = !projectId
    ? "ready"
    : loaded?.projectId === projectId
      ? loaded.status
      : "loading";
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  const selected = state.tasks.find((t) => t.id === selectedId);

  useEffect(() => {
    if (!projectId) {
      dispatch({ type: "SET_TASKS", payload: [] });
      return;
    }
    let cancelled = false;
    api
      .getTasks(projectId)
      .then((tasks) => {
        if (cancelled) return;
        setLoaded({ projectId, status: "ready" });
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
        if (!cancelled) setLoaded({ projectId, status: "error" });
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
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, []);

  const pickerState = describeTaskPickerState({ projectId, tasks: state.tasks, status });

  if (pickerState.kind === "hidden") return null;

  const rootClass = variant === "chip" ? "relative min-w-0 flex-1" : "relative min-w-0 w-full";
  const sizingClass = variant === "chip" ? "px-2.5 py-1.5 rounded-md" : "px-3 py-2 rounded-lg";
  const buttonClass = `flex w-full items-center justify-between gap-2 ${sizingClass} text-sm bg-bg-card border border-divider hover:border-border cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20`;

  const clipboardIcon = (
    <svg
      className="h-3.5 w-3.5 shrink-0 text-text-muted"
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
          className={`flex w-full items-center gap-2 ${sizingClass} cursor-not-allowed border border-divider bg-bg-card text-sm text-text-muted`}
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
        onClick={() => {
          setAnchor(ref.current?.getBoundingClientRect() ?? null);
          setOpen(!open);
        }}
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
          className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-divider bg-bg-card py-1 shadow-lg"
          style={{
            // Anchor below the trigger, matching its width exactly.
            top: anchor?.bottom,
            left: anchor?.left,
            width: anchor?.width,
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
                className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-bg/70 ${
                  task.id === selectedId ? "bg-primary/10" : ""
                }`}
              >
                <BillableIndicator billable={task.billable} />
                <span className="flex-1 truncate text-left">{task.name}</span>
                {hint && <span className="shrink-0 text-xs text-text-muted">{hint}</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
