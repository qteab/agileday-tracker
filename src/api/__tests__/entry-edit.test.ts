import { describe, it, expect } from "vitest";
import {
  parseDurationInput,
  formatDurationInput,
  computeRunningTimeEdit,
  isLocalOnlyEntry,
  usedTaskIds,
} from "../../components/entry-edit";
import type { TimeEntry } from "../types";

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: "e1",
    description: "",
    projectId: "p1",
    date: "2026-06-23",
    startTime: "2026-06-23T08:00:00.000Z",
    minutes: 60,
    status: "SAVED",
    syncStatus: "synced",
    ...overrides,
  };
}

describe("parseDurationInput", () => {
  it("parses H:MM", () => {
    expect(parseDurationInput("1:30")).toBe(90);
    expect(parseDurationInput("0:00")).toBe(0);
    expect(parseDurationInput("10:05")).toBe(605);
  });

  it("parses H:MM:SS, ignoring seconds", () => {
    expect(parseDurationInput("1:30:00")).toBe(90);
    expect(parseDurationInput("1:30:45")).toBe(90);
  });

  it("parses a plain minute count", () => {
    expect(parseDurationInput("90")).toBe(90);
    expect(parseDurationInput("0")).toBe(0);
  });

  it("trims surrounding whitespace", () => {
    expect(parseDurationInput("  2:00  ")).toBe(120);
  });

  it("rejects invalid input", () => {
    expect(parseDurationInput("")).toBeNull();
    expect(parseDurationInput("   ")).toBeNull();
    expect(parseDurationInput("abc")).toBeNull();
    expect(parseDurationInput("1:")).toBeNull();
    expect(parseDurationInput(":30")).toBeNull();
    expect(parseDurationInput("-1:00")).toBeNull();
    expect(parseDurationInput("-5")).toBeNull();
    expect(parseDurationInput("1:60")).toBeNull();
    expect(parseDurationInput("1:2:3:4")).toBeNull();
    expect(parseDurationInput("1.5")).toBeNull();
  });
});

describe("formatDurationInput", () => {
  it("formats minutes as H:MM", () => {
    expect(formatDurationInput(90)).toBe("1:30");
    expect(formatDurationInput(0)).toBe("0:00");
    expect(formatDurationInput(605)).toBe("10:05");
  });

  it("round-trips with parseDurationInput", () => {
    for (const m of [0, 5, 59, 60, 90, 125, 605]) {
      expect(parseDurationInput(formatDurationInput(m))).toBe(m);
    }
  });
});

describe("computeRunningTimeEdit", () => {
  it("sets the entered value as banked minutes and resets the start", () => {
    expect(computeRunningTimeEdit(120)).toEqual({ bankedMinutes: 120, resetStart: true });
    expect(computeRunningTimeEdit(0)).toEqual({ bankedMinutes: 0, resetStart: true });
  });

  it("clamps negatives to zero", () => {
    expect(computeRunningTimeEdit(-10)).toEqual({ bankedMinutes: 0, resetStart: true });
  });
});

describe("isLocalOnlyEntry", () => {
  it("is true for local-prefixed ids", () => {
    expect(isLocalOnlyEntry({ id: "local-abc" })).toBe(true);
  });

  it("is false for server ids", () => {
    expect(isLocalOnlyEntry({ id: "3c239de1-e3cc-484c-8a50-77635b73531a" })).toBe(false);
  });
});

describe("usedTaskIds", () => {
  it("collects task ids for the project+date, excluding self", () => {
    const entries = [
      entry({ id: "self", taskId: "t1" }),
      entry({ id: "e2", taskId: "t2" }),
      entry({ id: "e3", taskId: "t3" }),
    ];
    expect(usedTaskIds(entries, "self", "p1", "2026-06-23")).toEqual(new Set(["t2", "t3"]));
  });

  it("ignores other projects and dates", () => {
    const entries = [
      entry({ id: "e2", taskId: "t2", projectId: "other" }),
      entry({ id: "e3", taskId: "t3", date: "2026-06-22" }),
      entry({ id: "e4", taskId: "t4" }),
    ];
    expect(usedTaskIds(entries, "self", "p1", "2026-06-23")).toEqual(new Set(["t4"]));
  });

  it("skips entries without a task", () => {
    const entries = [entry({ id: "e2", taskId: undefined }), entry({ id: "e3", taskId: "t3" })];
    expect(usedTaskIds(entries, "self", "p1", "2026-06-23")).toEqual(new Set(["t3"]));
  });

  it("returns an empty set when none match", () => {
    expect(usedTaskIds([], "self", "p1", "2026-06-23")).toEqual(new Set());
  });
});
