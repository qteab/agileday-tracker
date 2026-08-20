import { describe, it, expect } from "vitest";
import { resolveEntryBillable } from "../billable";

const taskBillable = { "task-billable": true, "task-internal": false };
const projectBillable = { "proj-with-billable-tasks": true, "proj-without": false };

describe("resolveEntryBillable", () => {
  it("uses the task's billable flag when the task is known", () => {
    expect(
      resolveEntryBillable(
        { taskId: "task-billable", projectId: "proj-without", projectType: "INTERNAL" },
        taskBillable,
        projectBillable
      )
    ).toBe(true);
    expect(
      resolveEntryBillable(
        { taskId: "task-internal", projectId: "proj-with-billable-tasks", projectType: "EXTERNAL" },
        taskBillable,
        projectBillable
      )
    ).toBe(false);
  });

  it("falls back to the project's task list when the task is unknown", () => {
    expect(
      resolveEntryBillable(
        { projectId: "proj-with-billable-tasks", projectType: "INTERNAL" },
        taskBillable,
        projectBillable
      )
    ).toBe(true);
    expect(
      resolveEntryBillable(
        { taskId: "unseen-task", projectId: "proj-without", projectType: "EXTERNAL" },
        taskBillable,
        projectBillable
      )
    ).toBe(false);
  });

  it("falls back to the project type when no task data is available", () => {
    expect(resolveEntryBillable({ projectId: "unknown", projectType: "EXTERNAL" }, {}, {})).toBe(
      true
    );
    expect(resolveEntryBillable({ projectId: "unknown", projectType: "INTERNAL" }, {}, {})).toBe(
      false
    );
    expect(resolveEntryBillable({ projectId: "unknown", projectType: "ABSENCE" }, {}, {})).toBe(
      false
    );
  });

  it("returns undefined when nothing is known", () => {
    expect(resolveEntryBillable({ projectId: "unknown" }, {}, {})).toBeUndefined();
  });
});
