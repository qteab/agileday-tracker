import type { ApiProvider } from "./provider";
import type { Allocation, Employee, Project, ProjectType, Task, TimeEntry } from "./types";
import type { AuthConfig, AuthState } from "./auth";
import { isTokenExpired, refreshAccessToken, tokenResponseToAuthState } from "./auth";

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
  return PROJECT_COLORS[index % PROJECT_COLORS.length];
}

export interface AgileDayConfig {
  /** e.g. "https://qvik.agileday.io/api" */
  apiBaseUrl: string;
  authConfig: AuthConfig;
}

export function createAgileDayProvider(
  config: AgileDayConfig,
  getAuthState: () => AuthState | null,
  setAuthState: (state: AuthState) => void,
  clearAuthState: () => void,
  /** Override fetch for testing — defaults to Tauri HTTP plugin */
  fetchOverride?: typeof globalThis.fetch
): ApiProvider {
  async function getValidToken(): Promise<string> {
    const auth = getAuthState();
    if (!auth) throw new Error("Not authenticated — please log in");

    if (isTokenExpired(auth, 0)) {
      // Token is expired or about to expire — try to refresh
      if (!auth.refreshToken) {
        clearAuthState();
        throw new Error("Session expired — please log in again");
      }

      // Try refresh with one retry
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const tokens = await refreshAccessToken(config.authConfig, auth.refreshToken);
          const newState = tokenResponseToAuthState(tokens);
          setAuthState(newState);
          return newState.accessToken;
        } catch {
          if (attempt === 0) {
            // First attempt failed — wait briefly and retry
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
      clearAuthState();
      throw new Error("Session expired — please log in again");
    }

    // Token still valid but refresh proactively if < 2 min left
    if (isTokenExpired(auth, 120_000) && auth.refreshToken) {
      refreshAccessToken(config.authConfig, auth.refreshToken)
        .then((tokens) => setAuthState(tokenResponseToAuthState(tokens)))
        .catch(() => {}); // Best effort, don't block the current request
    }

    return auth.accessToken;
  }

  // Cache descriptions for entries we create — the API doesn't return them immediately
  const descriptionCache = new Map<string, string>();

  let resolvedFetch: typeof globalThis.fetch | null = fetchOverride ?? null;

  async function getResolvedFetch() {
    if (!resolvedFetch) {
      try {
        const mod = await import("@tauri-apps/plugin-http");
        resolvedFetch = mod.fetch;
      } catch {
        resolvedFetch = globalThis.fetch;
      }
    }
    return resolvedFetch;
  }

  async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await getValidToken();
    const url = `${config.apiBaseUrl}${path}`;

    // Security: enforce HTTPS
    if (!url.startsWith("https://")) {
      throw new Error("API calls must use HTTPS");
    }

    const doFetch = await getResolvedFetch();
    const method = options.method ?? "GET";
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await doFetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Origin: new URL(config.apiBaseUrl).origin,
          ...options.headers,
        },
      });
    } catch (err) {
      const elapsed = Math.round(performance.now() - startedAt);
      console.log(`[AgileDay] ${method} ${url} → network error (${elapsed}ms)`);
      throw err;
    }
    const elapsed = Math.round(performance.now() - startedAt);
    console.log(`[AgileDay] ${method} ${url} → ${response.status} (${elapsed}ms)`);

    if (response.status === 401) {
      const body = await response.text().catch(() => "");
      throw new Error(`Auth failed (401) at ${url}: ${body}`);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`API error ${response.status} at ${url}: ${errorText}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json();
  }

  return {
    async getCurrentEmployee(): Promise<Employee> {
      const auth = getAuthState();
      if (!auth?.accessToken) {
        throw new Error("Not authenticated — please sign in");
      }

      // Get employee ID from JWT
      let employeeId: string | undefined;
      let jwtName: string;
      let jwtEmail: string;
      try {
        const payload = JSON.parse(
          atob(auth.accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
        );
        employeeId = payload.sub || payload.employee_id || payload.uid;
        jwtEmail = payload.email || "";
        jwtName = payload.name || payload.preferred_username || jwtEmail || "User";
      } catch {
        throw new Error("Failed to read user info from token");
      }

      if (!employeeId) {
        throw new Error("Token does not contain an employee ID — please contact your admin");
      }

      // Try to fetch full profile (name, email) from API
      try {
        const emp = await apiFetch<{ id: string; name: string; email: string }>(
          `/v1/employee/id/${employeeId}`
        );
        return { id: emp.id, name: emp.name || jwtName, email: emp.email || jwtEmail };
      } catch {
        // Employee endpoint not accessible — use JWT data
        return { id: employeeId, name: jwtName, email: jwtEmail };
      }
    },

    async getProjects(): Promise<Project[]> {
      const projects = await apiFetch<
        Array<{
          id: string;
          name: string;
          customer?: { name: string };
        }>
      >("/v1/project?projectStage=ACTIVE&sortBy=name&sortDirection=asc");

      return projects.map((p, i) => ({
        id: p.id,
        name: p.name,
        customerName: p.customer?.name,
        color: assignProjectColor(i),
      }));
    },

    async getTasks(projectId: string): Promise<Task[]> {
      const tasks = await apiFetch<
        Array<{
          id: string;
          name: string;
          projectId: string;
          billable: boolean;
          active: boolean;
        }>
      >(`/v1/project/id/${projectId}/task`);

      return tasks
        .filter((t) => t.active)
        .map((t) => ({
          id: t.id,
          projectId: t.projectId,
          name: t.name,
          billable: t.billable,
          active: t.active,
        }));
    },

    async getTimeEntries(
      employeeId: string,
      startDate: string,
      endDate: string
    ): Promise<TimeEntry[]> {
      type RawEntry = {
        id: string;
        description: string;
        projectId: string;
        projectName: string;
        taskId?: string;
        date: string;
        minutes: number;
        status: string;
      };

      type SummaryEntry = {
        date: string;
        project: string;
        projectId: string;
        projectType?: ProjectType;
        customer: string;
        minutes: number;
        status: string;
      };

      // 1. Fetch detailed entries using the /updated endpoint
      //    This returns ALL entries (including SAVED/unsaved) with descriptions
      const updatedAfter = new Date(startDate + "T00:00:00Z").toISOString();
      const detailedEntries = await apiFetch<RawEntry[]>(
        `/v1/time_entry/employee/id/${employeeId}/updated?updatedAfter=${updatedAfter}`
      ).catch(() => [] as RawEntry[]);

      // 2. Fetch timesheets summary (has all statuses, but no descriptions)
      const startMonth = startDate.substring(0, 7) + "-01";
      const endMonth = endDate.substring(0, 7) + "-01";
      const months = new Set([startMonth, endMonth]);

      const summaryEntries: SummaryEntry[] = [];
      for (const month of months) {
        const data = await apiFetch<{ entries: SummaryEntry[] }>(
          `/v1/timesheets/${employeeId}/summary?date=${month}&intervalType=day&month=${month}`
        ).catch(() => ({ entries: [] as SummaryEntry[] }));
        summaryEntries.push(...data.entries);
      }

      // Build a projectId -> projectType lookup from summary entries (the summary
      // endpoint reliably exposes projectType, the /updated endpoint does not).
      const projectTypeById = new Map<string, ProjectType>();
      for (const s of summaryEntries) {
        if (s.projectType && !projectTypeById.has(s.projectId)) {
          projectTypeById.set(s.projectId, s.projectType);
        }
      }

      // 3. Build result: use detailed entries as primary (they have descriptions + IDs)
      const result: TimeEntry[] = detailedEntries
        .filter((e) => e.date >= startDate && e.date <= endDate)
        .map((e) => ({
          id: e.id,
          description: e.description ?? "",
          projectId: e.projectId,
          projectName: e.projectName,
          projectType: projectTypeById.get(e.projectId),
          taskId: e.taskId,
          date: e.date,
          startTime: `${e.date}T09:00:00.000Z`,
          minutes: e.minutes,
          status: e.status as TimeEntry["status"],
          syncStatus: "synced" as const,
        }));

      // 4. Enrich entries with cached descriptions
      for (const e of result) {
        if (e.description) {
          descriptionCache.set(e.id, e.description);
        } else if (descriptionCache.has(e.id)) {
          e.description = descriptionCache.get(e.id)!;
        }
      }

      // 5. Add entries from summary that aren't covered by detailed entries
      //    (e.g. entries in SAVED/NEW status that time_entry endpoint doesn't return)
      const detailedByProjectDate = new Map<string, number>();
      for (const e of result) {
        const key = `${e.projectId}::${e.date}`;
        detailedByProjectDate.set(key, (detailedByProjectDate.get(key) ?? 0) + e.minutes);
      }

      for (const s of summaryEntries) {
        if (s.minutes <= 0 || s.date < startDate || s.date > endDate) continue;
        const key = `${s.projectId}::${s.date}`;
        const detailedMinutes = detailedByProjectDate.get(key) ?? 0;

        if (detailedMinutes < s.minutes) {
          result.push({
            id: `summary-${s.projectId}-${s.date}`,
            description: "",
            projectId: s.projectId,
            projectName: s.project,
            projectType: s.projectType,
            date: s.date,
            startTime: `${s.date}T09:00:00.000Z`,
            minutes: s.minutes - detailedMinutes,
            status: s.status as TimeEntry["status"],
            syncStatus: "synced" as const,
          });
        }
      }

      return result;
    },

    async createTimeEntry(
      employeeId: string,
      entry: Omit<TimeEntry, "id" | "syncStatus">
    ): Promise<TimeEntry> {
      type RawEntry = {
        id: string;
        date: string;
        minutes: number;
        status: string;
        description?: string;
        projectId: string;
        taskId?: string;
      };

      const desc = entry.description ?? "";

      // 1. Query for existing SAVED entries with same project+date+description
      const updatedAfter = new Date(entry.date + "T00:00:00Z").toISOString();
      const allRecent = await apiFetch<RawEntry[]>(
        `/v1/time_entry/employee/id/${employeeId}/updated?updatedAfter=${updatedAfter}`
      ).catch(() => [] as RawEntry[]);

      const matches = allRecent.filter(
        (e) =>
          e.projectId === entry.projectId &&
          e.date === entry.date &&
          (e.description ?? "") === desc &&
          e.status === "SAVED"
      );

      let created: RawEntry;

      if (matches.length === 1) {
        // 2. One match — PATCH to add this session's minutes
        const existing = matches[0];
        const newTotal = existing.minutes + entry.minutes;
        const results = await apiFetch<RawEntry[]>(`/v1/time_entry/employee/id/${employeeId}`, {
          method: "PATCH",
          body: JSON.stringify([{ id: existing.id, minutes: newTotal }]),
        });
        if (results.length === 0) throw new Error("No entry returned from API");
        created = results[0];
      } else if (matches.length > 1) {
        // 3. Multiple matches — consolidate: create new with total, delete old
        const totalExisting = matches.reduce((s, e) => s + e.minutes, 0);
        const newTotal = totalExisting + entry.minutes;

        // Create the consolidated entry first (safer — if delete fails, we have duplicates not data loss)
        const results = await apiFetch<RawEntry[]>(`/v1/time_entry/employee/id/${employeeId}`, {
          method: "POST",
          body: JSON.stringify([
            {
              date: entry.date,
              minutes: newTotal,
              status: "SAVED",
              projectId: entry.projectId,
              ...(entry.taskId ? { taskId: entry.taskId } : {}),
              ...(desc ? { description: desc } : {}),
            },
          ]),
        });
        if (results.length === 0) throw new Error("No entry returned from API");
        created = results[0];

        // Delete the old duplicates one by one, track failures
        const failedDeletes: string[] = [];
        for (const old of matches) {
          try {
            await apiFetch(`/v1/time_entry?ids=${old.id}`, { method: "DELETE" });
          } catch {
            failedDeletes.push(old.id);
          }
        }

        // Verify deletions actually went through
        if (failedDeletes.length === 0) {
          // Double-check: re-query to make sure old entries are gone
          const verifyEntries = await apiFetch<RawEntry[]>(
            `/v1/time_entry/employee/id/${employeeId}/updated?updatedAfter=${updatedAfter}`
          ).catch(() => [] as RawEntry[]);

          const stillExist = verifyEntries.filter(
            (e) => matches.some((m) => m.id === e.id) && e.status !== "DELETED"
          );

          if (stillExist.length > 0) {
            throw new Error(
              `Consolidated entry created, but ${stillExist.length} old entries couldn't be removed from AgileDay. ` +
                `Please clean up duplicates manually in AgileDay's Time Reporting page.`
            );
          }
        } else {
          throw new Error(
            `Consolidated entry created, but ${failedDeletes.length} of ${matches.length} old entries couldn't be deleted. ` +
              `Please clean up duplicates manually in AgileDay's Time Reporting page.`
          );
        }
      } else {
        // 4. No matches — create new entry
        const results = await apiFetch<RawEntry[]>(`/v1/time_entry/employee/id/${employeeId}`, {
          method: "POST",
          body: JSON.stringify([
            {
              date: entry.date,
              minutes: entry.minutes,
              status: "SAVED",
              projectId: entry.projectId,
              ...(entry.taskId ? { taskId: entry.taskId } : {}),
              ...(desc ? { description: desc } : {}),
            },
          ]),
        });
        if (results.length === 0) throw new Error("No entry returned from API");
        created = results[0];
      }

      // Cache for description lookups on reload
      descriptionCache.set(created.id, desc);

      return {
        id: created.id,
        description: desc,
        projectId: created.projectId,
        projectName: entry.projectName,
        taskId: created.taskId,
        date: created.date,
        startTime: entry.startTime,
        endTime: entry.endTime,
        minutes: created.minutes,
        status: created.status as TimeEntry["status"],
        syncStatus: "synced",
      };
    },

    async updateTimeEntry(
      employeeId: string,
      id: string,
      updates: Partial<TimeEntry>
    ): Promise<TimeEntry> {
      const body = [
        {
          id,
          ...(updates.description !== undefined ? { description: updates.description } : {}),
          ...(updates.projectId ? { projectId: updates.projectId } : {}),
          ...(updates.taskId ? { taskId: updates.taskId } : {}),
          ...(updates.minutes !== undefined ? { minutes: updates.minutes } : {}),
          ...(updates.status ? { status: updates.status } : {}),
          ...(updates.date ? { date: updates.date } : {}),
        },
      ];

      const results = await apiFetch<
        Array<{
          id: string;
          date: string;
          minutes: number;
          status: string;
          description?: string;
          projectId: string;
          taskId?: string;
        }>
      >(`/v1/time_entry/employee/id/${employeeId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      if (results.length === 0) throw new Error("No entry returned from API");
      const updated = results[0];

      return {
        id: updated.id,
        description: updated.description ?? "",
        projectId: updated.projectId,
        projectName: updates.projectName,
        taskId: updated.taskId,
        date: updated.date,
        startTime: updates.startTime ?? "",
        endTime: updates.endTime,
        minutes: updated.minutes,
        status: updated.status as TimeEntry["status"],
        syncStatus: "synced",
      };
    },

    async deleteTimeEntry(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const idsParam = ids.join(",");
      await apiFetch(`/v1/time_entry?ids=${idsParam}`, { method: "DELETE" });
    },

    async getAllocations(employeeId: string): Promise<Allocation[]> {
      const filter = JSON.stringify({ candidate: { in: [employeeId] } });
      const data = await apiFetch<{
        openings: Array<{
          projectlikeId: string;
          projectlikeName: string;
          allocation: number;
          allocationMode: string;
          allocations: Array<{ allocation: number; startDate: string }>;
          startDate: string;
          endDate: string;
          hours: number;
        }>;
      }>(`/v2/opening?limit=100&filter=${encodeURIComponent(filter)}`);

      return data.openings.map((o) => ({
        projectId: o.projectlikeId,
        projectName: o.projectlikeName,
        startDate: o.startDate,
        endDate: o.endDate,
        percentage: o.allocation,
        hours: o.hours,
        allocationMode: o.allocationMode,
        periods: o.allocations.map((a) => ({
          percentage: a.allocation,
          startDate: a.startDate,
        })),
      }));
    },

    async getMyProjects(employeeId: string) {
      const filter = JSON.stringify({ candidate: { in: [employeeId] } });
      const data = await apiFetch<{
        openings: Array<{
          projectlikeId: string;
          projectlikeType?: ProjectType | null;
          status: string;
        }>;
      }>(`/v2/opening?limit=100&filter=${encodeURIComponent(filter)}`);

      const byId = new Map<string, ProjectType | undefined>();
      for (const o of data.openings) {
        const prev = byId.get(o.projectlikeId);
        // Prefer non-null type if multiple openings exist for the same project
        if (prev === undefined && o.projectlikeType) {
          byId.set(o.projectlikeId, o.projectlikeType);
        } else if (!byId.has(o.projectlikeId)) {
          byId.set(o.projectlikeId, o.projectlikeType ?? undefined);
        }
      }
      return [...byId.entries()].map(([id, projectType]) => ({ id, projectType }));
    },
  };
}
