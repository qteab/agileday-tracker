/**
 * The AgileDay implementation of `ApiProvider`: one method per thing the app
 * needs, each a thin mapping over an AgileDay endpoint.
 *
 * The pieces it is built from live beside it — `agileday-http` holds the token
 * and fetch handling, `agileday-entries` the time-entry mapping,
 * `agileday-read-entries` the two-endpoint range read, and `agileday-timecards`
 * the weekly timecard and the auto-submit bracket.
 */

import { normalizeAllocationPeriods, type RawAllocationPeriod } from "../utils/allocation";
import { addDays } from "../utils/date-range";
import {
  findMergeTarget,
  toEntryCreate,
  toEntryPatch,
  toTimeEntry,
  type RawTimeEntry,
} from "./agileday-entries";
import { createApiFetch, type AgileDayConfig } from "./agileday-http";
import { createEntryReader } from "./agileday-read-entries";
import { createAutoSubmitBracket, createTimecardApi } from "./agileday-timecards";
import type { AuthState } from "./auth";
import { createGlobalDefaultTaskLoader } from "./global-tasks";
import { decodeJwtPayload, employeeIdFromPayload, employeeIdFromToken } from "./jwt";
import type { ApiProvider, MyProjectInfo } from "./provider";
import type { Allocation, Employee, Holiday, Project, ProjectType, Task, TimeEntry } from "./types";

export type { AgileDayConfig };

// Color palette for projects (AgileDay doesn't return colors)
const PROJECT_COLORS = [
  "#7A59FC",
  "#E5B80B",
  "#AEA7FF",
  "#D946EF",
  "#374151",
  "#0EA5E9",
  "#F97316",
  "#10B981",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "#F59E0B",
  "#6366F1",
  "#84CC16",
];

function assignProjectColor(index: number): string {
  return PROJECT_COLORS[index % PROJECT_COLORS.length] ?? "#AEA7FF";
}

/** The `/v2/opening` path for one employee's own openings. */
function openingsForEmployee(employeeId: string): string {
  const filter = JSON.stringify({ candidate: { in: [employeeId] } });
  return `/v2/opening?limit=100&filter=${encodeURIComponent(filter)}`;
}

