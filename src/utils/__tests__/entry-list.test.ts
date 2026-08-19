import { describe, it, expect } from "vitest";
import {
  weekStartOf,
  shouldAutoCollapse,
  formatWeekRangeLabel,
  formatWeekHeading,
} from "../entry-list";

describe("weekStartOf", () => {
  it("returns the Monday of the week", () => {
    expect(weekStartOf("2026-08-19")).toBe("2026-08-17"); // Wed → Mon
    expect(weekStartOf("2026-08-17")).toBe("2026-08-17"); // Mon → itself
    expect(weekStartOf("2026-08-23")).toBe("2026-08-17"); // Sun → same week's Mon
  });

  it("crosses month boundaries", () => {
    expect(weekStartOf("2026-08-02")).toBe("2026-07-27"); // Sun → previous Mon
  });
});

describe("shouldAutoCollapse", () => {
  const today = "2026-08-19"; // Wednesday

  it("collapses nothing when off", () => {
    expect(shouldAutoCollapse("off", today, today)).toBe(false);
    expect(shouldAutoCollapse("off", "2026-01-01", today)).toBe(false);
  });

  it("collapses everything before today in days mode", () => {
    expect(shouldAutoCollapse("days", today, today)).toBe(false);
    expect(shouldAutoCollapse("days", "2026-08-18", today)).toBe(true);
    expect(shouldAutoCollapse("days", "2026-08-17", today)).toBe(true);
  });

  it("keeps the current week expanded in weeks mode", () => {
    expect(shouldAutoCollapse("weeks", today, today)).toBe(false);
    expect(shouldAutoCollapse("weeks", "2026-08-17", today)).toBe(false); // Monday
    expect(shouldAutoCollapse("weeks", "2026-08-16", today)).toBe(true); // previous Sunday
    expect(shouldAutoCollapse("weeks", "2026-08-10", today)).toBe(true);
  });

  it("treats a Monday today as its own week", () => {
    expect(shouldAutoCollapse("weeks", "2026-08-17", "2026-08-17")).toBe(false);
    expect(shouldAutoCollapse("weeks", "2026-08-16", "2026-08-17")).toBe(true);
  });
});

describe("formatWeekRangeLabel", () => {
  it("omits the repeated month", () => {
    expect(formatWeekRangeLabel(new Date(2026, 7, 17))).toBe("Aug 17 – 23");
  });

  it("keeps both months when the week spans two", () => {
    expect(formatWeekRangeLabel(new Date(2026, 6, 27))).toBe("Jul 27 – Aug 2");
  });
});

describe("formatWeekHeading", () => {
  const today = "2026-08-19";

  it("names the current and previous week", () => {
    expect(formatWeekHeading("2026-08-17", today)).toBe("This week");
    expect(formatWeekHeading("2026-08-10", today)).toBe("Last week");
  });

  it("falls back to the date range for older weeks", () => {
    expect(formatWeekHeading("2026-08-03", today)).toBe("Aug 3 – 9");
  });
});
