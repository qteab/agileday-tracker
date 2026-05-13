import type { Holiday } from "../api/types";

/** Check if a date string (YYYY-MM-DD) is a holiday */
export function isHoliday(dateStr: string, holidays: Holiday[]): boolean {
  return holidays.some((h) => h.date === dateStr);
}

/** Get the holiday name for a date, or undefined if not a holiday */
export function getHolidayName(dateStr: string, holidays: Holiday[]): string | undefined {
  return holidays.find((h) => h.date === dateStr)?.name;
}

/** Build a Set of holiday date strings for fast lookup */
export function holidaySet(holidays: Holiday[]): Set<string> {
  return new Set(holidays.map((h) => h.date));
}
