import type { ApiProvider } from "./provider";
import type { Allocation, Employee, Project, Task, TimeEntry } from "./types";
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

    if (isTokenExpired(auth)) {
      if (!auth.refreshToken) {
        clearAuthState();
        throw new Error("Session expired — please log in again");
      }
      try {
        const tokens = await refreshAccessToken(config.authConfig, auth.refreshToken);
        const newState = tokenResponseToAuthState(tokens);
        setAuthState(newState);
        return newState.accessToken;
      } catch {
        clearAuthState();
        throw new Error("Session expired — please log in again");
      }
    }

    return auth.accessToken;
  }

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
    const response = await doFetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: new URL(config.apiBaseUrl).origin,
        ...options.headers,
      },
    });

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
      // Use timesheets summary endpoint — returns all statuses including unsaved
      // Fetch each month in the range
      const startMonth = startDate.substring(0, 7) + "-01";
      const endMonth = endDate.substring(0, 7) + "-01";

      type SummaryEntry = {
        date: string;
        project: string;
        projectId: string;
        customer: string;
        minutes: number;
        status: string;
        employeeId: string;
      };

      const fetchMonth = (month: string) =>
        apiFetch<{ entries: SummaryEntry[] }>(
          `/v1/timesheets/${employeeId}/summary?date=${month}&intervalType=day&month=${month}`
        ).then((d) => d.entries);

      // Collect unique months to fetch
      const months = new Set<string>();
      months.add(startMonth);
      months.add(endMonth);

      const allEntries: SummaryEntry[] = [];
      for (const month of months) {
        const entries = await fetchMonth(month);
        allEntries.push(...entries);
      }

      return allEntries
        .filter((e) => e.minutes > 0 && e.date >= startDate && e.date <= endDate)
        .map((e, i) => ({
          id: `${e.projectId}-${e.date}-${i}`,
          description: "",
          projectId: e.projectId,
          projectName: e.project,
          date: e.date,
          startTime: `${e.date}T09:00:00.000Z`,
          minutes: e.minutes,
          status: e.status as TimeEntry["status"],
          syncStatus: "synced" as const,
        }));
    },

    async createTimeEntry(
      employeeId: string,
      entry: Omit<TimeEntry, "id" | "syncStatus">
    ): Promise<TimeEntry> {
      const body = [
        {
          date: entry.date,
          minutes: entry.minutes,
          status: entry.status || "SAVED",
          projectId: entry.projectId,
          ...(entry.taskId ? { taskId: entry.taskId } : {}),
          ...(entry.description ? { description: entry.description } : {}),
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
        method: "POST",
        body: JSON.stringify(body),
      });

      if (results.length === 0) throw new Error("No entry returned from API");
      const created = results[0];

      return {
        id: created.id,
        description: created.description ?? entry.description ?? "",
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

    async getAllocations(_employeeId: string): Promise<Allocation[]> {
      // TODO: Parse allocation data from openings for the allocation chart
      return [];
    },

    async getMyProjectIds(employeeId: string): Promise<string[]> {
      const filter = JSON.stringify({ candidate: { in: [employeeId] } });
      const data = await apiFetch<{
        openings: Array<{ projectlikeId: string; status: string }>;
      }>(`/v2/opening?limit=100&filter=${encodeURIComponent(filter)}`);

      const uniqueIds = [...new Set(data.openings.map((o) => o.projectlikeId))];
      return uniqueIds;
    },
  };
}
