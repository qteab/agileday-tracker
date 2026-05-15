import { describe, it, expect } from "vitest";
import { ceilTo15, floorTo15, buildRoundingPlan, applyOverrides } from "../rounding";
import type { TimeEntry } from "../types";

// --- ceilTo15 ---

describe("ceilTo15", () => {
  it("returns 0 for 0", () => expect(ceilTo15(0)).toBe(0));
  it("returns 0 for negative", () => expect(ceilTo15(-5)).toBe(0));
  it("rounds 1 up to 15", () => expect(ceilTo15(1)).toBe(15));
  it("rounds 14 up to 15", () => expect(ceilTo15(14)).toBe(15));
  it("keeps 15 as 15", () => expect(ceilTo15(15)).toBe(15));
  it("rounds 16 up to 30", () => expect(ceilTo15(16)).toBe(30));
  it("rounds 59 up to 60", () => expect(ceilTo15(59)).toBe(60));
  it("keeps 60 as 60", () => expect(ceilTo15(60)).toBe(60));
  it("rounds 61 up to 75", () => expect(ceilTo15(61)).toBe(75));
  it("keeps 480 as 480", () => expect(ceilTo15(480)).toBe(480));
});

// --- floorTo15 ---

describe("floorTo15", () => {
  it("returns 0 for 0", () => expect(floorTo15(0)).toBe(0));
  it("returns 0 for negative", () => expect(floorTo15(-5)).toBe(0));
  it("floors 14 to 0", () => expect(floorTo15(14)).toBe(0));
  it("keeps 15 as 15", () => expect(floorTo15(15)).toBe(15));
  it("floors 16 to 15", () => expect(floorTo15(16)).toBe(15));
  it("floors 61 to 60", () => expect(floorTo15(61)).toBe(60));
  it("keeps 60 as 60", () => expect(floorTo15(60)).toBe(60));
});

// --- buildRoundingPlan ---

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "e1",
    description: "test work",
    projectId: "p1",
    projectName: "Fokus",
    date: "2026-05-05",
    startTime: "2026-05-05T09:00:00Z",
    minutes: 60,
    status: "SAVED",
    syncStatus: "synced",
    ...overrides,
  };
}

