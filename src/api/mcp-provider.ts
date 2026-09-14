/**
 * Beta ApiProvider backed by AgileDay's MCP interface.
 *
 * Exists because AgileDay withdrew REST-audience token issuance from OAuth:
 * tokens now carry `aud: <base>/api/v1/mcp` and every REST endpoint answers
 * 401. The MCP endpoint is the only surface those tokens open.
 *
 * Two capabilities have no MCP equivalent and are handled here rather than
 * left broken:
 *
 * - **Tasks.** No tool lists a project's tasks, and `get_project_details`
 *   doesn't include them. Task ids are recovered from timecard history, which
 *   covers projects you've logged to before and nothing else. Task *names*
 *   appear nowhere in the MCP surface, so the picker shows a short id.
 * - **Holidays.** No tool serves them; computed locally (`holidays-se`).
 *
 * Everything else maps onto tools directly. Every call passes its arguments in
 * full so the server never falls back to host elicitation — that path expects
 * an interactive LLM, which a menu-bar timer is not.
 */

import type { ApiProvider, MyProjectInfo } from "./provider";
import type { Allocation, Employee, Holiday, Project, ProjectType, Task, TimeEntry } from "./types";
import type { AuthConfig, AuthState } from "./auth";
import { createMcpClient, type McpClient } from "./mcp-client";
import { createTokenProvider } from "./token";
import { holidaysInRange } from "../utils/holidays-se";
import { getWeekStart, fmtDate } from "../utils/week";

/** Page size for project search. 100 is the tool's documented maximum. */
const PROJECT_PAGE_SIZE = 100;

/** Hard ceiling on project pages, so a bad total can't spin forever. */
const MAX_PROJECT_PAGES = 20;

/**
 * How far back to mine timecards when building the task index. Deep enough to
 * cover projects worked earlier in the year, shallow enough to stay cheap —
 * `show_timecard` is one call per week.
 */
const TASK_INDEX_WEEKS = 26;

// Same palette as the REST provider so a backend switch doesn't recolour the UI.
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

export interface McpProviderConfig {
  /** e.g. "https://qvik.agileday.io/api" */
  apiBaseUrl: string;
  authConfig: AuthConfig;
}

// --- MCP payload shapes -------------------------------------------------

interface McpHour {
  id: string;
  date: string; // ISO timestamp, e.g. "2026-09-08T00:00:00Z"
  minutes: number;
  description?: string;
}

interface McpTimecardRow {
  id: string;
  project_id: string;
  task_id?: string;
  opening_id?: string;
  hours?: McpHour[];
}

interface McpTimecard {
  week: string;
  status?: string;
  rows?: McpTimecardRow[];
  suggested_hours?: Array<{
    project_id: string;
    project_name?: string;
    customer_name?: string;
    opening_id?: string;
    allocation_percent?: number;
    hours?: number;
  }>;
}

interface McpProjectSummary {
  projectId?: string;
  id?: string;
  name?: string;
  customerName?: string;
  projectType?: string;
  stage?: string;
}

// --- helpers ------------------------------------------------------------

/** `2026-09-08T00:00:00Z` → `2026-09-08`. */
function dateOnly(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** Monday of the week containing a YYYY-MM-DD date, as YYYY-MM-DD. */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return fmtDate(getWeekStart(new Date(y, m - 1, d)));
}

