import { describe, it, expect } from "vitest";

import {
  findMergeTarget,
  toEntryCreate,
  toEntryPatch,
  toTimeEntry,
  type RawTimeEntry,
} from "../agileday-entries";
import type { TimeEntry } from "../types";

function raw(overrides: Partial<RawTimeEntry> = {}): RawTimeEntry {
  return {
    id: "e1",
    date: "2026-11-23",
    minutes: 60,
    status: "SAVED",
    projectId: "p1",
    ...overrides,
  };
}

describe("toTimeEntry", () => {
  it("maps the server's entry onto the app's shape", () => {
    expect(toTimeEntry(raw({ description: "wrote tests", taskId: "t1" }))).toMatchObject({
      id: "e1",
      description: "wrote tests",
      projectId: "p1",
      taskId: "t1",
      date: "2026-11-23",
      minutes: 60,
      status: "SAVED",
      syncStatus: "synced",
    });
  });

  it("falls back to the caller's description when the server returns none", () => {
    expect(toTimeEntry(raw(), { descriptionFallback: "local text" }).description).toBe(
      "local text"
    );
  });

  it("prefers the server's description over the fallback", () => {
    expect(
      toTimeEntry(raw({ description: "server text" }), { descriptionFallback: "local text" })
        .description
    ).toBe("server text");
  });

  it("uses an empty description when neither side has one", () => {
    expect(toTimeEntry(raw()).description).toBe("");
  });

  it("prefers the caller's project name over the server's", () => {
    expect(
      toTimeEntry(raw({ projectName: "From API" }), { projectName: "From app" }).projectName
    ).toBe("From app");
  });

  it("keeps the server's project name when the caller has none", () => {
    expect(toTimeEntry(raw({ projectName: "From API" })).projectName).toBe("From API");
  });

  it("defaults startTime to empty rather than inventing a clock time", () => {
    expect(toTimeEntry(raw()).startTime).toBe("");
  });
});

describe("toEntryPatch", () => {
  it("sends only the id when nothing else changed", () => {
    expect(toEntryPatch({ id: "e1" })).toEqual({ id: "e1" });
  });

  it("sends a cleared description", () => {
    expect(toEntryPatch({ id: "e1", description: "" })).toEqual({ id: "e1", description: "" });
  });

  it("sends a zero minute count", () => {
    expect(toEntryPatch({ id: "e1", minutes: 0 })).toEqual({ id: "e1", minutes: 0 });
  });

  it("sends every changed field", () => {
    const update: { id: string } & Partial<TimeEntry> = {
      id: "e1",
      description: "d",
      minutes: 30,
      projectId: "p2",
      openingId: "o1",
      taskId: "t1",
      status: "SAVED",
      date: "2026-11-24",
    };
    expect(toEntryPatch(update)).toEqual({
      id: "e1",
      description: "d",
      minutes: 30,
      projectId: "p2",
      openingId: "o1",
      taskId: "t1",
      status: "SAVED",
      date: "2026-11-24",
    });
  });

  it("omits blank ids rather than clearing them server-side", () => {
    expect(toEntryPatch({ id: "e1", projectId: "", taskId: "", date: "" })).toEqual({ id: "e1" });
  });
});

describe("toEntryCreate", () => {
  const entry: Omit<TimeEntry, "id" | "syncStatus"> = {
    description: "",
    projectId: "p1",
    date: "2026-11-23",
    startTime: "2026-11-23T09:00:00.000Z",
    minutes: 45,
    status: "NEW",
  };

  it("creates entries as SAVED whatever status the app holds", () => {
    expect(toEntryCreate(entry)).toEqual({
      date: "2026-11-23",
      minutes: 45,
      status: "SAVED",
      projectId: "p1",
    });
  });

  it("includes the optional ids and description when present", () => {
    expect(
      toEntryCreate({ ...entry, description: "d", taskId: "t1", openingId: "o1" })
    ).toMatchObject({ description: "d", taskId: "t1", openingId: "o1" });
  });
});

describe("findMergeTarget", () => {
  const entry = { projectId: "p1", date: "2026-11-23", taskId: "t1" };

  it("finds the entry for the same project, task and date", () => {
    const match = raw({ id: "match", taskId: "t1" });
    expect(findMergeTarget([match], entry, { allowSubmitted: false })).toBe(match);
  });

  it("ignores another project on the same day", () => {
    const other = raw({ projectId: "p2", taskId: "t1" });
    expect(findMergeTarget([other], entry, { allowSubmitted: false })).toBeUndefined();
  });

  it("ignores the same project on another day", () => {
    const other = raw({ date: "2026-11-24", taskId: "t1" });
    expect(findMergeTarget([other], entry, { allowSubmitted: false })).toBeUndefined();
  });

  it("ignores a different task on the same project and day", () => {
    const other = raw({ taskId: "t2" });
    expect(findMergeTarget([other], entry, { allowSubmitted: false })).toBeUndefined();
  });

  it("matches a task-less entry against a task-less save", () => {
    const match = raw({ id: "match" });
    expect(
      findMergeTarget([match], { projectId: "p1", date: "2026-11-23" }, { allowSubmitted: false })
    ).toBe(match);
  });

  it.each(["NEW", "SAVED", "CHANGE_REQUESTED"])("merges into a %s entry", (status) => {
    const match = raw({ id: "match", status, taskId: "t1" });
    expect(findMergeTarget([match], entry, { allowSubmitted: false })).toBe(match);
  });

  it("never merges into an APPROVED entry, even with auto-submit on", () => {
    const approved = raw({ status: "APPROVED", taskId: "t1" });
    expect(findMergeTarget([approved], entry, { allowSubmitted: true })).toBeUndefined();
  });

  it("leaves a SUBMITTED entry alone by default", () => {
    const submitted = raw({ status: "SUBMITTED", taskId: "t1" });
    expect(findMergeTarget([submitted], entry, { allowSubmitted: false })).toBeUndefined();
  });

  it("merges into a SUBMITTED entry when auto-submit is on", () => {
    const submitted = raw({ id: "match", status: "SUBMITTED", taskId: "t1" });
    expect(findMergeTarget([submitted], entry, { allowSubmitted: true })).toBe(submitted);
  });
});
