import type { TimeEntry } from "../api/types";

/**
 * Resolve whether a tracked entry counts as billable.
 *
 * The authoritative flag lives on the AgileDay task, but not every entry can be
 * traced back to a task: entries topped up from the timesheet summary carry no
 * task id at all, and a project's task list can fail to load. Falling straight
 * back to "non-billable" in those cases silently understates billable time, so
 * fall back to project-level signals instead:
 *
 * 1. The task's own billable flag (source of truth).
 * 2. The project's task list — billable if the project has any billable task.
 * 3. The project type — external (customer) work is billable, internal work,
 *    absences and idle time are not.
 *
 * Returns undefined when nothing is known yet, so callers can keep such time
 * out of the split rather than guessing.
 */
export function resolveEntryBillable(
  entry: Pick<TimeEntry, "taskId" | "projectId" | "projectType">,
  taskBillableById: Record<string, boolean>,
  projectBillableById: Record<string, boolean>
): boolean | undefined {
  if (entry.taskId !== undefined && entry.taskId in taskBillableById) {
    return taskBillableById[entry.taskId];
  }
  if (entry.projectId in projectBillableById) {
    return projectBillableById[entry.projectId];
  }
  switch (entry.projectType) {
    case "EXTERNAL":
      return true;
    case "INTERNAL":
    case "ABSENCE":
    case "IDLE":
      return false;
    default:
      return undefined;
  }
}