/** Every Monday from the week of `startDate` through the week of `endDate`. */
export function weeksInRange(startDate: string, endDate: string): string[] {
  if (startDate > endDate) return [];
  const weeks: string[] = [];
  const [y, m, d] = mondayOf(startDate).split("-").map(Number);
  const cursor = new Date(y, m - 1, d);
  const last = mondayOf(endDate);
  // Bounded by construction: cursor advances 7 days each pass.
  for (let guard = 0; guard < 520; guard++) {
    const week = fmtDate(cursor);
    weeks.push(week);
    if (week >= last) break;
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

/**
 * A timecard's status applies to the whole week, so every entry in it inherits
 * the same value. The REST provider models status per entry; this is the
 * closest honest mapping.
 */
function weekStatus(status: string | undefined): TimeEntry["status"] {
  switch (status) {
    case "SUBMITTED":
    case "APPROVED":
    case "CHANGE_REQUESTED":
    case "SAVED":
    case "NEW":
      return status;
    default:
      return "SAVED";
  }
}

function timecardToEntries(card: McpTimecard): TimeEntry[] {
  const status = weekStatus(card.status);
  const entries: TimeEntry[] = [];
  for (const row of card.rows ?? []) {
    for (const hour of row.hours ?? []) {
      entries.push({
        id: hour.id,
        description: hour.description ?? "",
        projectId: row.project_id,
        openingId: row.opening_id,
        taskId: row.task_id,
        date: dateOnly(hour.date),
        startTime: "",
        minutes: hour.minutes,
        status,
        syncStatus: "synced",
      });
    }
  }
  return entries;
}

export function createMcpProvider(
  config: McpProviderConfig,
  getAuthState: () => AuthState | null,
  setAuthState: (state: AuthState) => void,
  clearAuthState: () => void,
  /** Override fetch for testing — defaults to the Tauri HTTP plugin. */
  fetchOverride?: typeof globalThis.fetch,
  /** Override the clock for testing. */
  now: () => Date = () => new Date()
): ApiProvider {
  const getValidToken = createTokenProvider({
    authConfig: config.authConfig,
    getAuthState,
    setAuthState,
    clearAuthState,
  });

  const client: McpClient = createMcpClient(
    { apiBaseUrl: config.apiBaseUrl },
    getValidToken,
    getAuthState,
    fetchOverride
  );

  function call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    // Every tool takes a `reason`; the server logs it against the call.
    return client.callTool<T>(tool, { reason: "QTE Time Tracker (beta MCP backend)", ...args });
  }

  /**
   * project id → task ids seen in timecard history.
   *
   * Memoised per provider instance and resolved at most once: mining it costs
   * one `show_timecard` call per week. Failures resolve to an empty index so a
   * task-less project degrades rather than breaking the picker.
   */
  let taskIndex: Promise<Map<string, Set<string>>> | null = null;

  function loadTaskIndex(): Promise<Map<string, Set<string>>> {
    if (!taskIndex) {
      taskIndex = (async () => {
        const index = new Map<string, Set<string>>();
        const thisMonday = fmtDate(getWeekStart(now()));
        const weeks: string[] = [];
        const cursor = new Date(thisMonday);
        for (let i = 0; i < TASK_INDEX_WEEKS; i++) {
          weeks.push(fmtDate(cursor));
          cursor.setDate(cursor.getDate() - 7);
        }

        const cards = await Promise.all(
          weeks.map((week) => call<McpTimecard>("show_timecard", { week }).catch(() => null))
        );

        for (const card of cards) {
          for (const row of card?.rows ?? []) {
            if (!row.task_id) continue;
            const set = index.get(row.project_id) ?? new Set<string>();
            set.add(row.task_id);
            index.set(row.project_id, set);
          }
        }
        return index;
      })().catch(() => new Map<string, Set<string>>());
    }
    return taskIndex;
  }

  async function employeeId(): Promise<string> {
    const auth = getAuthState();
    if (!auth?.accessToken) throw new Error("Not authenticated — please sign in");
    const profile = await call<{ employee_id: string }>("get_employee_profile", {
      sections: ["basic"],
    });
    return profile.employee_id;
  }

  /**
   * One timecard operation plus the date used to route it to a week.
   *
   * `add` ops carry their own `date`, but `update` and `delete` identify the
   * row by `hour_id` alone. `update_timecard` only derives the week from the
   * operations' dates — with neither a date nor an explicit `week` it falls
   * back to asking the host to pick one, which is the elicitation path a
   * headless client can't answer. So the week travels separately.
   */
  interface WeekedOperation {
    op: Record<string, unknown>;
    /** YYYY-MM-DD the operation belongs to, when known. */
    date?: string;
  }

  /**
   * Apply timecard operations, one call per week so the target is never
   * ambiguous. Operations whose week is unknown (a delete, which carries only
   * an hour id) go in a final un-pinned call — the server resolves those from
   * the id itself.
   */
  async function applyOperations(
    operations: WeekedOperation[],
    empId: string
  ): Promise<McpTimecard[]> {
    const byWeek = new Map<string, Array<Record<string, unknown>>>();
    for (const { op, date } of operations) {
      const week = date ? mondayOf(date) : "";
      const bucket = byWeek.get(week) ?? [];
      bucket.push(op);
      byWeek.set(week, bucket);
    }

    const results: McpTimecard[] = [];
    for (const [week, ops] of byWeek) {
      results.push(
        await call<McpTimecard>("update_timecard", {
          employee_id: empId,
          operations: ops,
          ...(week ? { week } : {}),
        })
      );
    }
    return results;
  }

  return {
    async getCurrentEmployee(): Promise<Employee> {
      const auth = getAuthState();
      if (!auth?.accessToken) throw new Error("Not authenticated — please sign in");

      const profile = await call<{
        employee_id: string;
        basic?: { name?: string; email?: string };
      }>("get_employee_profile", { sections: ["basic"] });

      return {
        id: profile.employee_id,
        name: profile.basic?.name || "User",
        email: profile.basic?.email || "",
      };
    },

    async getProjects(): Promise<Project[]> {
      const collected: McpProjectSummary[] = [];
      for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
        const batch = await call<McpProjectSummary[]>("search_projects", {
          stage: "ONGOING",
          limit: PROJECT_PAGE_SIZE,
          offset: page * PROJECT_PAGE_SIZE,
        });
        if (!Array.isArray(batch) || batch.length === 0) break;
        collected.push(...batch);
        if (batch.length < PROJECT_PAGE_SIZE) break;
      }

      return collected.map((p, i) => ({
        id: String(p.projectId ?? p.id),
        name: p.name ?? "",
        customerName: p.customerName,
        projectType: p.projectType as ProjectType | undefined,
        color: assignProjectColor(i),
      }));
    },

    async getAbsenceProjects(): Promise<Project[]> {
      // `/v1/absence` has no MCP counterpart — `list_absence_types` returns the
      // tenant's absence *type* catalogue, which is a different entity and not
      // something hours are logged against. Absence projectlikes the user is
      // allocated to still reach the picker through getMyProjects, which
      // `mergeProjectSources` already folds in.
      return [];
    },

    async getTasks(projectId: string): Promise<Task[]> {
      const index = await loadTaskIndex();
      const ids = [...(index.get(projectId) ?? [])];

      // Names exist nowhere in the MCP surface. A short id at least lets the
      // user tell two tasks apart and keeps previously-used tasks selectable.
      return ids.map((id) => ({
        id,
        projectId,
        name: `Task ${id.slice(0, 8)}`,
        billable: true,
        active: true,
      }));
    },

    async getTimeEntries(
      employeeIdArg: string,
      startDate: string,
      endDate: string
    ): Promise<TimeEntry[]> {
      const weeks = weeksInRange(startDate, endDate);
      const cards = await Promise.all(
        weeks.map((week) =>
          call<McpTimecard>("show_timecard", { employee_id: employeeIdArg, week }).catch(() => null)
        )
      );

      // The window rarely aligns to week boundaries, so trim the overhang.
      return cards
        .filter((card): card is McpTimecard => card !== null)
        .flatMap(timecardToEntries)
        .filter((entry) => entry.date >= startDate && entry.date <= endDate);
    },

    async createTimeEntry(
      employeeIdArg: string,
      entry: Omit<TimeEntry, "id" | "syncStatus">
    ): Promise<TimeEntry> {
      const [card] = await applyOperations(
        [
          {
            date: entry.date,
            op: {
              action: "add",
              date: entry.date,
              minutes: entry.minutes,
              project_id: entry.projectId,
              ...(entry.taskId ? { task_id: entry.taskId } : {}),
              ...(entry.openingId ? { opening_id: entry.openingId } : {}),
              ...(entry.description ? { description: entry.description } : {}),
            },
          },
        ],
        employeeIdArg
      );

      // Recover the server-assigned hour id by finding the row we just wrote.
      const written = timecardToEntries(card ?? { week: entry.date }).find(
        (candidate) =>
          candidate.date === entry.date &&
          candidate.projectId === entry.projectId &&
          candidate.description === entry.description
      );

      return {
        ...entry,
        id: written?.id ?? "",
        status: written?.status ?? "SAVED",
        syncStatus: written ? "synced" : "unsaved",
      };
    },

    async updateTimeEntry(
      employeeIdArg: string,
      id: string,
      updates: Partial<TimeEntry>
    ): Promise<TimeEntry> {
      const [card] = await applyOperations(
        [
          {
            date: updates.date,
            op: {
              action: "update",
              hour_id: id,
              ...(updates.minutes !== undefined ? { minutes: updates.minutes } : {}),
              ...(updates.description !== undefined ? { description: updates.description } : {}),
            },
          },
        ],
        employeeIdArg
      );

      const updated = timecardToEntries(card ?? { week: "" }).find((entry) => entry.id === id);
      if (updated) return updated;

      // The server accepted the write but didn't echo the row back.
      return {
        id,
        description: updates.description ?? "",
        projectId: updates.projectId ?? "",
        taskId: updates.taskId,
        date: updates.date ?? "",
        startTime: "",
        minutes: updates.minutes ?? 0,
        status: updates.status ?? "SAVED",
        syncStatus: "synced",
      };
    },

    async deleteTimeEntry(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const empId = await employeeId();
      // No date is available from an id alone, so these go un-pinned and the
      // server resolves each row's week from its hour id.
      await applyOperations(
        ids.map((id) => ({ op: { action: "delete", hour_id: id } })),
        empId
      );
    },

    async batchUpdateEntries(
      employeeIdArg: string,
      updates: Array<{ id: string } & Partial<TimeEntry>>
    ): Promise<TimeEntry[]> {
      if (updates.length === 0) return [];

      const cards = await applyOperations(
        updates.map((update) => ({
          date: update.date,
          op: {
            action: "update",
            hour_id: update.id,
            ...(update.minutes !== undefined ? { minutes: update.minutes } : {}),
            ...(update.description !== undefined ? { description: update.description } : {}),
          },
        })),
        employeeIdArg
      );

      const byId = new Map(
        cards.flatMap(timecardToEntries).map((entry) => [entry.id, entry] as const)
      );
      return updates.map(
        (update) =>
          byId.get(update.id) ?? {
            id: update.id,
            description: update.description ?? "",
            projectId: update.projectId ?? "",
            taskId: update.taskId,
            date: update.date ?? "",
            startTime: "",
            minutes: update.minutes ?? 0,
            status: update.status ?? "SAVED",
            syncStatus: "synced" as const,
          }
      );
    },

    async getAllocations(employeeIdArg: string): Promise<Allocation[]> {
      // The current week's timecard carries the allocation view the tracker
      // needs — one suggested_hours row per contracted opening, with the
      // opening's percentage and hours already resolved.
      const card = await call<McpTimecard>("show_timecard", {
        employee_id: employeeIdArg,
        week: fmtDate(getWeekStart(now())),
      });

      return (card.suggested_hours ?? []).map((suggestion) => ({
        projectId: suggestion.project_id,
        projectName: suggestion.project_name ?? "",
        startDate: null,
        endDate: null,
        percentage: suggestion.allocation_percent ?? 0,
        hours: suggestion.hours ?? 0,
        allocationMode: "allocation",
        periods: [],
      }));
    },

    async getMyProjects(employeeIdArg: string): Promise<MyProjectInfo[]> {
      const card = await call<McpTimecard>("show_timecard", {
        employee_id: employeeIdArg,
        week: fmtDate(getWeekStart(now())),
      });

      const byId = new Map<string, MyProjectInfo>();
      for (const suggestion of card.suggested_hours ?? []) {
        if (byId.has(suggestion.project_id)) continue;
        byId.set(suggestion.project_id, {
          id: suggestion.project_id,
          name: suggestion.project_name,
          openingId: suggestion.opening_id,
        });
      }
      // Rows without a suggestion still represent projects worked this week.
      for (const row of card.rows ?? []) {
        if (byId.has(row.project_id)) continue;
        byId.set(row.project_id, { id: row.project_id, openingId: row.opening_id });
      }
      return [...byId.values()];
    },

    async getHolidays(countryCode: string, startDate: string, endDate: string): Promise<Holiday[]> {
      return holidaysInRange(countryCode, startDate, endDate);
    },
  };
}