describe("buildRoundingPlan", () => {
  it("returns empty array for empty input", () => {
    expect(buildRoundingPlan([])).toEqual([]);
  });

  it("groups entries by project AND day", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 47 }),
      makeEntry({ id: "e2", projectId: "p1", date: "2026-05-05", minutes: 33 }),
    ];
    const plan = buildRoundingPlan(entries);

    expect(plan).toHaveLength(1);
    expect(plan[0].projectId).toBe("p1");
    expect(plan[0].date).toBe("2026-05-05");
    expect(plan[0].totalMinutes).toBe(80); // 47 + 33
    expect(plan[0].roundedTotal).toBe(90); // ceil(80/15)*15
    expect(plan[0].difference).toBe(10);
  });

  it("same project on different days produces separate groups", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 47 }),
      makeEntry({ id: "e2", projectId: "p1", date: "2026-05-06", minutes: 33 }),
    ];
    const plan = buildRoundingPlan(entries);

    expect(plan).toHaveLength(2);

    const mon = plan.find((p) => p.date === "2026-05-05")!;
    const tue = plan.find((p) => p.date === "2026-05-06")!;

    expect(mon.totalMinutes).toBe(47);
    expect(mon.roundedTotal).toBe(60); // ceil(47/15)*15
    expect(tue.totalMinutes).toBe(33);
    expect(tue.roundedTotal).toBe(45); // ceil(33/15)*15
  });

  it("adjusts the largest entry to absorb the difference", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 47 }), // largest
      makeEntry({ id: "e2", projectId: "p1", date: "2026-05-05", minutes: 33 }),
    ];
    const plan = buildRoundingPlan(entries);
    const adjusted = plan[0].entries.find((e) => e.isAdjusted);
    const unchanged = plan[0].entries.find((e) => !e.isAdjusted);

    expect(adjusted?.id).toBe("e1"); // largest gets adjusted
    expect(adjusted?.currentMinutes).toBe(47);
    expect(adjusted?.adjustedMinutes).toBe(57); // 47 + 10
    expect(unchanged?.id).toBe("e2");
    expect(unchanged?.adjustedMinutes).toBe(33); // unchanged
  });

  it("no adjustment needed when total is already a multiple of 15", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 45 }),
      makeEntry({ id: "e2", projectId: "p1", date: "2026-05-05", minutes: 30 }),
    ];
    const plan = buildRoundingPlan(entries);

    expect(plan[0].totalMinutes).toBe(75);
    expect(plan[0].roundedTotal).toBe(75);
    expect(plan[0].difference).toBe(0);
    expect(plan[0].entries.every((e) => !e.isAdjusted)).toBe(true);
    expect(plan[0].entries.every((e) => e.adjustedMinutes === e.currentMinutes)).toBe(true);
  });

  it("handles single entry per project-day", () => {
    const entries = [makeEntry({ id: "e1", projectId: "p1", minutes: 47 })];
    const plan = buildRoundingPlan(entries);

    expect(plan[0].totalMinutes).toBe(47);
    expect(plan[0].roundedTotal).toBe(60);
    expect(plan[0].difference).toBe(13);
    expect(plan[0].entries[0].adjustedMinutes).toBe(60);
    expect(plan[0].entries[0].isAdjusted).toBe(true);
  });

  it("handles multiple projects on same day separately", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", projectName: "A", date: "2026-05-05", minutes: 47 }),
      makeEntry({ id: "e2", projectId: "p2", projectName: "B", date: "2026-05-05", minutes: 22 }),
    ];
    const plan = buildRoundingPlan(entries);

    expect(plan).toHaveLength(2);
    const p1 = plan.find((p) => p.projectId === "p1")!;
    const p2 = plan.find((p) => p.projectId === "p2")!;

    expect(p1.totalMinutes).toBe(47);
    expect(p1.roundedTotal).toBe(60);
    expect(p2.totalMinutes).toBe(22);
    expect(p2.roundedTotal).toBe(30);
  });

  it("excludes SUBMITTED entries from the total and never adjusts them", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 47, status: "SAVED" }),
      makeEntry({
        id: "e2",
        projectId: "p1",
        date: "2026-05-05",
        minutes: 30,
        status: "SUBMITTED",
      }),
    ];
    const plan = buildRoundingPlan(entries);

    // Only SAVED entry counted in total
    expect(plan[0].totalMinutes).toBe(47);
    expect(plan[0].roundedTotal).toBe(60);

    const submitted = plan[0].entries.find((e) => e.id === "e2");
    expect(submitted?.isAdjusted).toBe(false);
    expect(submitted?.adjustedMinutes).toBe(30); // unchanged
  });

  it("excludes APPROVED entries from the total and never adjusts them", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 22, status: "APPROVED" }),
    ];
    const plan = buildRoundingPlan(entries);

    expect(plan[0].totalMinutes).toBe(0); // no SAVED entries
    expect(plan[0].roundedTotal).toBe(0);
    expect(plan[0].difference).toBe(0);
    expect(plan[0].entries[0].isAdjusted).toBe(false);
  });

  it("handles zero-minute project-day total", () => {
    const entries = [makeEntry({ id: "e1", projectId: "p1", minutes: 0 })];
    const plan = buildRoundingPlan(entries);

    expect(plan[0].totalMinutes).toBe(0);
    expect(plan[0].roundedTotal).toBe(0);
    expect(plan[0].difference).toBe(0);
  });

  it("real-world: entries across multiple days for one project", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 480 }), // 8h Mon
      makeEntry({ id: "e2", projectId: "p1", date: "2026-05-06", minutes: 467 }), // 7:47 Tue
      makeEntry({ id: "e3", projectId: "p1", date: "2026-05-07", minutes: 480 }), // 8h Wed
    ];
    const plan = buildRoundingPlan(entries);

    // Each day is a separate group
    expect(plan).toHaveLength(3);

    const mon = plan.find((p) => p.date === "2026-05-05")!;
    const tue = plan.find((p) => p.date === "2026-05-06")!;
    const wed = plan.find((p) => p.date === "2026-05-07")!;

    // Monday: 480 is already multiple of 15 → no rounding
    expect(mon.totalMinutes).toBe(480);
    expect(mon.roundedTotal).toBe(480);
    expect(mon.difference).toBe(0);

    // Tuesday: 467 → ceil to 480
    expect(tue.totalMinutes).toBe(467);
    expect(tue.roundedTotal).toBe(480);
    expect(tue.difference).toBe(13);

    // Wednesday: 480 is already multiple of 15 → no rounding
    expect(wed.totalMinutes).toBe(480);
    expect(wed.roundedTotal).toBe(480);
    expect(wed.difference).toBe(0);
  });

  it("preserves entry metadata", () => {
    const entries = [
      makeEntry({
        id: "e1",
        projectId: "p1",
        projectName: "DHL",
        description: "- review",
        date: "2026-05-07",
        minutes: 47,
      }),
    ];
    const plan = buildRoundingPlan(entries);
    const entry = plan[0].entries[0];

    expect(entry.id).toBe("e1");
    expect(entry.date).toBe("2026-05-07");
    expect(entry.projectName).toBe("DHL");
    expect(entry.description).toBe("- review");
    expect(entry.status).toBe("SAVED");
  });
});

