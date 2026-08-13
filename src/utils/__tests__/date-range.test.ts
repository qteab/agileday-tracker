import { describe, it, expect } from "vitest";
import { monthsInRange, addDays } from "../date-range";

describe("monthsInRange", () => {
  it("covers every month in a ±30-day window (the missing-August bug)", () => {
    // Window from 2026-08-13: today-30d → today+30d spans three calendar
    // months. Fetching only the first and last skipped August entirely.
    expect(monthsInRange("2026-07-14", "2026-09-12")).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
  });

  it("returns a single month when the range stays inside one", () => {
    expect(monthsInRange("2026-04-28", "2026-04-28")).toEqual(["2026-04-01"]);
    expect(monthsInRange("2026-04-01", "2026-04-30")).toEqual(["2026-04-01"]);
  });

  it("crosses a year boundary", () => {
    expect(monthsInRange("2025-12-20", "2026-01-10")).toEqual(["2025-12-01", "2026-01-01"]);
  });

  it("handles a range spanning more than a year", () => {
    expect(monthsInRange("2025-11-15", "2026-02-01")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  it("returns nothing when the range is inverted", () => {
    expect(monthsInRange("2026-09-12", "2026-07-14")).toEqual([]);
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("crosses a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("shifts backwards for negative n", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-07-14", -400)).toBe("2025-06-09");
  });

  it("returns the same date for n = 0", () => {
    expect(addDays("2026-08-13", 0)).toBe("2026-08-13");
  });
});
