import { describe, it, expect } from "vitest";
import {
  getWeekStart,
  fmtDate,
  formatWeekLabel,
  getLastWeekRange,
  hasUnsubmittedEntries,
  getUnsubmittedWeeks,
  getAlertLevel,
  syncedOnly,
} from "../week";
import type { TimeEntry } from "../../api/types";

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "e1",
    description: "work",
    projectId: "p1",
    date: "2026-05-05",
    startTime: "2026-05-05T09:00:00Z",
    minutes: 60,
    status: "SAVED",
    syncStatus: "synced",
    ...overrides,
  };
}

// --- getWeekStart ---

describe("getWeekStart", () => {
  it("returns Monday for a Monday", () => {
    const mon = new Date("2026-05-04T10:00:00"); // Monday
    expect(fmtDate(getWeekStart(mon))).toBe("2026-05-04");
  });

  it("returns Monday for a Wednesday", () => {
    const wed = new Date("2026-05-06T10:00:00"); // Wednesday
    expect(fmtDate(getWeekStart(wed))).toBe("2026-05-04");
  });

  it("returns Monday for a Sunday", () => {
    const sun = new Date("2026-05-10T10:00:00"); // Sunday
    expect(fmtDate(getWeekStart(sun))).toBe("2026-05-04");
  });

  it("returns Monday for a Saturday", () => {
    const sat = new Date("2026-05-09T10:00:00"); // Saturday
    expect(fmtDate(getWeekStart(sat))).toBe("2026-05-04");
  });
});

// --- formatWeekLabel ---

describe("formatWeekLabel", () => {
  it("formats a same-month week", () => {
    const mon = new Date("2026-05-04T12:00:00");
    const label = formatWeekLabel(mon);
    expect(label).toContain("May");
    expect(label).toContain("4");
    expect(label).toContain("8");
  });
});

// --- getLastWeekRange ---

describe("getLastWeekRange", () => {
  it("returns previous Mon–Sun when called on Monday", () => {
    const monday = new Date("2026-05-11T09:00:00"); // Monday May 11
    const range = getLastWeekRange(monday);
    expect(range.start).toBe("2026-05-04"); // Previous Monday
    expect(range.end).toBe("2026-05-10"); // Previous Sunday
  });

  it("returns previous Mon–Sun when called on Wednesday", () => {
    const wed = new Date("2026-05-06T09:00:00"); // Wednesday May 6
    const range = getLastWeekRange(wed);
    expect(range.start).toBe("2026-04-27"); // Previous Monday
    expect(range.end).toBe("2026-05-03"); // Previous Sunday
  });

  it("returns previous Mon–Sun when called on Sunday", () => {
    const sun = new Date("2026-05-10T09:00:00"); // Sunday May 10
    const range = getLastWeekRange(sun);
    expect(range.start).toBe("2026-04-27");
    expect(range.end).toBe("2026-05-03");
  });
});

// --- syncedOnly ---

describe("syncedOnly", () => {
  it("filters out unsaved entries", () => {
    const entries = [
      makeEntry({ id: "e1", syncStatus: "synced" }),
      makeEntry({ id: "e2", syncStatus: "unsaved" }),
      makeEntry({ id: "e3", syncStatus: "pending" }),
    ];
    const result = syncedOnly(entries);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["e1", "e3"]);
  });
});

// --- hasUnsubmittedEntries ---

describe("hasUnsubmittedEntries", () => {
  const range = { start: "2026-05-04", end: "2026-05-10", label: "May 4 – 8" };

  it("returns true when SAVED entries exist in range", () => {
    const entries = [makeEntry({ date: "2026-05-05", status: "SAVED" })];
    expect(hasUnsubmittedEntries(entries, range)).toBe(true);
  });

  it("returns false when all entries are SUBMITTED", () => {
    const entries = [makeEntry({ date: "2026-05-05", status: "SUBMITTED" })];
    expect(hasUnsubmittedEntries(entries, range)).toBe(false);
  });

  it("returns false when all entries are APPROVED", () => {
    const entries = [makeEntry({ date: "2026-05-05", status: "APPROVED" })];
    expect(hasUnsubmittedEntries(entries, range)).toBe(false);
  });

  it("returns true with mixed SAVED and SUBMITTED", () => {
    const entries = [
      makeEntry({ id: "e1", date: "2026-05-05", status: "SUBMITTED" }),
      makeEntry({ id: "e2", date: "2026-05-06", status: "SAVED" }),
    ];
    expect(hasUnsubmittedEntries(entries, range)).toBe(true);
  });

  it("returns false when no entries in range", () => {
    const entries = [makeEntry({ date: "2026-04-28", status: "SAVED" })]; // outside range
    expect(hasUnsubmittedEntries(entries, range)).toBe(false);
  });

  it("returns false for empty entries", () => {
    expect(hasUnsubmittedEntries([], range)).toBe(false);
  });

  it("ignores unsaved entries", () => {
    const entries = [makeEntry({ date: "2026-05-05", status: "SAVED", syncStatus: "unsaved" })];
    expect(hasUnsubmittedEntries(entries, range)).toBe(false);
  });
});

