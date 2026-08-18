import type { TimeEntry } from "../api/types";
import type { Holiday } from "../api/types";
import { getWeekStart, fmtDate, formatWeekLabel } from "./week";
import { holidaySet } from "./holidays";

export interface FlexWeek {
  weekLabel: string;
  startDate: string; // Monday YYYY-MM-DD
  workdays: number; // Mon-Fri minus holidays (0-5)
  expectedMinutes: number; // workdays × 480
  workedMinutes: number; // sum of all entries Mon-Sun
  deltaMinutes: number; // worked - expected
  holidays: { date: string; name: string }[];
  isPartial: boolean; // true for current incomplete week
}

export interface FlexResult {
  totalMinutes: number; // initialHours*60 + sum of all weekly deltas
  weeks: FlexWeek[];
}

const WORKDAY_MINUTES = 480; // 8 hours

/**
 * Calculate flex balance from entries.
 *
 * @param entries - All time entries in the relevant range
 * @param startDate - Flex counting starts the day AFTER this date (YYYY-MM-DD)
 * @param initialHours - Flex balance as of startDate (can be negative)
 * @param holidays - Company holidays from AgileDay
 * @param referenceDate - "Today" — flex is calculated through yesterday
 */
export function calculateFlex(
  entries: TimeEntry[],
  startDate: string,
  initialHours: number,
  holidays: Holiday[],
  referenceDate: Date
): FlexResult {
  // The day after startDate is the first day we count
  const firstDay = new Date(startDate + "T12:00:00");
  firstDay.setDate(firstDay.getDate() + 1);

  // Yesterday (reference - 1 day)
  const yesterday = new Date(referenceDate);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(12, 0, 0, 0);

  if (yesterday < firstDay) {
    return { totalMinutes: Math.round(initialHours * 60), weeks: [] };
  }

  const hSet = holidaySet(holidays);
  const holidayMap = new Map(holidays.map((h) => [h.date, h.name]));

  // Group entry minutes by date
  const minutesByDate = new Map<string, number>();
  for (const entry of entries) {
    if (entry.syncStatus === "unsaved") continue;
    const current = minutesByDate.get(entry.date) ?? 0;
    minutesByDate.set(entry.date, current + entry.minutes);
  }

  // Iterate week by week from the Monday of firstDay's week
  const firstMonday = getWeekStart(firstDay);
  const lastMonday = getWeekStart(yesterday);

  const weeks: FlexWeek[] = [];
  const current = new Date(firstMonday);

  while (current <= lastMonday) {
    const monday = new Date(current);
    const mondayStr = fmtDate(monday);
    const isCurrentWeek =
      mondayStr === fmtDate(lastMonday) && fmtDate(yesterday) !== fmtDate(getSunday(monday));

    const weekHolidays: { date: string; name: string }[] = [];
    let workdays = 0;
    let workedMinutes = 0;

    for (let d = 0; d < 7; d++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + d);
      const dayStr = fmtDate(day);

      // Skip days before firstDay or after yesterday
      if (dayStr < fmtDate(firstDay) || dayStr > fmtDate(yesterday)) continue;

      const dayOfWeek = day.getDay(); // 0=Sun, 6=Sat
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHol = hSet.has(dayStr);

      if (isHol) {
        weekHolidays.push({ date: dayStr, name: holidayMap.get(dayStr) ?? "Holiday" });
      }

      // Workday = Mon-Fri and not a holiday
      if (!isWeekend && !isHol) {
        workdays++;
      }

      workedMinutes += minutesByDate.get(dayStr) ?? 0;
    }

    const expectedMinutes = workdays * WORKDAY_MINUTES;
    const deltaMinutes = workedMinutes - expectedMinutes;

    weeks.push({
      weekLabel: formatWeekLabel(monday),
      startDate: mondayStr,
      workdays,
      expectedMinutes,
      workedMinutes,
      deltaMinutes,
      holidays: weekHolidays,
      isPartial: isCurrentWeek || fmtDate(firstDay) > mondayStr, // first week may be partial too
    });

    current.setDate(current.getDate() + 7);
  }

  const totalDelta = weeks.reduce((sum, w) => sum + w.deltaMinutes, 0);
  const totalMinutes = Math.round(initialHours * 60) + totalDelta;

  return { totalMinutes, weeks };
}

