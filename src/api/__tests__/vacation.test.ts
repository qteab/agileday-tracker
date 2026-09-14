import { describe, it, expect } from "vitest";
import { calculateVacation, formatVacationDays } from "../../utils/vacation";
import type { TimeEntry } from "../types";

const VACATION_PROJECT = "vac-1";

/** Helper to create a minimal TimeEntry */
function entry(
  date: string,
  minutes: number,
  projectId = VACATION_PROJECT,
  syncStatus: TimeEntry["syncStatus"] = "synced"
): TimeEntry {
  return {
    id: `e-${projectId}-${date}-${minutes}`,
    description: "vacation",
    projectId,
    date,
    startTime: `${date}T09:00:00Z`,
    endTime: `${date}T17:00:00Z`,
    minutes,
    status: "SAVED",
    syncStatus,
  };
}

// Config: payslip month June 2026 → startDate 2026-06-30, counting from Jul 1.
const START = "2026-06-30";
const TODAY = new Date("2026-08-24T12:00:00"); // a Monday

describe("calculateVacation", () => {
  it("returns the initial balance when no vacation is logged", () => {
    const result = calculateVacation([], START, 25, VACATION_PROJECT, TODAY);
    expect(result.usedDays).toBe(0);
    expect(result.remainingDays).toBe(25);
    expect(result.plannedDays).toBe(0);
    expect(result.remainingAfterPlanned).toBe(25);
    expect(result.usedEntries).toHaveLength(0);
    expect(result.plannedEntries).toHaveLength(0);
  });

  it("counts a full 8h day as one vacation day", () => {
    const result = calculateVacation(
      [entry("2026-07-06", 480)],
      START,
      25,
      VACATION_PROJECT,
      TODAY
    );
    expect(result.usedDays).toBe(1);
    expect(result.remainingDays).toBe(24);
  });

  it("counts a 4h entry as half a day", () => {
    const result = calculateVacation(
      [entry("2026-07-06", 240)],
      START,
      25,
      VACATION_PROJECT,
      TODAY
    );
    expect(result.usedDays).toBe(0.5);
    expect(result.remainingDays).toBe(24.5);
  });

  it("sums several entries on the same date into one usage row", () => {
    const entries = [entry("2026-07-06", 240), entry("2026-07-06", 240)];
    const result = calculateVacation(entries, START, 25, VACATION_PROJECT, TODAY);
    expect(result.usedEntries).toHaveLength(1);
    expect(result.usedEntries[0]).toEqual({ date: "2026-07-06", minutes: 480, days: 1 });
    expect(result.usedDays).toBe(1);
  });

  it("ignores entries on other projects", () => {
    const entries = [entry("2026-07-06", 480, "work-project"), entry("2026-07-07", 480)];
    const result = calculateVacation(entries, START, 25, VACATION_PROJECT, TODAY);
    expect(result.usedDays).toBe(1);
  });

  it("ignores entries on or before the start date (covered by the payslip)", () => {
    const entries = [
      entry("2026-06-29", 480),
      entry("2026-06-30", 480), // start date itself
      entry("2026-07-01", 480), // first counted day
    ];
    const result = calculateVacation(entries, START, 25, VACATION_PROJECT, TODAY);
    expect(result.usedDays).toBe(1);
    expect(result.usedEntries[0].date).toBe("2026-07-01");
  });

  it("ignores unsaved entries", () => {
    const entries = [entry("2026-07-06", 480, VACATION_PROJECT, "unsaved")];
    const result = calculateVacation(entries, START, 25, VACATION_PROJECT, TODAY);
    expect(result.usedDays).toBe(0);
  });

  it("splits used (through today) from planned (future) days", () => {
    const entries = [
      entry("2026-08-21", 480), // past Friday → used
      entry("2026-08-24", 480), // today → used
      entry("2026-08-31", 480), // next Monday → planned
      entry("2026-09-01", 480), // planned
    ];
    const result = calculateVacation(entries, START, 25, VACATION_PROJECT, TODAY);
    expect(result.usedDays).toBe(2);
    expect(result.plannedDays).toBe(2);
    expect(result.remainingDays).toBe(23);
    expect(result.remainingAfterPlanned).toBe(21);
    expect(result.usedEntries.map((u) => u.date)).toEqual(["2026-08-21", "2026-08-24"]);
    expect(result.plannedEntries.map((u) => u.date)).toEqual(["2026-08-31", "2026-09-01"]);
  });

  it("sorts usage rows by date even when entries arrive unordered", () => {
    const entries = [entry("2026-07-10", 480), entry("2026-07-06", 480), entry("2026-07-08", 480)];
    const result = calculateVacation(entries, START, 25, VACATION_PROJECT, TODAY);
    expect(result.usedEntries.map((u) => u.date)).toEqual([
      "2026-07-06",
      "2026-07-08",
      "2026-07-10",
    ]);
  });

  it("can go negative when more days are taken than the balance held", () => {
    const entries = [entry("2026-07-06", 480), entry("2026-07-07", 480)];
    const result = calculateVacation(entries, START, 1, VACATION_PROJECT, TODAY);
    expect(result.remainingDays).toBe(-1);
  });
});

describe("formatVacationDays", () => {
  it("drops trailing zeros on whole days", () => {
    expect(formatVacationDays(25)).toBe("25");
  });

  it("keeps halves and quarters", () => {
    expect(formatVacationDays(12.5)).toBe("12.5");
    expect(formatVacationDays(3.25)).toBe("3.25");
  });

  it("rounds float noise to two decimals", () => {
    expect(formatVacationDays(24.999999999)).toBe("25");
    expect(formatVacationDays(1 / 3)).toBe("0.33");
  });

  it("never shows negative zero", () => {
    expect(formatVacationDays(-0.0000001)).toBe("0");
  });
});
