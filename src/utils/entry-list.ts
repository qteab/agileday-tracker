import type { ListAutoCollapse } from "../store/display-store";
import { fmtDate, getWeekStart } from "./week";

/** Monday (as YYYY-MM-DD) of the week containing a YYYY-MM-DD date. */
export function weekStartOf(date: string): string {
  return fmtDate(getWeekStart(new Date(date + "T12:00:00")));
}

/**
 * Whether an entry from `date` should start collapsed, given the user's
 * auto-collapse preference. `today` is a YYYY-MM-DD date.
 */
export function shouldAutoCollapse(mode: ListAutoCollapse, date: string, today: string): boolean {
  if (mode === "off") return false;
  if (mode === "days") return date < today;
  return weekStartOf(date) < weekStartOf(today);
}

/** Format a Mon–Sun week range like "Aug 17 – 23" or "Jul 28 – Aug 3". */
export function formatWeekRangeLabel(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const monStr = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const sunStr =
    monday.getMonth() === sunday.getMonth()
      ? sunday.toLocaleDateString("en-US", { day: "numeric" })
      : sunday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${monStr} – ${sunStr}`;
}

/**
 * Heading for a week group: the current and previous week get a relative name,
 * older weeks get their date range.
 */
export function formatWeekHeading(weekStart: string, today: string): string {
  const currentWeek = weekStartOf(today);
  if (weekStart === currentWeek) return "This week";
  const previous = new Date(currentWeek + "T12:00:00");
  previous.setDate(previous.getDate() - 7);
  if (weekStart === fmtDate(previous)) return "Last week";
  return formatWeekRangeLabel(new Date(weekStart + "T12:00:00"));
}
