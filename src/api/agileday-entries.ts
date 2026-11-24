/**
 * Translating between AgileDay's time-entry JSON and the app's `TimeEntry`.
 *
 * Every write endpoint returns the same entry shape and every read maps it the
 * same way, so the mapping lives here once rather than beside each call.
 */

import type { ProjectType, TimeEntry } from "./types";

/** The entry shape AgileDay returns from both the read and the write endpoints. */
export interface RawTimeEntry {
  id: string;
  date: string;
  minutes: number;
  status: string;
  description?: string;
  projectId: string;
  projectName?: string;
  taskId?: string;
}

/**
 * AgileDay records a work date, not a clock time. The app needs a timestamp to
 * order a day's entries, so entries that came from the server get a fixed
 * mid-morning one rather than a fabricated precise time.
 */
export function defaultStartTime(date: string): string {
  return `${date}T09:00:00.000Z`;
}

export interface TimeEntryContext {
  /** Used when the server's own copy has no description. */
  descriptionFallback?: string;
  projectName?: string | undefined;
  projectType?: ProjectType | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
}

/** One server entry as the app's `TimeEntry`. */
export function toTimeEntry(raw: RawTimeEntry, context: TimeEntryContext = {}): TimeEntry {
  return {
    id: raw.id,
    description: raw.description ?? context.descriptionFallback ?? "",
    projectId: raw.projectId,
    projectName: context.projectName ?? raw.projectName,
    projectType: context.projectType,
    taskId: raw.taskId,
    date: raw.date,
    startTime: context.startTime ?? "",
    endTime: context.endTime,
    minutes: raw.minutes,
    status: raw.status as TimeEntry["status"],
    syncStatus: "synced",
  };
}

/** One element of a PATCH body: the id plus only the fields being changed. */
export function toEntryPatch(update: { id: string } & Partial<TimeEntry>): Record<string, unknown> {
  const patch: Record<string, unknown> = { id: update.id };
  if (update.description !== undefined) patch["description"] = update.description;
  if (update.minutes !== undefined) patch["minutes"] = update.minutes;
  if (update.projectId) patch["projectId"] = update.projectId;
  if (update.openingId) patch["openingId"] = update.openingId;
  if (update.taskId) patch["taskId"] = update.taskId;
  if (update.status) patch["status"] = update.status;
  if (update.date) patch["date"] = update.date;
  return patch;
}

/** The POST body for an entry AgileDay has not seen before. */
export function toEntryCreate(
  entry: Omit<TimeEntry, "id" | "syncStatus">
): Record<string, unknown> {
  return {
    date: entry.date,
    minutes: entry.minutes,
    status: "SAVED",
    projectId: entry.projectId,
    ...(entry.openingId ? { openingId: entry.openingId } : {}),
    ...(entry.taskId ? { taskId: entry.taskId } : {}),
    ...(entry.description ? { description: entry.description } : {}),
  };
}

/** Statuses the app may still write into. APPROVED is never one of them. */
const MERGEABLE_STATUSES = new Set(["NEW", "SAVED", "CHANGE_REQUESTED"]);

function isMergeable(status: string, allowSubmitted: boolean): boolean {
  return MERGEABLE_STATUSES.has(status) || (allowSubmitted && status === "SUBMITTED");
}

/**
 * The existing entry a save should merge into, if there is one.
 *
 * Project + task + date identifies an entry, so a second save for the same work
 * patches the first rather than adding a row — this is what keeps a day's
 * entries consolidated on AgileDay while the app shows each session.
 *
 * `allowSubmitted` is for auto-submit. That mode unsubmits the week around a
 * write, so a SUBMITTED entry would normally not be seen here; when the status
 * change was refused or another write resubmitted in between, the entry is
 * still the app's to merge into. Without this the save POSTs a duplicate and
 * silently inflates the day's hours.
 */
export function findMergeTarget<T extends RawTimeEntry>(
  sameDay: T[],
  entry: { projectId: string; date: string; taskId?: string | undefined },
  { allowSubmitted }: { allowSubmitted: boolean }
): T | undefined {
  return sameDay.find((candidate) => {
    if (candidate.projectId !== entry.projectId || candidate.date !== entry.date) return false;
    if (!isMergeable(candidate.status, allowSubmitted)) return false;
    return (candidate.taskId ?? "") === (entry.taskId ?? "");
  });
}
