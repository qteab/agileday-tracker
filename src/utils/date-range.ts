/**
 * Date-range helpers for API queries.
 *
 * All dates are `YYYY-MM-DD` strings parsed at local noon, so DST shifts can
 * never roll a date across a day boundary.
 */

/** Shift a YYYY-MM-DD date string by n days (n may be negative). */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return fmt(d);
}

/**
 * Every month overlapping [startDate, endDate] as `YYYY-MM-01`, ascending and
 * inclusive. Returns [] if the range is inverted.
 *
 * A ±30-day window usually spans three calendar months, so callers must cover
 * all of them — taking only the first and last silently skips the middle month.
 */
export function monthsInRange(startDate: string, endDate: string): string[] {
  if (startDate > endDate) return [];

  const months: string[] = [];
  const cursor = new Date(startDate.substring(0, 7) + "-01T12:00:00");
  const lastMonth = endDate.substring(0, 7) + "-01";

  let month = fmt(cursor);
  while (month <= lastMonth) {
    months.push(month);
    cursor.setMonth(cursor.getMonth() + 1);
    month = fmt(cursor);
  }

  return months;
}

function fmt(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
