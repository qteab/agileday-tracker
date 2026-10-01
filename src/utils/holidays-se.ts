/**
 * Swedish public holidays, computed locally.
 *
 * The REST provider reads these from `/v1/workpackages/{country}/holidays`.
 * That endpoint is unreachable with an MCP-audience token and the MCP tool
 * surface has no holiday equivalent, so the beta provider computes them.
 *
 * This is a fair substitute rather than a workaround: Swedish röda dagar are
 * fully determined by the calendar and by Easter, so there is nothing for a
 * server to know that we can't derive. Only weekday holidays affect the flex
 * balance — `calculateFlex` already excludes weekends — but the full set is
 * returned so callers can render them.
 */

import type { Holiday } from "../api/types";

/** Country codes this module can answer for. */
export const SUPPORTED_HOLIDAY_COUNTRIES = ["SE"];

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIso(date: Date): string {
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Easter Sunday for a Gregorian year, via the anonymous Meeus algorithm.
 * Every movable Swedish holiday is an offset from this date.
 */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * The Saturday falling within an inclusive day range of a month — how Sweden
 * pins Midsommardagen (Jun 20-26) and Alla helgons dag (Oct 31 - Nov 6).
 */
function saturdayInRange(year: number, month: number, fromDay: number): Date {
  const start = new Date(Date.UTC(year, month - 1, fromDay));
  // 6 = Saturday. The range always spans a full week, so this always lands.
  return addDays(start, (6 - start.getUTCDay() + 7) % 7);
}

/** Every Swedish public holiday in `year`, ascending by date. */
export function swedishHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);

  const holidays: Holiday[] = [
    { date: iso(year, 1, 1), name: "Nyårsdagen" },
    { date: iso(year, 1, 6), name: "Trettondedag jul" },
    { date: toIso(addDays(easter, -2)), name: "Långfredagen" },
    { date: toIso(easter), name: "Påskdagen" },
    { date: toIso(addDays(easter, 1)), name: "Annandag påsk" },
    { date: iso(year, 5, 1), name: "Första maj" },
    { date: toIso(addDays(easter, 39)), name: "Kristi himmelsfärdsdag" },
    { date: toIso(addDays(easter, 49)), name: "Pingstdagen" },
    { date: iso(year, 6, 6), name: "Sveriges nationaldag" },
    { date: toIso(saturdayInRange(year, 6, 20)), name: "Midsommardagen" },
    { date: toIso(saturdayInRange(year, 10, 31)), name: "Alla helgons dag" },
    { date: iso(year, 12, 25), name: "Juldagen" },
    { date: iso(year, 12, 26), name: "Annandag jul" },
  ];

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Holidays for `countryCode` between two inclusive YYYY-MM-DD dates.
 * Returns [] for any country this module doesn't know, so an unsupported
 * tenant degrades to "no holidays" rather than to wrong holidays.
 */
export function holidaysInRange(
  countryCode: string,
  startDate: string,
  endDate: string
): Holiday[] {
  if (countryCode.toUpperCase() !== "SE") return [];
  if (startDate > endDate) return [];

  const firstYear = Number(startDate.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  if (!Number.isFinite(firstYear) || !Number.isFinite(lastYear)) return [];

  const out: Holiday[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    for (const holiday of swedishHolidays(year)) {
      if (holiday.date >= startDate && holiday.date <= endDate) out.push(holiday);
    }
  }
  return out;
}
