import { describe, it, expect } from "vitest";
import {
  describeTaskPickerState,
  GLOBAL_DEFAULT_HINT,
  NO_TASKS_LABEL,
  TASKS_ERROR_LABEL,
} from "../task-picker";
import type { Task } from "../../api/types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    projectId: "p1",
    name: "Own task",
    billable: true,
    active: true,
    ...overrides,
  };
}

describe("describeTaskPickerState", () => {
  it("renders nothing when no project is selected", () => {
    const state = describeTaskPickerState({ projectId: null, tasks: [], status: "ready" });

    expect(state.kind).toBe("hidden");
  });

  it("renders nothing while the task list is still loading", () => {
    // Avoids flashing "No tasks available" before the fetch resolves.
    const state = describeTaskPickerState({ projectId: "p1", tasks: [], status: "loading" });

    expect(state.kind).toBe("hidden");
  });

  it("reports an empty project instead of disappearing", () => {
    const state = describeTaskPickerState({ projectId: "p1", tasks: [], status: "ready" });

    expect(state).toEqual({ kind: "notice", label: NO_TASKS_LABEL });
    expect(NO_TASKS_LABEL).toBe("No tasks available");
  });

  it("reports a failed fetch distinctly from an empty project", () => {
    const state = describeTaskPickerState({ projectId: "p1", tasks: [], status: "error" });

    expect(state).toEqual({ kind: "notice", label: TASKS_ERROR_LABEL });
    expect(TASKS_ERROR_LABEL).toBe("Couldn't load tasks");
    expect(TASKS_ERROR_LABEL).not.toBe(NO_TASKS_LABEL);
  });

  it("prefers the error notice over stale tasks from a previous project", () => {
    const state = describeTaskPickerState({
      projectId: "p2",
      tasks: [task()],
      status: "error",
    });

    expect(state).toEqual({ kind: "notice", label: TASKS_ERROR_LABEL });
  });

  it("lists selectable rows when tasks are available", () => {
    const state = describeTaskPickerState({
      projectId: "p1",
      tasks: [task({ id: "a" }), task({ id: "b" })],
      status: "ready",
    });

    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") throw new Error("expected ready");
    expect(state.rows.map((r) => r.task.id)).toEqual(["a", "b"]);
  });

  it("hints a global default so it reads like AgileDay's web UI", () => {
    const state = describeTaskPickerState({
      projectId: "p1",
      tasks: [task({ id: "own" }), task({ id: "global", defaultTemplate: true })],
      status: "ready",
    });

    if (state.kind !== "ready") throw new Error("expected ready");
    expect(state.rows[0].hint).toBeUndefined();
    expect(state.rows[1].hint).toBe(GLOBAL_DEFAULT_HINT);
    expect(GLOBAL_DEFAULT_HINT).toBe("(global default)");
  });

  it("drops inactive tasks from the rows", () => {
    const state = describeTaskPickerState({
      projectId: "p1",
      tasks: [task({ id: "a" }), task({ id: "b", active: false })],
      status: "ready",
    });

    if (state.kind !== "ready") throw new Error("expected ready");
    expect(state.rows.map((r) => r.task.id)).toEqual(["a"]);
  });

  it("shows the empty notice when every task is inactive", () => {
    const state = describeTaskPickerState({
      projectId: "p1",
      tasks: [task({ active: false })],
      status: "ready",
    });

    expect(state).toEqual({ kind: "notice", label: NO_TASKS_LABEL });
  });
});
