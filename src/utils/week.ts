import type { TimeEntry } from "../api/types";

/** Get the Monday of the week containing the given date */
export function getWeekStart(ref: Date): Date {
  const day = ref.getDay();
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** Format date as YYYY-MM-DD using local time (not UTC) */
export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format week label like "May 4 – 8" or "Apr 28 – May 2" */
export function formatWeekLabel(monday: Date): string {
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return formatRangeLabel(monday, friday);
}

function formatRangeLabel(from: Date, to: Date): string {
  const fromStr = from.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const toStr =
    from.getMonth() === to.getMonth()
      ? to.toLocaleDateString("en-US", { day: "numeric" })
      : to.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fromStr} – ${toStr}`;
}

export interface WeekRange {
  start: string;
  end: string;
  label: string;
}

export interface TimesheetPeriod extends WeekRange {
  /** Monday of the week — the AgileDay timecard's `week` */
  weekStart: string;
  /** First day of the month — the AgileDay timecard's `month` */
  month: string;
}

/**
 * The timesheet a work date belongs to. AgileDay keeps one timecard per week
 * per month, so a week crossing a month boundary is two timesheets, each
 * submitted (and frozen) on its own.
 */
export function getTimesheetPeriod(date: string): TimesheetPeriod {
  const d = new Date(date + "T12:00:00");
  const monday = getWeekStart(d);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
  const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const start = monday < monthStart ? monthStart : monday;
  const end = sunday > monthEnd ? monthEnd : sunday;
  const isSplit = start !== monday || end !== sunday;
  return {
    start: fmtDate(start),
    end: fmtDate(end),
    label: isSplit ? formatRangeLabel(start, end) : formatWeekLabel(monday),
    weekStart: fmtDate(monday),
    month: fmtDate(monthStart),
  };
}

/** Filter out unsaved entries — they don't exist in AgileDay */
export function syncedOnly(entries: TimeEntry[]): TimeEntry[] {
  return entries.filter((e) => e.syncStatus !== "unsaved");
}

/** Get the previous week's Mon–Sun range */
export function getLastWeekRange(now: Date): WeekRange {
  const thisMonday = getWeekStart(now);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  return {
    start: fmtDate(lastMonday),
    end: fmtDate(lastSunday),
    label: formatWeekLabel(lastMonday),
  };
}

/** Get all timesheet periods from entries, excluding the current week */
export function getPastWeekRanges(entries: TimeEntry[], now: Date): TimesheetPeriod[] {
  const currentWeekStart = fmtDate(getWeekStart(now));
  const periods = new Map<string, TimesheetPeriod>();

  for (const entry of entries) {
    const period = getTimesheetPeriod(entry.date);
    if (period.weekStart === currentWeekStart) continue; // exclude current week
    periods.set(period.start, period);
  }

  return [...periods.values()].sort((a, b) => b.start.localeCompare(a.start));
}

/** Check if any synced SAVED entries exist in the given week range */
export function hasUnsubmittedEntries(entries: TimeEntry[], range: WeekRange): boolean {
  const synced = syncedOnly(entries);
  return synced.some(
    (e) =>
      e.date >= range.start &&
      e.date <= range.end &&
      e.status !== "SUBMITTED" &&
      e.status !== "APPROVED"
  );
}

/** Get all past timesheet periods that have unsubmitted entries */
export function getUnsubmittedWeeks(entries: TimeEntry[], now: Date): TimesheetPeriod[] {
  const pastWeeks = getPastWeekRanges(entries, now);
  return pastWeeks.filter((range) => hasUnsubmittedEntries(entries, range));
}

export type AlertLevel = "info" | "warning" | "overdue";

/**
 * Compute alert level based on current time:
 * - info:    Monday 00:00–10:59
 * - warning: Monday 11:00–11:59
 * - overdue: Monday 12:00+ or any other day (Tue–Sun)
 */
export function getAlertLevel(now: Date): AlertLevel {
  const day = now.getDay(); // 0=Sun, 1=Mon
  if (day !== 1) return "overdue"; // Not Monday → deadline passed
  const hour = now.getHours();
  if (hour < 11) return "info";
  if (hour < 12) return "warning";
  return "overdue";
}
