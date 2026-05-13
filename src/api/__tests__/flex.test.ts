import { describe, it, expect } from "vitest";
import { calculateFlex, formatFlexMinutes } from "../../utils/flex";
import type { TimeEntry } from "../types";
import type { Holiday } from "../types";

/** Helper to create a minimal TimeEntry */
function entry(date: string, minutes: number, projectId = "p1"): TimeEntry {
  return {
    id: `e-${date}-${minutes}`,
    description: "test",
    projectId,
    date,
    startTime: `${date}T09:00:00Z`,
    endTime: `${date}T17:00:00Z`,
    minutes,
    status: "SAVED",
    syncStatus: "synced",
  };
}

// Reference: 2026-01-12 is a Monday
// Week of Jan 5-11: Mon Jan 5 through Sun Jan 11
// Week of Jan 12-18: Mon Jan 12 through Sun Jan 18

describe("calculateFlex", () => {
  const NO_HOLIDAYS: Holiday[] = [];

  it("returns initial balance when no days to count", () => {
    // startDate = Jan 11, reference = Jan 12 (Mon) → yesterday = Jan 11
    // firstDay = Jan 12, yesterday = Jan 11 → yesterday < firstDay → no weeks
    const result = calculateFlex([], "2026-01-11", 5, NO_HOLIDAYS, new Date("2026-01-12T12:00:00"));
    expect(result.totalMinutes).toBe(300); // 5h = 300m
    expect(result.weeks).toHaveLength(0);
  });

  it("40h week = 0 flex", () => {
    // startDate = Jan 4 (Sun), so counting starts Jan 5 (Mon)
    // reference = Jan 12 (Mon), so yesterday = Jan 11 (Sun) → full week Jan 5-11
    const entries = [
      entry("2026-01-05", 480), // Mon 8h
      entry("2026-01-06", 480), // Tue 8h
      entry("2026-01-07", 480), // Wed 8h
      entry("2026-01-08", 480), // Thu 8h
      entry("2026-01-09", 480), // Fri 8h
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      0,
      NO_HOLIDAYS,
      new Date("2026-01-12T12:00:00")
    );

    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0].workdays).toBe(5);
    expect(result.weeks[0].expectedMinutes).toBe(2400);
    expect(result.weeks[0].workedMinutes).toBe(2400);
    expect(result.weeks[0].deltaMinutes).toBe(0);
    expect(result.totalMinutes).toBe(0);
  });

  it("45h week = +5h flex", () => {
    const entries = [
      entry("2026-01-05", 540), // Mon 9h
      entry("2026-01-06", 540), // Tue 9h
      entry("2026-01-07", 540), // Wed 9h
      entry("2026-01-08", 540), // Thu 9h
      entry("2026-01-09", 540), // Fri 9h
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      0,
      NO_HOLIDAYS,
      new Date("2026-01-12T12:00:00")
    );

    expect(result.weeks[0].workedMinutes).toBe(2700); // 45h
    expect(result.weeks[0].deltaMinutes).toBe(300); // +5h
    expect(result.totalMinutes).toBe(300);
  });

  it("30h week = -10h flex", () => {
    const entries = [
      entry("2026-01-05", 360), // Mon 6h
      entry("2026-01-06", 360), // Tue 6h
      entry("2026-01-07", 360), // Wed 6h
      entry("2026-01-08", 360), // Thu 6h
      entry("2026-01-09", 360), // Fri 6h
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      0,
      NO_HOLIDAYS,
      new Date("2026-01-12T12:00:00")
    );

    expect(result.weeks[0].workedMinutes).toBe(1800); // 30h
    expect(result.weeks[0].deltaMinutes).toBe(-600); // -10h
    expect(result.totalMinutes).toBe(-600);
  });

  it("weekend work only counts if week exceeds expected hours", () => {
    // 32h on weekdays + 8h on Saturday = 40h total, expected 40h → 0 flex
    const entries = [
      entry("2026-01-05", 384), // Mon 6.4h
      entry("2026-01-06", 384), // Tue 6.4h
      entry("2026-01-07", 384), // Wed 6.4h
      entry("2026-01-08", 384), // Thu 6.4h
      entry("2026-01-09", 384), // Fri 6.4h
      entry("2026-01-10", 480), // Sat 8h
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      0,
      NO_HOLIDAYS,
      new Date("2026-01-12T12:00:00")
    );

    expect(result.weeks[0].workedMinutes).toBe(2400); // 40h
    expect(result.weeks[0].expectedMinutes).toBe(2400); // 5 workdays × 8h
    expect(result.weeks[0].deltaMinutes).toBe(0);
    expect(result.totalMinutes).toBe(0);
  });

  it("weekend work generates flex when week total exceeds expected", () => {
    // 40h on weekdays + 4h on Saturday = 44h total, expected 40h → +4h flex
    const entries = [
      entry("2026-01-05", 480), // Mon 8h
      entry("2026-01-06", 480), // Tue 8h
      entry("2026-01-07", 480), // Wed 8h
      entry("2026-01-08", 480), // Thu 8h
      entry("2026-01-09", 480), // Fri 8h
      entry("2026-01-10", 240), // Sat 4h
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      0,
      NO_HOLIDAYS,
      new Date("2026-01-12T12:00:00")
    );

    expect(result.weeks[0].workedMinutes).toBe(2640); // 44h
    expect(result.weeks[0].deltaMinutes).toBe(240); // +4h
    expect(result.totalMinutes).toBe(240);
  });

  it("holiday week: 1 holiday = 32h expected", () => {
    // Jan 6 is Epiphany (Tuesday)
    const holidays: Holiday[] = [{ date: "2026-01-06", name: "Epiphany" }];
    const entries = [
      entry("2026-01-05", 480), // Mon 8h
      // Tue is holiday
      entry("2026-01-07", 480), // Wed 8h
      entry("2026-01-08", 480), // Thu 8h
      entry("2026-01-09", 480), // Fri 8h
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      0,
      holidays,
      new Date("2026-01-12T12:00:00")
    );

    expect(result.weeks[0].workdays).toBe(4);
    expect(result.weeks[0].expectedMinutes).toBe(1920); // 32h
    expect(result.weeks[0].workedMinutes).toBe(1920); // 32h
    expect(result.weeks[0].deltaMinutes).toBe(0);
    expect(result.weeks[0].holidays).toEqual([{ date: "2026-01-06", name: "Epiphany" }]);
  });

  it("holiday week: 32h worked + 8h weekend = 0 flex (not +8)", () => {
    const holidays: Holiday[] = [{ date: "2026-01-06", name: "Epiphany" }];
    const entries = [
      entry("2026-01-05", 480), // Mon 8h
      // Tue is holiday
      entry("2026-01-07", 480), // Wed 8h
      entry("2026-01-08", 480), // Thu 8h
      entry("2026-01-09", 480), // Fri 8h
      entry("2026-01-10", 480), // Sat 8h
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      0,
      holidays,
      new Date("2026-01-12T12:00:00")
    );

    expect(result.weeks[0].expectedMinutes).toBe(1920); // 32h (4 workdays)
    expect(result.weeks[0].workedMinutes).toBe(2400); // 40h
    expect(result.weeks[0].deltaMinutes).toBe(480); // +8h flex
    // This IS +8h flex because they worked 40h when only 32h was expected
  });

  it("initial balance is carried forward", () => {
    const entries = [
      entry("2026-01-05", 480),
      entry("2026-01-06", 480),
      entry("2026-01-07", 480),
      entry("2026-01-08", 480),
      entry("2026-01-09", 480),
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      10,
      NO_HOLIDAYS,
      new Date("2026-01-12T12:00:00")
    );

    // 40h worked, 40h expected → 0 delta + 10h initial = 10h
    expect(result.totalMinutes).toBe(600); // 10h
  });

  it("negative initial balance works", () => {
    const entries = [
      entry("2026-01-05", 480),
      entry("2026-01-06", 480),
      entry("2026-01-07", 480),
      entry("2026-01-08", 480),
      entry("2026-01-09", 480),
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      -5,
      NO_HOLIDAYS,
      new Date("2026-01-12T12:00:00")
    );

    expect(result.totalMinutes).toBe(-300); // -5h
  });

  it("zero-entry week = -40h", () => {
    const result = calculateFlex([], "2026-01-04", 0, NO_HOLIDAYS, new Date("2026-01-12T12:00:00"));

    expect(result.weeks[0].workedMinutes).toBe(0);
    expect(result.weeks[0].expectedMinutes).toBe(2400);
    expect(result.weeks[0].deltaMinutes).toBe(-2400); // -40h
    expect(result.totalMinutes).toBe(-2400);
  });

  it("zero-entry holiday week = -32h (not -40h)", () => {
    const holidays: Holiday[] = [{ date: "2026-01-06", name: "Epiphany" }];
    const result = calculateFlex([], "2026-01-04", 0, holidays, new Date("2026-01-12T12:00:00"));

    expect(result.weeks[0].workdays).toBe(4);
    expect(result.weeks[0].expectedMinutes).toBe(1920); // 32h
    expect(result.weeks[0].deltaMinutes).toBe(-1920);
    expect(result.totalMinutes).toBe(-1920);
  });

  it("partial current week counts through yesterday only", () => {
    // reference = Wed Jan 7, so yesterday = Tue Jan 6
    // Only Mon + Tue count as workdays
    const entries = [
      entry("2026-01-05", 480), // Mon 8h
      entry("2026-01-06", 480), // Tue 8h
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      0,
      NO_HOLIDAYS,
      new Date("2026-01-07T12:00:00")
    );

    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0].workdays).toBe(2); // Mon + Tue only
    expect(result.weeks[0].expectedMinutes).toBe(960); // 16h
    expect(result.weeks[0].workedMinutes).toBe(960); // 16h
    expect(result.weeks[0].deltaMinutes).toBe(0);
    expect(result.weeks[0].isPartial).toBe(true);
  });

  it("excludes unsaved entries from calculation", () => {
    const entries: TimeEntry[] = [
      entry("2026-01-05", 480),
      { ...entry("2026-01-06", 480), syncStatus: "unsaved" },
      entry("2026-01-07", 480),
      entry("2026-01-08", 480),
      entry("2026-01-09", 480),
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      0,
      NO_HOLIDAYS,
      new Date("2026-01-12T12:00:00")
    );

    expect(result.weeks[0].workedMinutes).toBe(1920); // 32h (unsaved excluded)
    expect(result.weeks[0].deltaMinutes).toBe(-480); // -8h
  });

  it("handles multiple entries on the same day", () => {
    const entries = [
      entry("2026-01-05", 240), // Mon 4h
      entry("2026-01-05", 240), // Mon 4h (second entry)
      entry("2026-01-06", 480),
      entry("2026-01-07", 480),
      entry("2026-01-08", 480),
      entry("2026-01-09", 480),
    ];
    const result = calculateFlex(
      entries,
      "2026-01-04",
      0,
      NO_HOLIDAYS,
      new Date("2026-01-12T12:00:00")
    );

    expect(result.weeks[0].workedMinutes).toBe(2400); // 40h
    expect(result.weeks[0].deltaMinutes).toBe(0);
  });
});

