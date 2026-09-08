/**
 * Allocation-period normalization.
 *
 * AgileDay openings come in two `allocationMode`s. In "allocation" mode each
 * period carries a percentage in `allocation`; in "hours" mode `allocation` is
 * null and `hours` holds the total hours for the period instead. The UI only
 * reasons in percentages of an 8h workday, so we convert here and make sure
 * the result is always a finite number — a null/undefined slipping through
 * renders as "NaNh NaNm".
 */

import type { AllocationPeriod } from "../api/types";

export const WORKDAY_HOURS = 8;

export interface RawAllocationPeriod {
  allocation?: number | null;
  hours?: number | null;
  startDate: string;
}

/** Count Mon–Fri dates in the inclusive range [start, end]. */
export function countWeekdays(start: string, end: string): number {
  if (start > end) return 0;
  const cursor = new Date(start + "T12:00:00");
  const last = new Date(end + "T12:00:00");
  let count = 0;
  while (cursor <= last) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function finiteOrZero(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Turn raw API periods into percentage periods sorted by start date.
 *
 * For hours mode a period runs from its `startDate` up to (but not including)
 * the next period's `startDate`; the last period runs through the opening's
 * `endDate`. Hours are spread evenly across the weekdays in that span.
 */
export function normalizeAllocationPeriods(
  raw: RawAllocationPeriod[] | null | undefined,
  allocationMode: string | null | undefined,
  openingEndDate: string | null | undefined
): AllocationPeriod[] {
  const periods = (raw ?? [])
    .filter((p) => typeof p.startDate === "string" && p.startDate.length > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  if (allocationMode !== "hours") {
    return periods.map((p) => ({
      startDate: p.startDate,
      percentage: finiteOrZero(p.allocation),
    }));
  }

  return periods.map((p, i) => {
    const hours = finiteOrZero(p.hours);
    const next = periods[i + 1];
    // Exclusive next start → inclusive end is the day before.
    const end = next ? shiftDate(next.startDate, -1) : openingEndDate;
    const weekdays = end ? countWeekdays(p.startDate, end) : 0;
    const pct = weekdays > 0 ? (hours / (weekdays * WORKDAY_HOURS)) * 100 : 0;
    return { startDate: p.startDate, percentage: finiteOrZero(pct) };
  });
}

function shiftDate(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
