import { describe, it, expect } from "vitest";
import { formatAway, computeDiscardStartTime } from "../inactivity";

describe("formatAway", () => {
  it("formats sub-hour idle as 0h Mm, flooring to the minute", () => {
    expect(formatAway(1230)).toBe("0h 20m"); // 20m30s → 20m
  });

  it("formats idle past an hour as Hh Mm", () => {
    expect(formatAway(3700)).toBe("1h 1m"); // 61m40s → 1h 1m
  });

  it("formats zero idle as 0h 0m", () => {
    expect(formatAway(0)).toBe("0h 0m");
  });
});

describe("computeDiscardStartTime", () => {
  it("shifts startTime forward by the away duration (so elapsed shrinks)", () => {
    const start = "2026-06-03T09:00:00.000Z";
    expect(computeDiscardStartTime(start, 1200)).toBe("2026-06-03T09:20:00.000Z");
  });

  it("returns the original start when nothing was away", () => {
    const start = "2026-06-03T09:00:00.000Z";
    expect(computeDiscardStartTime(start, 0)).toBe(start);
  });
});
