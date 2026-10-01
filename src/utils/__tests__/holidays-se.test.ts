import { describe, it, expect } from "vitest";
import { swedishHolidays, holidaysInRange } from "../holidays-se";

function dateOf(year: number, name: string): string | undefined {
  return swedishHolidays(year).find((holiday) => holiday.name === name)?.date;
}

describe("swedishHolidays", () => {
  it("places the fixed-date holidays", () => {
    expect(dateOf(2026, "Nyårsdagen")).toBe("2026-01-01");
    expect(dateOf(2026, "Trettondedag jul")).toBe("2026-01-06");
    expect(dateOf(2026, "Första maj")).toBe("2026-05-01");
    expect(dateOf(2026, "Sveriges nationaldag")).toBe("2026-06-06");
    expect(dateOf(2026, "Juldagen")).toBe("2026-12-25");
    expect(dateOf(2026, "Annandag jul")).toBe("2026-12-26");
  });

  it("derives the Easter-relative holidays", () => {
    // Easter Sunday 2026 falls on 5 April.
    expect(dateOf(2026, "Påskdagen")).toBe("2026-04-05");
    expect(dateOf(2026, "Långfredagen")).toBe("2026-04-03");
    expect(dateOf(2026, "Annandag påsk")).toBe("2026-04-06");
    expect(dateOf(2026, "Kristi himmelsfärdsdag")).toBe("2026-05-14");
    expect(dateOf(2026, "Pingstdagen")).toBe("2026-05-24");
  });

  it("computes Easter correctly across years", () => {
    // Independently known Easter Sundays — the algorithm is easy to get subtly
    // wrong, so pin several years rather than one.
    expect(dateOf(2024, "Påskdagen")).toBe("2024-03-31");
    expect(dateOf(2025, "Påskdagen")).toBe("2025-04-20");
    expect(dateOf(2027, "Påskdagen")).toBe("2027-03-28");
    expect(dateOf(2030, "Påskdagen")).toBe("2030-04-21");
  });

  it("pins Midsommardagen to the Saturday in Jun 20-26", () => {
    for (const year of [2024, 2025, 2026, 2027, 2028]) {
      const date = dateOf(year, "Midsommardagen")!;
      const day = Number(date.slice(8, 10));
      expect(day).toBeGreaterThanOrEqual(20);
      expect(day).toBeLessThanOrEqual(26);
      expect(new Date(`${date}T00:00:00Z`).getUTCDay()).toBe(6);
    }
  });

  it("pins Alla helgons dag to the Saturday in Oct 31 - Nov 6", () => {
    for (const year of [2024, 2025, 2026, 2027, 2028]) {
      const date = dateOf(year, "Alla helgons dag")!;
      expect(new Date(`${date}T00:00:00Z`).getUTCDay()).toBe(6);
      expect(date >= `${year}-10-31` && date <= `${year}-11-06`).toBe(true);
    }
  });

  it("returns holidays in ascending date order", () => {
    const dates = swedishHolidays(2026).map((holiday) => holiday.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("holidaysInRange", () => {
  it("filters to the inclusive window", () => {
    const result = holidaysInRange("SE", "2026-12-25", "2026-12-26");
    expect(result.map((holiday) => holiday.date)).toEqual(["2026-12-25", "2026-12-26"]);
  });

  it("spans a year boundary", () => {
    const result = holidaysInRange("SE", "2026-12-24", "2027-01-07");
    expect(result.map((holiday) => holiday.date)).toEqual([
      "2026-12-25",
      "2026-12-26",
      "2027-01-01",
      "2027-01-06",
    ]);
  });

  it("returns [] for countries it doesn't know", () => {
    // Wrong holidays would be worse than none — a Finnish user would get a
    // flex balance computed against Swedish red days.
    expect(holidaysInRange("FI", "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("accepts a lowercase country code", () => {
    expect(holidaysInRange("se", "2026-01-01", "2026-01-01")).toHaveLength(1);
  });

  it("returns [] when the range is inverted or unparseable", () => {
    expect(holidaysInRange("SE", "2026-12-31", "2026-01-01")).toEqual([]);
    expect(holidaysInRange("SE", "not-a-date", "also-not")).toEqual([]);
  });
});
