import type { TimeEntry, TimeEntryStatus } from "./types";

/** Round minutes up to the nearest 15-minute increment. 0 stays 0. */
export function ceilTo15(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / 15) * 15;
}

/** Round minutes down to the nearest 15-minute increment. 0 stays 0. */
export function floorTo15(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.floor(minutes / 15) * 15;
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
  /** True if this is the entry that absorbs the rounding difference for its project-day */
  isAdjusted: boolean;
  status: TimeEntryStatus;
}

export interface DayProjectRounding {
  projectId: string;
  projectName?: string;
  date: string;
  totalMinutes: number;
  roundedTotal: number;
  difference: number;
  entries: RoundingEntry[];
}

/**
 * Build a rounding plan that operates on per-project, per-day totals.
 *
 * For each project+day: sum all SAVED entries, ceil to 15, then add the
 * difference to one entry (the largest SAVED entry absorbs the adjustment).
 * SUBMITTED/APPROVED entries are included for display but never modified.
 */
export function buildRoundingPlan(entries: TimeEntry[]): DayProjectRounding[] {
  // Group by project + day
  const byKey = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const key = `${e.projectId}:${e.date}`;
    const existing = byKey.get(key) ?? [];
    existing.push(e);
    byKey.set(key, existing);
  }

  const result: DayProjectRounding[] = [];

  for (const [, groupEntries] of byKey) {
    const savedEntries = groupEntries.filter(
      (e) => e.status !== "SUBMITTED" && e.status !== "APPROVED"
    );
    const lockedEntries = groupEntries.filter(
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
      projectId: groupEntries[0].projectId,
      projectName: groupEntries[0]?.projectName,
      date: groupEntries[0].date,
      totalMinutes: savedTotal,
      roundedTotal,
      difference,
      entries: roundingEntries,
    });
  }

  return result;
}

/**
 * Apply manual overrides to a rounding plan.
 *
 * Overrides map: key = "projectId:date", value = desired rounded total (multiple of 15).
 * The override is clamped: minimum is floorTo15(totalMinutes), maximum is ceilTo15(totalMinutes).
 * The difference is recalculated and applied to the largest SAVED entry.
 */
export function applyOverrides(
  plan: DayProjectRounding[],
  overrides: Map<string, number>
): DayProjectRounding[] {
  if (overrides.size === 0) return plan;

  return plan.map((group) => {
    const key = `${group.projectId}:${group.date}`;
    const override = overrides.get(key);
    if (override === undefined) return group;

    // Clamp override between floor and ceil of total
    const floor = floorTo15(group.totalMinutes);
    const ceil = ceilTo15(group.totalMinutes);
    const clampedTotal = Math.max(floor, Math.min(ceil, override));
    const difference = clampedTotal - group.totalMinutes;

    // Find largest SAVED entry to absorb the difference
    const savedEntries = group.entries.filter(
      (e) => e.status !== "SUBMITTED" && e.status !== "APPROVED"
    );
    const largestSaved =
      savedEntries.length > 0
        ? savedEntries.reduce((best, e) => (e.currentMinutes > best.currentMinutes ? e : best))
        : null;

    const entries = group.entries.map((e) => {
      const isTarget = largestSaved !== null && e.id === largestSaved.id && difference !== 0;
      return {
        ...e,
        adjustedMinutes: isTarget ? e.currentMinutes + difference : e.currentMinutes,
        isAdjusted: isTarget,
      };
    });

    return {
      ...group,
      roundedTotal: clampedTotal,
      difference,
      entries,
    };
  });
}
