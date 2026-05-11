import { describe, it, expect } from "vitest";
import { ceilTo15, buildRoundingPlan } from "../rounding";
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

  it("groups entries by project and computes rounded total", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", minutes: 47 }),
      makeEntry({ id: "e2", projectId: "p1", minutes: 33 }),
    ];
    const plan = buildRoundingPlan(entries);

    expect(plan).toHaveLength(1);
    expect(plan[0].projectId).toBe("p1");
    expect(plan[0].totalMinutes).toBe(80); // 47 + 33
    expect(plan[0].roundedTotal).toBe(90); // ceil(80/15)*15
    expect(plan[0].difference).toBe(10);
  });

  it("adjusts the largest entry to absorb the difference", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", minutes: 47 }), // largest
      makeEntry({ id: "e2", projectId: "p1", minutes: 33 }),
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
      makeEntry({ id: "e1", projectId: "p1", minutes: 45 }),
      makeEntry({ id: "e2", projectId: "p1", minutes: 30 }),
    ];
    const plan = buildRoundingPlan(entries);

    expect(plan[0].totalMinutes).toBe(75);
    expect(plan[0].roundedTotal).toBe(75);
    expect(plan[0].difference).toBe(0);
    expect(plan[0].entries.every((e) => !e.isAdjusted)).toBe(true);
    expect(plan[0].entries.every((e) => e.adjustedMinutes === e.currentMinutes)).toBe(true);
  });

  it("handles single entry per project", () => {
    const entries = [makeEntry({ id: "e1", projectId: "p1", minutes: 47 })];
    const plan = buildRoundingPlan(entries);

    expect(plan[0].totalMinutes).toBe(47);
    expect(plan[0].roundedTotal).toBe(60);
    expect(plan[0].difference).toBe(13);
    expect(plan[0].entries[0].adjustedMinutes).toBe(60);
    expect(plan[0].entries[0].isAdjusted).toBe(true);
  });

  it("handles multiple projects separately", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", projectName: "A", minutes: 47 }),
      makeEntry({ id: "e2", projectId: "p2", projectName: "B", minutes: 22 }),
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
      makeEntry({ id: "e1", projectId: "p1", minutes: 47, status: "SAVED" }),
      makeEntry({ id: "e2", projectId: "p1", minutes: 30, status: "SUBMITTED" }),
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
    const entries = [makeEntry({ id: "e1", projectId: "p1", minutes: 22, status: "APPROVED" })];
    const plan = buildRoundingPlan(entries);

    expect(plan[0].totalMinutes).toBe(0); // no SAVED entries
    expect(plan[0].roundedTotal).toBe(0);
    expect(plan[0].difference).toBe(0);
    expect(plan[0].entries[0].isAdjusted).toBe(false);
  });

  it("handles zero-minute project total", () => {
    const entries = [makeEntry({ id: "e1", projectId: "p1", minutes: 0 })];
    const plan = buildRoundingPlan(entries);

    expect(plan[0].totalMinutes).toBe(0);
    expect(plan[0].roundedTotal).toBe(0);
    expect(plan[0].difference).toBe(0);
  });

  it("real-world: 3 entries across a week for one project", () => {
    const entries = [
      makeEntry({ id: "e1", projectId: "p1", date: "2026-05-05", minutes: 480 }), // 8h Mon
      makeEntry({ id: "e2", projectId: "p1", date: "2026-05-06", minutes: 467 }), // 7:47 Tue
      makeEntry({ id: "e3", projectId: "p1", date: "2026-05-07", minutes: 480 }), // 8h Wed
    ];
    const plan = buildRoundingPlan(entries);

    expect(plan[0].totalMinutes).toBe(1427); // 480+467+480
    expect(plan[0].roundedTotal).toBe(1440); // ceil(1427/15)*15
    expect(plan[0].difference).toBe(13);

    // e1 is largest (same as e3, first wins in reduce), gets +13
    const adjusted = plan[0].entries.find((e) => e.isAdjusted)!;
    expect(adjusted.adjustedMinutes).toBe(adjusted.currentMinutes + 13);
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