// --- getUnsubmittedWeeks ---

describe("getUnsubmittedWeeks", () => {
  it("returns one week when only last week is unsubmitted", () => {
    const now = new Date("2026-05-11T09:00:00"); // Monday May 11
    const entries = [makeEntry({ date: "2026-05-05", status: "SAVED" })]; // prev week
    const weeks = getUnsubmittedWeeks(entries, now);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].start).toBe("2026-05-04");
  });

  it("returns multiple weeks when several are unsubmitted", () => {
    const now = new Date("2026-05-11T09:00:00");
    const entries = [
      makeEntry({ id: "e1", date: "2026-05-05", status: "SAVED" }), // week of May 4
      makeEntry({ id: "e2", date: "2026-04-28", status: "SAVED" }), // week of Apr 27
    ];
    const weeks = getUnsubmittedWeeks(entries, now);
    expect(weeks).toHaveLength(2);
  });

  it("excludes current week", () => {
    const now = new Date("2026-05-07T09:00:00"); // Wednesday May 7
    const entries = [
      makeEntry({ id: "e1", date: "2026-05-05", status: "SAVED" }), // current week (May 4)
    ];
    const weeks = getUnsubmittedWeeks(entries, now);
    expect(weeks).toHaveLength(0);
  });

  it("excludes fully submitted weeks", () => {
    const now = new Date("2026-05-11T09:00:00");
    const entries = [
      makeEntry({ id: "e1", date: "2026-05-05", status: "SUBMITTED" }),
      makeEntry({ id: "e2", date: "2026-05-06", status: "APPROVED" }),
    ];
    const weeks = getUnsubmittedWeeks(entries, now);
    expect(weeks).toHaveLength(0);
  });

  it("returns empty for no entries", () => {
    const now = new Date("2026-05-11T09:00:00");
    expect(getUnsubmittedWeeks([], now)).toEqual([]);
  });
});

// --- getAlertLevel ---

describe("getAlertLevel", () => {
  it("returns info on Monday 09:00", () => {
    expect(getAlertLevel(new Date("2026-05-11T09:00:00"))).toBe("info");
  });

  it("returns info on Monday 10:59", () => {
    expect(getAlertLevel(new Date("2026-05-11T10:59:00"))).toBe("info");
  });

  it("returns warning on Monday 11:00", () => {
    expect(getAlertLevel(new Date("2026-05-11T11:00:00"))).toBe("warning");
  });

  it("returns warning on Monday 11:59", () => {
    expect(getAlertLevel(new Date("2026-05-11T11:59:00"))).toBe("warning");
  });

  it("returns overdue on Monday 12:00", () => {
    expect(getAlertLevel(new Date("2026-05-11T12:00:00"))).toBe("overdue");
  });

  it("returns overdue on Monday 14:00", () => {
    expect(getAlertLevel(new Date("2026-05-11T14:00:00"))).toBe("overdue");
  });

  it("returns overdue on Tuesday", () => {
    expect(getAlertLevel(new Date("2026-05-12T09:00:00"))).toBe("overdue");
  });

  it("returns overdue on Friday", () => {
    expect(getAlertLevel(new Date("2026-05-15T09:00:00"))).toBe("overdue");
  });

  it("returns overdue on Sunday 23:59", () => {
    expect(getAlertLevel(new Date("2026-05-10T23:59:00"))).toBe("overdue");
  });

  it("returns info on Monday 00:00", () => {
    expect(getAlertLevel(new Date("2026-05-11T00:00:00"))).toBe("info");
  });
});
