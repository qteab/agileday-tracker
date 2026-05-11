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
  const monStr = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const friStr =
    monday.getMonth() === friday.getMonth()
      ? friday.toLocaleDateString("en-US", { day: "numeric" })
      : friday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${monStr} – ${friStr}`;
}

export interface WeekRange {
  start: string;
  end: string;
  label: string;
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

/** Get all week ranges from entries, excluding the current week */
export function getPastWeekRanges(entries: TimeEntry[], now: Date): WeekRange[] {
  const currentWeekStart = fmtDate(getWeekStart(now));
  const weekMap = new Map<string, WeekRange>();

  for (const entry of entries) {
    const d = new Date(entry.date + "T12:00:00");
    const monday = getWeekStart(d);
    const key = fmtDate(monday);
    if (key === currentWeekStart) continue; // exclude current week
    if (!weekMap.has(key)) {
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      weekMap.set(key, {
        start: key,
        end: fmtDate(sunday),
        label: formatWeekLabel(monday),
      });
    }
  }

  return [...weekMap.values()].sort((a, b) => b.start.localeCompare(a.start));
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

/** Get all past weeks that have unsubmitted entries */
export function getUnsubmittedWeeks(entries: TimeEntry[], now: Date): WeekRange[] {
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
