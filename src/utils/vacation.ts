import type { TimeEntry } from "../api/types";
import { fmtDate } from "./week";

/** A full vacation day is a normal 8h workday's worth of logged time. */
export const VACATION_DAY_MINUTES = 480;

export interface VacationDayUsage {
  date: string; // YYYY-MM-DD
  minutes: number; // total vacation minutes logged on that date
  days: number; // minutes / 480
}

export interface VacationResult {
  /** Days consumed from the day after startDate through today (inclusive). */
  usedDays: number;
  /** initialDays − usedDays. */
  remainingDays: number;
  /** Days logged on future dates (after today). */
  plannedDays: number;
  /** remainingDays − plannedDays. */
  remainingAfterPlanned: number;
  /** Taken vacation days, date-ascending. */
  usedEntries: VacationDayUsage[];
  /** Upcoming vacation days, date-ascending. */
  plannedEntries: VacationDayUsage[];
}

/**
 * Calculate the vacation day balance from entries on the vacation project.
 *
 * @param entries - All time entries in the relevant range (any project)
 * @param startDate - Counting starts the day AFTER this date (YYYY-MM-DD);
 *   days on/before it are already reflected in initialDays
 * @param initialDays - Vacation day balance as of startDate (from the payslip)
 * @param projectId - The vacation project whose entries consume days
 * @param referenceDate - "Today" — later dates count as planned, not used
 */
export function calculateVacation(
  entries: TimeEntry[],
  startDate: string,
  initialDays: number,
  projectId: string,
  referenceDate: Date
): VacationResult {
  const todayStr = fmtDate(referenceDate);

  // Sum vacation minutes per date (a day may hold several entries)
  const minutesByDate = new Map<string, number>();
  for (const entry of entries) {
    if (entry.projectId !== projectId) continue;
    if (entry.syncStatus === "unsaved") continue;
    if (entry.date <= startDate) continue;
    minutesByDate.set(entry.date, (minutesByDate.get(entry.date) ?? 0) + entry.minutes);
  }

  const usedEntries: VacationDayUsage[] = [];
  const plannedEntries: VacationDayUsage[] = [];
  for (const [date, minutes] of [...minutesByDate.entries()].sort()) {
    const usage = { date, minutes, days: minutes / VACATION_DAY_MINUTES };
    (date <= todayStr ? usedEntries : plannedEntries).push(usage);
  }

  const usedDays = usedEntries.reduce((sum, u) => sum + u.days, 0);
  const plannedDays = plannedEntries.reduce((sum, u) => sum + u.days, 0);
  const remainingDays = initialDays - usedDays;

  return {
    usedDays,
    remainingDays,
    plannedDays,
    remainingAfterPlanned: remainingDays - plannedDays,
    usedEntries,
    plannedEntries,
  };
}

/** Format a day count without trailing noise: 25, 12.5, 3.25 */
export function formatVacationDays(days: number): string {
  const rounded = Math.round(days * 100) / 100;
  // Avoid "-0" for tiny negative rounding artifacts
  return String(rounded === 0 ? 0 : rounded);
}