describe("calculateFlex — multi-week integration", () => {
  it("calculates correctly across 3 weeks with holidays and weekend work", () => {
    // Week 1: Jan 5-11 — normal week, 42h worked (+2h flex)
    // Week 2: Jan 12-18 — Epiphany-like holiday on Wed, 32h expected, 36h worked (+4h flex)
    // Week 3: Jan 19-25 — partial (reference = Thu Jan 22), Mon-Wed counted, 24h expected, 20h worked (-4h flex)
    const holidays: Holiday[] = [{ date: "2026-01-14", name: "Test Holiday" }]; // Wed

    const entries = [
      // Week 1: 42h total
      entry("2026-01-05", 540), // Mon 9h
      entry("2026-01-06", 480), // Tue 8h
      entry("2026-01-07", 540), // Wed 9h
      entry("2026-01-08", 480), // Thu 8h
      entry("2026-01-09", 480), // Fri 8h
      // Week 2: 36h total (holiday on Wed, so 4 workdays × 8h = 32h expected)
      entry("2026-01-12", 480), // Mon 8h
      entry("2026-01-13", 480), // Tue 8h
      // Wed is holiday
      entry("2026-01-15", 540), // Thu 9h
      entry("2026-01-16", 540), // Fri 9h
      entry("2026-01-17", 120), // Sat 2h
      // Week 3: partial (through Wed Jan 21), 3 workdays × 8h = 24h expected
      entry("2026-01-19", 420), // Mon 7h
      entry("2026-01-20", 420), // Tue 7h
      entry("2026-01-21", 360), // Wed 6h
    ];

    const result = calculateFlex(
      entries,
      "2026-01-04", // start date (Sun)
      5, // initial +5h
      holidays,
      new Date("2026-01-22T12:00:00") // reference = Thu
    );

    expect(result.weeks).toHaveLength(3);

    // Week 1: 42h - 40h = +2h (120m)
    expect(result.weeks[0].workedMinutes).toBe(2520);
    expect(result.weeks[0].expectedMinutes).toBe(2400);
    expect(result.weeks[0].deltaMinutes).toBe(120);
    expect(result.weeks[0].isPartial).toBe(false);

    // Week 2: 36h - 32h = +4h (240m), has holiday
    expect(result.weeks[1].workedMinutes).toBe(2160);
    expect(result.weeks[1].expectedMinutes).toBe(1920);
    expect(result.weeks[1].deltaMinutes).toBe(240);
    expect(result.weeks[1].holidays).toEqual([{ date: "2026-01-14", name: "Test Holiday" }]);

    // Week 3: partial, 20h - 24h = -4h (-240m)
    expect(result.weeks[2].workedMinutes).toBe(1200);
    expect(result.weeks[2].expectedMinutes).toBe(1440);
    expect(result.weeks[2].deltaMinutes).toBe(-240);
    expect(result.weeks[2].isPartial).toBe(true);
    expect(result.weeks[2].workdays).toBe(3); // Mon, Tue, Wed

    // Total: 5h initial + 2h + 4h - 4h = 7h (420m)
    expect(result.totalMinutes).toBe(420);
  });

  it("handles start date mid-week (first week is partial)", () => {
    // Start date = Wed Jan 7, so counting starts Thu Jan 8
    // Only Thu + Fri count in week 1
    const entries = [
      entry("2026-01-08", 480), // Thu 8h
      entry("2026-01-09", 480), // Fri 8h
    ];
    const result = calculateFlex(
      entries,
      "2026-01-07",
      0,
      [],
      new Date("2026-01-12T12:00:00") // reference = Mon → yesterday = Sun
    );

    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0].workdays).toBe(2); // Thu + Fri
    expect(result.weeks[0].expectedMinutes).toBe(960); // 16h
    expect(result.weeks[0].workedMinutes).toBe(960);
    expect(result.weeks[0].deltaMinutes).toBe(0);
    expect(result.weeks[0].isPartial).toBe(true); // first week partial
  });
});

describe("formatFlexMinutes", () => {
  it("formats positive flex", () => {
    expect(formatFlexMinutes(150)).toBe("+2h 30m");
    expect(formatFlexMinutes(60)).toBe("+1h");
    expect(formatFlexMinutes(0)).toBe("+0h");
  });

  it("formats negative flex", () => {
    expect(formatFlexMinutes(-150)).toBe("-2h 30m");
    expect(formatFlexMinutes(-480)).toBe("-8h");
  });
});
