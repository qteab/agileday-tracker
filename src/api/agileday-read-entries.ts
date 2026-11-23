/**
 * Reading a date range of time entries.
 *
 * AgileDay exposes the same hours through two endpoints and neither is
 * sufficient alone: the time-entry endpoint carries descriptions and real ids
 * but omits some statuses, while the timesheet summary reports every status
 * with no description and no id. The app reads both and reconciles them.
 */

import { addDays, monthsInRange } from "../utils/date-range";
import { defaultStartTime, toTimeEntry, type RawTimeEntry } from "./agileday-entries";
import type { ApiFetch } from "./agileday-http";
import type { ProjectType, TimeEntry } from "./types";

/**
 * Lookback for the /updated fallback read. That endpoint filters by last-update
 * timestamp, not work date, so the cutoff must sit far enough back to still
 * catch entries that were written long before the requested window.
 */
const FALLBACK_LOOKBACK_DAYS = 400;

interface SummaryEntry {
  date: string;
  project: string;
  projectId: string;
  projectType?: ProjectType;
  customer: string;
  minutes: number;
  status: string;
}

function dayKey(projectId: string, date: string): string {
  return `${projectId}::${date}`;
}

/**
 * The summary endpoint reliably reports a project's type; the time-entry
 * endpoints do not, so entries borrow it from whichever summary row covers the
 * same project.
 */
export function projectTypesFromSummary(summary: SummaryEntry[]): Map<string, ProjectType> {
  const byProjectId = new Map<string, ProjectType>();
  for (const row of summary) {
    if (row.projectType && !byProjectId.has(row.projectId)) {
      byProjectId.set(row.projectId, row.projectType);
    }
  }
  return byProjectId;
}

/**
 * Summary hours the detailed read did not account for, as synthetic entries.
 *
 * A project-day the summary reports more minutes for than the detailed read
 * returned is hours the app would otherwise not show at all. They get a
 * `summary-` id because there is no real entry id to use, and carry only the
 * difference so the day's total stays right.
 */
export function addSummaryGaps(
  detailed: TimeEntry[],
  summary: SummaryEntry[],
  startDate: string,
  endDate: string
): TimeEntry[] {
  const detailedMinutes = new Map<string, number>();
  for (const entry of detailed) {
    const key = dayKey(entry.projectId, entry.date);
    detailedMinutes.set(key, (detailedMinutes.get(key) ?? 0) + entry.minutes);
  }

  const gaps: TimeEntry[] = [];
  for (const row of summary) {
    if (row.minutes <= 0 || row.date < startDate || row.date > endDate) continue;
    const covered = detailedMinutes.get(dayKey(row.projectId, row.date)) ?? 0;
    if (covered >= row.minutes) continue;

    gaps.push(
      toTimeEntry(
        {
          id: `summary-${row.projectId}-${row.date}`,
          projectId: row.projectId,
          date: row.date,
          minutes: row.minutes - covered,
          status: row.status,
        },
        {
          projectName: row.project,
          projectType: row.projectType,
          startTime: defaultStartTime(row.date),
        }
      )
    );
  }
  return gaps;
}

export function createEntryReader(apiFetch: ApiFetch) {
  /** Entries by work date, with descriptions and ids. */
  async function fetchDetailed(
    employeeId: string,
    startDate: string,
    endDate: string
  ): Promise<RawTimeEntry[]> {
    // endDate is exclusive on this endpoint, hence the +1 day.
    return apiFetch<RawTimeEntry[]>(
      `/v1/time_entry/employee/id/${employeeId}?startDate=${startDate}&endDate=${addDays(endDate, 1)}`
    ).catch(async () => {
      // Fallback: /updated filters on last-update timestamp rather than work
      // date, so it needs a wide lookback — anything narrower silently drops
      // entries booked before the window (e.g. vacation planned months ahead).
      const updatedAfter = new Date(
        addDays(startDate, -FALLBACK_LOOKBACK_DAYS) + "T00:00:00Z"
      ).toISOString();
      return apiFetch<RawTimeEntry[]>(
        `/v1/time_entry/employee/id/${employeeId}/updated?updatedAfter=${updatedAfter}`
      ).catch(() => [] as RawTimeEntry[]);
    });
  }

  /**
   * Summary rows for every month the window touches. A ±30-day window normally
   * spans three, and skipping the middle one leaves that month uncovered. The
   * months are read in parallel: the flex backfill can span a year, and those
   * would otherwise be a year's worth of serial round-trips.
   */
  async function fetchSummary(
    employeeId: string,
    startDate: string,
    endDate: string
  ): Promise<SummaryEntry[]> {
    const pages = await Promise.all(
      monthsInRange(startDate, endDate).map((month) =>
        apiFetch<{ entries: SummaryEntry[] }>(
          `/v1/timesheets/${employeeId}/summary?date=${month}&intervalType=day&month=${month}`
        ).catch(() => ({ entries: [] as SummaryEntry[] }))
      )
    );
    return pages.flatMap((page) => page.entries);
  }

  return async function readTimeEntries(
    employeeId: string,
    startDate: string,
    endDate: string
  ): Promise<TimeEntry[]> {
    const detailedRaw = await fetchDetailed(employeeId, startDate, endDate);
    const summary = await fetchSummary(employeeId, startDate, endDate);

    const projectTypes = projectTypesFromSummary(summary);
    const detailed = detailedRaw
      .filter((e) => e.date >= startDate && e.date <= endDate)
      .map((e) =>
        toTimeEntry(e, {
          projectType: projectTypes.get(e.projectId),
          startTime: defaultStartTime(e.date),
        })
      );

    return [...detailed, ...addSummaryGaps(detailed, summary, startDate, endDate)];
  };
}
