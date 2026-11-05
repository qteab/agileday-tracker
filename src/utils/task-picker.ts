import type { Task } from "../api/types";

/**
 * What the task picker should render, decided separately from how it renders.
 *
 * The picker used to return `null` whenever its task list was empty, which made
 * three different situations indistinguishable: no project chosen yet, a project
 * with no tasks, and a failed fetch. The 75 projects that own no tasks therefore
 * showed no picker at all and no explanation — the timer simply could not start.
 */

export const NO_TASKS_LABEL = "No tasks available";
export const TASKS_ERROR_LABEL = "Couldn't load tasks";

/** Mirrors AgileDay's web UI, which labels the tenant-level task this way. */
export const GLOBAL_DEFAULT_HINT = "(global default)";

export type TaskLoadStatus = "loading" | "ready" | "error";

export interface TaskPickerRow {
  task: Task;
  /** Set for tenant-level global defaults, absent for project-owned tasks. */
  hint?: string;
}

export type TaskPickerState =
  | { kind: "hidden" }
  | { kind: "notice"; label: string }
  | { kind: "ready"; rows: TaskPickerRow[] };

export function describeTaskPickerState(input: {
  projectId: string | null;
  tasks: readonly Task[];
  status: TaskLoadStatus;
}): TaskPickerState {
  const { projectId, tasks, status } = input;

  // Nothing selected yet is not a failure — there is simply nothing to pick.
  if (!projectId) return { kind: "hidden" };

  // Checked before the task list so a stale list from the previously selected
  // project cannot mask a failed fetch.
  if (status === "error") return { kind: "notice", label: TASKS_ERROR_LABEL };

  // Staying hidden while loading avoids flashing "No tasks available" for the
  // instant before the fetch resolves.
  if (status === "loading") return { kind: "hidden" };

  const rows = tasks
    .filter((task) => task.active)
    .map((task) => (task.defaultTemplate ? { task, hint: GLOBAL_DEFAULT_HINT } : { task }));

  if (rows.length === 0) return { kind: "notice", label: NO_TASKS_LABEL };

  return { kind: "ready", rows };
}