export function createAgileDayProvider(
  config: AgileDayConfig,
  getAuthState: () => AuthState | null,
  setAuthState: (state: AuthState) => void,
  clearAuthState: () => void,
  /** Override fetch for testing — defaults to Tauri HTTP plugin */
  fetchOverride?: typeof globalThis.fetch,
  opts?: {
    /** Read live so toggling the setting needs no new provider. */
    autoSubmit?: () => boolean;
  }
): ApiProvider {
  const apiFetch = createApiFetch(
    config,
    { getAuthState, setAuthState, clearAuthState },
    fetchOverride
  );

  const readTimeEntries = createEntryReader(apiFetch);
  const timecards = createTimecardApi(apiFetch);
  const autoSubmitEnabled = () => opts?.autoSubmit?.() === true;
  const withAutoSubmit = createAutoSubmitBracket(timecards, autoSubmitEnabled);

  // Memoised per provider instance: discovered on first getTasks call, reused for
  // the rest of the session. Resolves to [] on failure so a task-less project
  // degrades to the app's previous behaviour rather than breaking.
  const loadGlobalDefaultTasks = createGlobalDefaultTaskLoader((path) => apiFetch(path));

  const base: ApiProvider = {
    async getCurrentEmployee(): Promise<Employee> {
      const accessToken = getAuthState()?.accessToken;
      if (!accessToken) throw new Error("Not authenticated — please sign in");

      const claims = decodeJwtPayload(accessToken);
      if (!claims) throw new Error("Failed to read user info from token");

      const employeeId = employeeIdFromPayload(claims);
      if (!employeeId) {
        throw new Error("Token does not contain an employee ID — please contact your admin");
      }

      const jwtEmail = claims.email || "";
      const jwtName = claims.name || claims.preferred_username || jwtEmail || "User";

      // The profile endpoint has the authoritative name and email; the token's
      // own claims stand in when it can't be read.
      try {
        const emp = await apiFetch<{ id: string; name: string; email: string }>(
          `/v1/employee/id/${employeeId}`
        );
        return { id: emp.id, name: emp.name || jwtName, email: emp.email || jwtEmail };
      } catch {
        return { id: employeeId, name: jwtName, email: jwtEmail };
      }
    },

    async getProjects(): Promise<Project[]> {
      const projects = await apiFetch<
        Array<{ id: string; name: string; customer?: { name: string } }>
      >("/v1/project?projectStage=ACTIVE&sortBy=name&sortDirection=asc");

      return projects.map((p, i) => ({
        id: p.id,
        name: p.name,
        ...(p.customer ? { customerName: p.customer.name } : {}),
        color: assignProjectColor(i),
      }));
    },

    async getAbsenceProjects(): Promise<Project[]> {
      // Absence projects (vacation, sick leave, etc.) are a separate AgileDay
      // entity — they are NOT returned by /v1/project, so they need their own
      // fetch. Degrade gracefully to [] if the token can't read this endpoint.
      const absences = await apiFetch<
        Array<{ id: string; name: string; customer?: { name: string } }>
      >("/v1/absence?sortBy=name&sortDirection=asc&limit=1000").catch(() => []);

      return absences.map((a, i) => ({
        id: a.id,
        name: a.name,
        ...(a.customer ? { customerName: a.customer.name } : {}),
        color: assignProjectColor(i),
        projectType: "ABSENCE" as const,
      }));
    },

    async getTasks(projectId: string): Promise<Task[]> {
      // Both reads start together: the global catalogue is slow to discover and
      // must never delay the project's own list beyond its own latency.
      const [rawOwn, globalDefaults] = await Promise.all([
        apiFetch<
          Array<{
            id: string;
            name: string;
            projectId: string;
            billable: boolean;
            active: boolean;
          }>
        >(`/v1/project/id/${projectId}/task`),
        loadGlobalDefaultTasks(),
      ]);

      // Inactive tasks are kept: entries already logged against a task that was
      // later deactivated still need its billable flag. Pickers filter on
      // `active` so deactivated tasks can't be selected for new time.
      const own = rawOwn.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        name: t.name,
        billable: t.billable,
        active: t.active,
      }));

      // Globals are appended, never substituted — AgileDay's web UI labels them
      // "(global default)" precisely so they can sit alongside a project's own
      // tasks. The project's own copy wins on an id clash: it carries the real
      // project scoping.
      const ownIds = new Set(own.map((t) => t.id));
      const extras = globalDefaults
        .filter((t) => !ownIds.has(t.id))
        .map((t) => ({ ...t, projectId }));

      return [...own, ...extras];
    },

    getTimeEntries(employeeId: string, startDate: string, endDate: string): Promise<TimeEntry[]> {
      return readTimeEntries(employeeId, startDate, endDate);
    },

    async createTimeEntry(
      employeeId: string,
      entry: Omit<TimeEntry, "id" | "syncStatus">
    ): Promise<TimeEntry> {
      // The app is the source of truth when saving: if AgileDay already holds an
      // entry for this project, task and date, patch it with the app's state
      // rather than adding a second row. The day is looked up by work date —
      // filtering by last-update timestamp would miss an entry left untouched
      // since before its own date, and every future-dated entry outright,
      // causing a duplicate POST.
      const sameDay = await apiFetch<RawTimeEntry[]>(
        `/v1/time_entry/employee/id/${employeeId}?startDate=${entry.date}&endDate=${addDays(entry.date, 1)}`
      ).catch(() => [] as RawTimeEntry[]);

      const match = findMergeTarget(sameDay, entry, { allowSubmitted: autoSubmitEnabled() });

      const body = match
        ? [toEntryPatch({ id: match.id, minutes: entry.minutes, description: entry.description })]
        : [toEntryCreate(entry)];

      const results = await apiFetch<RawTimeEntry[]>(`/v1/time_entry/employee/id/${employeeId}`, {
        method: match ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });

      const [saved] = results;
      if (!saved) throw new Error("No entry returned from API");

      return toTimeEntry(saved, {
        descriptionFallback: entry.description,
        projectName: entry.projectName,
        startTime: entry.startTime,
        endTime: entry.endTime,
      });
    },

    async updateTimeEntry(
      employeeId: string,
      id: string,
      updates: Partial<TimeEntry>
    ): Promise<TimeEntry> {
      const results = await apiFetch<RawTimeEntry[]>(`/v1/time_entry/employee/id/${employeeId}`, {
        method: "PATCH",
        body: JSON.stringify([toEntryPatch({ ...updates, id })]),
      });

      const [updated] = results;
      if (!updated) throw new Error("No entry returned from API");

      return toTimeEntry(updated, {
        projectName: updates.projectName,
        startTime: updates.startTime ?? "",
        endTime: updates.endTime,
      });
    },

    async deleteTimeEntry(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      await apiFetch(`/v1/time_entry?ids=${ids.join(",")}`, { method: "DELETE" });
    },

    async batchUpdateEntries(
      employeeId: string,
      updates: Array<{ id: string } & Partial<TimeEntry>>
    ): Promise<TimeEntry[]> {
      if (updates.length === 0) return [];

      const results = await apiFetch<RawTimeEntry[]>(`/v1/time_entry/employee/id/${employeeId}`, {
        method: "PATCH",
        body: JSON.stringify(updates.map((u) => toEntryPatch(u))),
      });

      return results.map((r) => toTimeEntry(r));
    },

    submitTimesheet(employeeId: string, weekStart: string, month: string): Promise<void> {
      return timecards.setTimesheetStatus(employeeId, weekStart, month, "SUBMITTED");
    },

    setTimesheetStatus(employeeId, weekStart, month, status): Promise<void> {
      return timecards.setTimesheetStatus(employeeId, weekStart, month, status);
    },

    async getAllocations(employeeId: string): Promise<Allocation[]> {
      const data = await apiFetch<{
        openings: Array<{
          projectlikeId: string;
          projectlikeName: string;
          allocation: number;
          allocationMode: string;
          // In "hours" mode `allocation` is null and `hours` is set instead.
          allocations: RawAllocationPeriod[] | null;
          startDate: string | null;
          endDate: string | null;
          hours: number | null;
        }>;
      }>(openingsForEmployee(employeeId));

      return data.openings.map((o) => ({
        projectId: o.projectlikeId,
        projectName: o.projectlikeName,
        startDate: o.startDate ?? null,
        endDate: o.endDate ?? null,
        percentage: Number.isFinite(o.allocation) ? o.allocation : 0,
        hours: Number.isFinite(o.hours) ? (o.hours as number) : 0,
        allocationMode: o.allocationMode,
        periods: normalizeAllocationPeriods(o.allocations, o.allocationMode, o.endDate),
      }));
    },

    async getMyProjects(employeeId: string): Promise<MyProjectInfo[]> {
      const data = await apiFetch<{
        openings: Array<{
          id: string;
          projectlikeId: string;
          projectlikeName?: string;
          projectlikeType?: ProjectType | null;
          status: string;
        }>;
      }>(openingsForEmployee(employeeId));

      const byId = new Map<string, Omit<MyProjectInfo, "id">>();
      for (const o of data.openings) {
        const prev = byId.get(o.projectlikeId);
        if (!prev) {
          byId.set(o.projectlikeId, {
            ...(o.projectlikeName !== undefined ? { name: o.projectlikeName } : {}),
            ...(o.projectlikeType ? { projectType: o.projectlikeType } : {}),
            openingId: o.id,
          });
        } else if (!prev.projectType && o.projectlikeType) {
          // Prefer non-null type if multiple openings exist for the same project
          prev.projectType = o.projectlikeType;
        }
      }
      return [...byId.entries()].map(([id, info]) => ({ id, ...info }));
    },

    async getHolidays(countryCode: string, startDate: string, endDate: string): Promise<Holiday[]> {
      const data = await apiFetch<Array<{ date: string; name: string }>>(
        `/v1/workpackages/${encodeURIComponent(countryCode)}/holidays?startDate=${startDate}&endDate=${endDate}`
      );
      return data.map((h) => ({ date: h.date, name: h.name }));
    },
  };

  // Writes are bracketed, reads are not: only a write needs the week it touches
  // unsubmitted around it.
  return {
    ...base,
    createTimeEntry: (employeeId, entry) =>
      withAutoSubmit(employeeId, [entry.date], () => base.createTimeEntry(employeeId, entry)),
    updateTimeEntry: (employeeId, id, updates) =>
      withAutoSubmit(employeeId, [updates.date], () =>
        base.updateTimeEntry(employeeId, id, updates)
      ),
    batchUpdateEntries: (employeeId, updates) =>
      withAutoSubmit(
        employeeId,
        updates.map((u) => u.date),
        () => base.batchUpdateEntries(employeeId, updates)
      ),
    deleteTimeEntry: (ids, dates) =>
      withAutoSubmit(employeeIdFromToken(getAuthState()?.accessToken), dates ?? [], () =>
        base.deleteTimeEntry(ids)
      ),
  };
}
