import { describe, it, expect } from "vitest";
import { ringGeometry, CIRCUMFERENCE } from "../LoadingState";

describe("ringGeometry", () => {
  it("sweeps when there is no progress to report", () => {
    for (const progress of [undefined, null, { message: "Loading projects" }]) {
      const ring = ringGeometry(progress);
      expect(ring.determinate).toBe(false);
      expect(ring.percent).toBe(0);
    }
  });

  it("fills in proportion to the steps done", () => {
    const ring = ringGeometry({ message: "Fetching", current: 12, total: 40 });

    expect(ring.determinate).toBe(true);
    expect(ring.percent).toBe(30);
    // 30% complete leaves 70% of the circumference as the gap.
    expect(ring.dashOffset).toBeCloseTo(CIRCUMFERENCE * 0.7, 5);
  });

  it("draws an empty ring at zero and a full one at completion", () => {
    expect(ringGeometry({ message: "x", current: 0, total: 40 }).dashOffset).toBeCloseTo(
      CIRCUMFERENCE,
      5
    );
    expect(ringGeometry({ message: "x", current: 40, total: 40 }).dashOffset).toBeCloseTo(0, 5);
  });

  it("clamps a miscounted step instead of overshooting the ring", () => {
    // A retried week could push `current` past `total`; the arc must not wrap.
    const ring = ringGeometry({ message: "x", current: 55, total: 40 });

    expect(ring.percent).toBe(100);
    expect(ring.dashOffset).toBeCloseTo(0, 5);
  });

  it("clamps a negative count to an empty ring", () => {
    const ring = ringGeometry({ message: "x", current: -3, total: 40 });

    expect(ring.percent).toBe(0);
    expect(ring.dashOffset).toBeCloseTo(CIRCUMFERENCE, 5);
  });

  it("sweeps rather than dividing by a zero or nonsense total", () => {
    // A zero total would otherwise produce NaN and blank the arc entirely.
    expect(ringGeometry({ message: "x", current: 3, total: 0 }).determinate).toBe(false);
    expect(ringGeometry({ message: "x", current: 3, total: -1 }).determinate).toBe(false);
    expect(ringGeometry({ message: "x", current: 3, total: NaN }).determinate).toBe(false);
    expect(ringGeometry({ message: "x", current: NaN, total: 10 }).determinate).toBe(false);
  });

  it("keeps the sweeping arc short enough to read as motion", () => {
    const ring = ringGeometry({ message: "x" });

    // A full-circumference offset would render nothing at all.
    expect(ring.dashOffset).toBeGreaterThan(0);
    expect(ring.dashOffset).toBeLessThan(CIRCUMFERENCE);
  });
});