export interface LiveFlexResult extends FlexResult {
  /** Balance through yesterday (what calculateFlex returns). */
  baseMinutes: number;
  todayWorkedMinutes: number;
  /** 480 if today is a workday inside the flex period, otherwise 0. */
  todayExpectedMinutes: number;
  /** False when today is still before the flex period (nothing counted yet). */
  countsToday: boolean;
}

/**
 * Live flex balance: through-yesterday balance plus today counted as a full
 * day (worked − expected). Starts the morning a workday down and climbs back
 * as hours are logged, so the number never jumps at midnight.
 *
 * @param extraMinutes - Minutes worked today that aren't in entries yet
 *   (the running timer's elapsed time)
 */
export function calculateLiveFlex(
  entries: TimeEntry[],
  startDate: string,
  initialHours: number,
  holidays: Holiday[],
  now: Date,
  extraMinutes = 0
): LiveFlexResult {
  const base = calculateFlex(entries, startDate, initialHours, holidays, now);

  // Today counts only if it's on/after the first counted day
  const firstDay = new Date(startDate + "T12:00:00");
  firstDay.setDate(firstDay.getDate() + 1);
  const todayStr = fmtDate(now);
  if (todayStr < fmtDate(firstDay)) {
    return {
      ...base,
      baseMinutes: base.totalMinutes,
      todayWorkedMinutes: 0,
      todayExpectedMinutes: 0,
      countsToday: false,
    };
  }

  let todayWorkedMinutes = extraMinutes;
  for (const entry of entries) {
    if (entry.syncStatus === "unsaved") continue;
    if (entry.date === todayStr) todayWorkedMinutes += entry.minutes;
  }

  const dayOfWeek = now.getDay();
  const isWorkday = dayOfWeek !== 0 && dayOfWeek !== 6 && !holidaySet(holidays).has(todayStr);
  const todayExpectedMinutes = isWorkday ? WORKDAY_MINUTES : 0;

  return {
    ...base,
    baseMinutes: base.totalMinutes,
    totalMinutes: base.totalMinutes + todayWorkedMinutes - todayExpectedMinutes,
    todayWorkedMinutes,
    todayExpectedMinutes,
    countsToday: true,
  };
}

export interface MonthStats {
  /** Minutes worked this calendar month, including today (and extraMinutes). */
  workedMinutes: number;
  /** Full-month target: workdays in the month × 480. */
  expectedMinutes: number;
  /** Target through today: elapsed workdays × 480. */
  expectedToDateMinutes: number;
  workdays: number;
  workdaysToDate: number;
}

/**
 * Worked vs expected hours for the calendar month containing `now`.
 *
 * @param extraMinutes - Minutes worked today that aren't in entries yet
 *   (the running timer's elapsed time)
 */
export function calculateMonthStats(
  entries: TimeEntry[],
  holidays: Holiday[],
  now: Date,
  extraMinutes = 0
): MonthStats {
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const todayStr = fmtDate(now);
  const hSet = holidaySet(holidays);

  let workdays = 0;
  let workdaysToDate = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month, d);
    const dayStr = fmtDate(day);
    const dayOfWeek = day.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6 || hSet.has(dayStr)) continue;
    workdays++;
    if (dayStr <= todayStr) workdaysToDate++;
  }

  let workedMinutes = extraMinutes;
  for (const entry of entries) {
    if (entry.syncStatus === "unsaved") continue;
    if (entry.date.startsWith(monthPrefix)) workedMinutes += entry.minutes;
  }

  return {
    workedMinutes,
    expectedMinutes: workdays * WORKDAY_MINUTES,
    expectedToDateMinutes: workdaysToDate * WORKDAY_MINUTES,
    workdays,
    workdaysToDate,
  };
}

function getSunday(monday: Date): Date {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

/** Format minutes as ±Xh Ym */
export function formatFlexMinutes(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}
