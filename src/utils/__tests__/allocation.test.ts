import { describe, it, expect } from "vitest";
import { countWeekdays, normalizeAllocationPeriods } from "../allocation";

describe("countWeekdays", () => {
  it("counts Mon–Fri in an inclusive range", () => {
    // 2026-09-07 is a Monday
    expect(countWeekdays("2026-09-07", "2026-09-13")).toBe(5);
    expect(countWeekdays("2026-09-07", "2026-09-07")).toBe(1);
    expect(countWeekdays("2026-09-12", "2026-09-13")).toBe(0);
  });

  it("returns 0 for an inverted range", () => {
    expect(countWeekdays("2026-09-13", "2026-09-07")).toBe(0);
  });
});

describe("normalizeAllocationPeriods", () => {
  it("passes percentages through in allocation mode, sorted by start", () => {
    const out = normalizeAllocationPeriods(
      [
        { allocation: 50, hours: null, startDate: "2026-10-01" },
        { allocation: 100, hours: null, startDate: "2026-09-01" },
      ],
      "allocation",
      "2026-12-31"
    );
    expect(out).toEqual([
      { startDate: "2026-09-01", percentage: 100 },
      { startDate: "2026-10-01", percentage: 50 },
    ]);
  });

  it("never yields NaN when allocation is null or missing", () => {
    const out = normalizeAllocationPeriods(
      [{ allocation: null, startDate: "2026-09-01" }, { startDate: "2026-10-01" }],
      "allocation",
      "2026-12-31"
    );
    expect(out.map((p) => p.percentage)).toEqual([0, 0]);
    expect(out.every((p) => Number.isFinite(p.percentage))).toBe(true);
  });

  it("converts hours to a per-weekday percentage in hours mode", () => {
    // Week of Sep 7–13: 5 weekdays × 8h = 40h capacity; 20h → 50%
    const out = normalizeAllocationPeriods(
      [{ allocation: null, hours: 20, startDate: "2026-09-07" }],
      "hours",
      "2026-09-13"
    );
    expect(out).toEqual([{ startDate: "2026-09-07", percentage: 50 }]);
  });

  it("bounds a period by the next period's start in hours mode", () => {
    // First period: Sep 7 → Sep 13 (5 weekdays), 40h → 100%
    // Second period: Sep 14 → Sep 20 (5 weekdays), 10h → 25%
    const out = normalizeAllocationPeriods(
      [
        { hours: 10, startDate: "2026-09-14" },
        { hours: 40, startDate: "2026-09-07" },
      ],
      "hours",
      "2026-09-20"
    );
    expect(out).toEqual([
      { startDate: "2026-09-07", percentage: 100 },
      { startDate: "2026-09-14", percentage: 25 },
    ]);
  });

  it("yields 0 in hours mode when the span has no weekdays or no end date", () => {
    expect(
      normalizeAllocationPeriods([{ hours: 8, startDate: "2026-09-12" }], "hours", "2026-09-13")
    ).toEqual([{ startDate: "2026-09-12", percentage: 0 }]);
    expect(
      normalizeAllocationPeriods([{ hours: 8, startDate: "2026-09-07" }], "hours", null)
    ).toEqual([{ startDate: "2026-09-07", percentage: 0 }]);
  });

  it("handles null/empty input", () => {
    expect(normalizeAllocationPeriods(null, "allocation", null)).toEqual([]);
    expect(normalizeAllocationPeriods(undefined, "hours", null)).toEqual([]);
  });
});
