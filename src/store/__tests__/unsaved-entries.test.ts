import { describe, it, expect } from "vitest";
import { appReducer, initialState } from "../reducer";
import type { TimeEntry } from "../../api/types";

const entry = (id: string, minutes: number, syncStatus: TimeEntry["syncStatus"]): TimeEntry => ({
  id,
  description: "",
  projectId: "p1",
  taskId: "t1",
  date: "2026-10-02",
  startTime: "",
  minutes,
  status: "SAVED",
  syncStatus,
});

describe("unsaved entries", () => {
  const withUnsaved = {
    ...initialState,
    entries: [entry("real-1", 90, "unsaved"), entry("local-1", 30, "unsaved")],
  };

  it("a sync keeps unsaved entries, the local copy winning over AgileDay's", () => {
    const next = appReducer(withUnsaved, {
      type: "SET_ENTRIES",
      payload: [entry("real-1", 60, "synced"), entry("real-2", 15, "synced")],
    });
    const byId = Object.fromEntries(next.entries.map((e) => [e.id, e]));
    expect(next.entries).toHaveLength(3);
    expect(byId["real-1"].minutes).toBe(90);
    expect(byId["real-1"].syncStatus).toBe("unsaved");
    expect(byId["local-1"].minutes).toBe(30);
    expect(byId["real-2"].minutes).toBe(15);
  });

  it("a sync replaces entries that saved fine", () => {
    const state = { ...initialState, entries: [entry("real-1", 90, "synced")] };
    const next = appReducer(state, {
      type: "SET_ENTRIES",
      payload: [entry("real-1", 60, "synced")],
    });
    expect(next.entries).toEqual([entry("real-1", 60, "synced")]);
  });

  it("RESTORE_UNSAVED lays persisted entries over loaded ones", () => {
    const loaded = { ...initialState, entries: [entry("real-1", 60, "synced")] };
    const next = appReducer(loaded, {
      type: "RESTORE_UNSAVED",
      payload: [entry("real-1", 90, "unsaved"), entry("local-1", 30, "unsaved")],
    });
    expect(next.entries.map((e) => [e.id, e.minutes])).toEqual([
      ["local-1", 30],
      ["real-1", 90],
    ]);
  });

  it("CLEAR_ENTRIES drops unsaved entries too (logout)", () => {
    expect(appReducer(withUnsaved, { type: "CLEAR_ENTRIES" }).entries).toEqual([]);
  });
});
