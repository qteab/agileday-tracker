import type { TimeEntry, TimeEntryStatus } from "./types";

/** Round minutes up to the nearest 15-minute increment. 0 stays 0. */
export function ceilTo15(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / 15) * 15;
}

export interface RoundingEntry {
  id: string;
  date: string;
  projectId: string;
  projectName?: string;
  description: string;
  currentMinutes: number;
  /** The value this entry will be set to after rounding (equals currentMinutes unless adjusted) */
  adjustedMinutes: number;
  /** True if this is the entry that absorbs the rounding difference for its project */
  isAdjusted: boolean;
  status: TimeEntryStatus;
}

export interface ProjectRounding {
  projectId: string;
  projectName?: string;
  totalMinutes: number;
  roundedTotal: number;
  difference: number;
  entries: RoundingEntry[];
}

/**
 * Build a rounding plan that operates on weekly project totals.
 *
 * For each project: sum all SAVED entries, ceil to 15, then add the difference
 * to one entry (the largest SAVED entry absorbs the adjustment).
 * SUBMITTED/APPROVED entries are included for display but never modified.
 */
export function buildRoundingPlan(entries: TimeEntry[]): ProjectRounding[] {
  // Group by project
  const byProject = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const existing = byProject.get(e.projectId) ?? [];
    existing.push(e);
    byProject.set(e.projectId, existing);
  }

  const result: ProjectRounding[] = [];

  for (const [projectId, projectEntries] of byProject) {
    const savedEntries = projectEntries.filter(
      (e) => e.status !== "SUBMITTED" && e.status !== "APPROVED"
    );
    const lockedEntries = projectEntries.filter(
      (e) => e.status === "SUBMITTED" || e.status === "APPROVED"
    );

    const savedTotal = savedEntries.reduce((s, e) => s + e.minutes, 0);
    const roundedTotal = ceilTo15(savedTotal);
    const difference = roundedTotal - savedTotal;

    // Pick the largest SAVED entry to absorb the difference
    const largestSaved =
      savedEntries.length > 0
        ? savedEntries.reduce((best, e) => (e.minutes > best.minutes ? e : best))
        : null;

    const roundingEntries: RoundingEntry[] = [
      ...savedEntries.map((e) => ({
        id: e.id,
        date: e.date,
        projectId: e.projectId,
        projectName: e.projectName,
        description: e.description,
        currentMinutes: e.minutes,
        adjustedMinutes:
          difference > 0 && largestSaved && e.id === largestSaved.id
            ? e.minutes + difference
            : e.minutes,
        isAdjusted: difference > 0 && largestSaved !== null && e.id === largestSaved.id,
        status: e.status,
      })),
      ...lockedEntries.map((e) => ({
        id: e.id,
        date: e.date,
        projectId: e.projectId,
        projectName: e.projectName,
        description: e.description,
        currentMinutes: e.minutes,
        adjustedMinutes: e.minutes,
        isAdjusted: false,
        status: e.status,
      })),
    ];

    result.push({
      projectId,
      projectName: projectEntries[0]?.projectName,
      totalMinutes: savedTotal,
      roundedTotal,
      difference,
      entries: roundingEntries,
    });
  }

  return result;
}