// --- applyOverrides ---

describe("applyOverrides", () => {
  it("returns plan unchanged when no overrides", () => {
    const entries = [makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 47 })];
    const plan = buildRoundingPlan(entries);
    const result = applyOverrides(plan, new Map());

    expect(result).toEqual(plan);
  });

  it("reduces rounded total when override is lower than auto-rounded", () => {
    // 61 min → auto-rounds to 75, override to 60
    const entries = [makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 61 })];
    const plan = buildRoundingPlan(entries);
    const overrides = new Map([["p1:2026-05-05", 60]]);
    const result = applyOverrides(plan, overrides);

    expect(result[0].roundedTotal).toBe(60);
    expect(result[0].difference).toBe(-1); // 60 - 61
    expect(result[0].entries[0].adjustedMinutes).toBe(60);
    expect(result[0].entries[0].isAdjusted).toBe(true);
  });

  it("sets difference to 0 when override equals total", () => {
    // 61 min → override to 61... but override must be multiple of 15
    // So let's use 60 min → auto-rounds to 60, override stays 60
    const entries = [makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 60 })];
    const plan = buildRoundingPlan(entries);
    const overrides = new Map([["p1:2026-05-05", 60]]);
    const result = applyOverrides(plan, overrides);

    expect(result[0].roundedTotal).toBe(60);
    expect(result[0].difference).toBe(0);
    expect(result[0].entries[0].isAdjusted).toBe(false);
  });

  it("adjusts the largest entry when override changes difference", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 47 }), // largest
      makeEntry({ id: "e2", projectId: "p1", date: "2026-05-05", minutes: 33 }),
    ];
    const plan = buildRoundingPlan(entries);
    // Auto: total=80, rounded=90, diff=10 → e1 gets 57
    // Override: rounded=75, diff=-5 → e1 gets 42
    const overrides = new Map([["p1:2026-05-05", 75]]);
    const result = applyOverrides(plan, overrides);

    expect(result[0].roundedTotal).toBe(75);
    expect(result[0].difference).toBe(-5);

    const adjusted = result[0].entries.find((e) => e.id === "e1")!;
    expect(adjusted.adjustedMinutes).toBe(42); // 47 - 5
    expect(adjusted.isAdjusted).toBe(true);

    const unchanged = result[0].entries.find((e) => e.id === "e2")!;
    expect(unchanged.adjustedMinutes).toBe(33);
    expect(unchanged.isAdjusted).toBe(false);
  });

  it("does not modify groups without overrides", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 47 }),
      makeEntry({ id: "e2", projectId: "p2", date: "2026-05-05", minutes: 22 }),
    ];
    const plan = buildRoundingPlan(entries);
    const overrides = new Map([["p1:2026-05-05", 45]]);
    const result = applyOverrides(plan, overrides);

    const p1 = result.find((p) => p.projectId === "p1")!;
    const p2 = result.find((p) => p.projectId === "p2")!;

    expect(p1.roundedTotal).toBe(45); // overridden
    expect(p2.roundedTotal).toBe(30); // unchanged auto-round
  });

  it("clamps override to not go below floorTo15 of total", () => {
    // 47 min → floor is 45, ceil is 60
    // User tries to override to 30 → should clamp to 45
    const entries = [makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 47 })];
    const plan = buildRoundingPlan(entries);
    const overrides = new Map([["p1:2026-05-05", 30]]);
    const result = applyOverrides(plan, overrides);

    expect(result[0].roundedTotal).toBe(45); // clamped to floor
    expect(result[0].difference).toBe(-2);
  });
});
