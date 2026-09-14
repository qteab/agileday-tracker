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
 * How far back to sweep for the task index when nothing is cached yet. Kept
 * short because the normal path reuses weeks the entry read already fetched.
 */
const TASK_INDEX_WEEKS = 8;

/**
 * Ceiling on concurrent MCP calls.
 *
 * Reads are one request per week, so a long flex window would otherwise open
 * dozens of sockets at once — the app stalls and the server sees a burst.
 */
const MAX_CONCURRENT_CALLS = 4;

/** Statuses whose entries AgileDay still lets the app change. */
const EDITABLE_STATUSES = new Set<TimeEntry["status"]>(["NEW", "SAVED", "CHANGE_REQUESTED"]);

/** Opening ids per `get_opening_details` call. */
const OPENING_DETAIL_BATCH = 20;

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
  /**
   * Called with a human-readable description of what the provider is doing,
   * and with null when it goes idle.
   *
   * Reads here are one request per week, so a wide window takes visibly longer
   * than the REST provider ever did. A bare "Loading..." leaves the user unable
   * to tell slow from stuck.
   */
  onProgress?: (status: string | null) => void;
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

interface McpOpening {
  opening_id: string;
  project_id: string;
  project_name?: string;
  project_type?: string;
  start_date?: string;
  end_date?: string;
  /** Percentage in both allocation modes — the server converts hours mode. */
  allocation?: number;
  hours?: number;
  allocation_mode?: string;
}

interface McpOpeningsResult {
  openings?: McpOpening[];
  count?: number;
}

/** `search_projects` answers with this envelope, not a bare array. */
interface McpProjectsPage {
  projects?: McpProjectSummary[];
  total_count?: number;
  limit?: number;
  offset?: number;
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

/** Split into fixed-size batches, for tools that cap ids per call. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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

  function report(status: string | null): void {
    config.onProgress?.(status);
  }

  function call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    // Every tool takes a `reason`; the server logs it against the call.
    return client.callTool<T>(tool, { reason: "QTE Time Tracker (beta MCP backend)", ...args });
  }

  /**
   * Week timecards already fetched, keyed `employeeId:week`.
   *
   * Reads are per week, and a single app load wants overlapping weeks several
   * times over: the entry window, the flex/vacation pre-window, the allocation
   * view and the task index all ask for weeks the others already pulled.
   * Caching the in-flight promise (not just the result) collapses that to one
   * request per week and dedupes concurrent callers.
   */
  const weekCache = new Map<string, Promise<McpTimecard>>();

  function cacheKey(empId: string, week: string): string {
    return `${empId}:${week}`;
  }

  function fetchWeek(empId: string, week: string): Promise<McpTimecard> {
    const key = cacheKey(empId, week);
    const cached = weekCache.get(key);
    if (cached) return cached;

    const pending = call<McpTimecard>("show_timecard", { employee_id: empId, week }).catch(
      (err) => {
        // Don't leave a rejected promise in the cache — a later read would
        // inherit the failure instead of retrying.
        weekCache.delete(key);
        throw err;
      }
    );
    weekCache.set(key, pending);
    return pending;
  }

  /** Drop cached weeks after a write so the next read sees the new state. */
  function invalidateWeeks(): void {
    weekCache.clear();
  }

  /**
   * Read a week bypassing the cache.
   *
   * The lookup before a write has to see the server's current state: acting on
   * a week cached at app start would miss an entry added since — in the web app
   * or by another device — and append a duplicate row instead of updating it.
   */
  function fetchWeekFresh(empId: string, week: string): Promise<McpTimecard> {
    weekCache.delete(cacheKey(empId, week));
    return fetchWeek(empId, week);
  }

  /**
   * Resolve `tasks` with at most `limit` requests in flight.
   *
   * `show_timecard` is one call per week, so an unbounded `Promise.all` over a
   * long flex window opens dozens of sockets at once and the whole app stalls
   * behind them. A small pool keeps the load responsive.
   */
  async function mapLimit<T, R>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await task(items[index]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  /**
   * project id → task ids seen in timecard history.
   *
   * Built from whatever weeks the cache already holds, so in the normal flow —
   * where the entry window has just been read — it costs nothing. Only a cold
   * cache pays for a short sweep of recent weeks.
   */
  let taskIndex: Promise<Map<string, Set<string>>> | null = null;

  function loadTaskIndex(): Promise<Map<string, Set<string>>> {
    if (!taskIndex) {
      taskIndex = (async () => {
        // Only a cold cache needs the employee lookup and the sweep; the
        // normal path reuses weeks the entry read already pulled.
        if (weekCache.size === 0) {
          report("Looking up tasks from recent timecards...");
          const empId = await employeeId();
          const weeks: string[] = [];
          const cursor = new Date(fmtDate(getWeekStart(now())));
          for (let i = 0; i < TASK_INDEX_WEEKS; i++) {
            weeks.push(fmtDate(cursor));
            cursor.setDate(cursor.getDate() - 7);
          }
          await mapLimit(weeks, MAX_CONCURRENT_CALLS, (week) =>
            fetchWeek(empId, week).catch(() => null)
          );
        }

        const index = new Map<string, Set<string>>();
        const cards = await Promise.all(
          [...weekCache.values()].map((pending) => pending.catch(() => null))
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

  /**
   * The entry AgileDay already holds for this (project, task, date), if any.
   *
   * Matches the REST provider's rule: project and task identify the row, the
   * description does not — saving overwrites it. Submitted and approved weeks
   * are skipped because they can no longer be edited, so a new row is correct
   * there.
   */
  async function findSameDayEntry(
    empId: string,
    entry: Omit<TimeEntry, "id" | "syncStatus">
  ): Promise<TimeEntry | null> {
    const card = await fetchWeekFresh(empId, mondayOf(entry.date)).catch(() => null);
    if (!card || !EDITABLE_STATUSES.has(weekStatus(card.status))) return null;

    const wanted = entry.taskId ?? "";
    return (
      timecardToEntries(card).find(
        (candidate) =>
          candidate.date === entry.date &&
          candidate.projectId === entry.projectId &&
          (candidate.taskId ?? "") === wanted
      ) ?? null
    );
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
    // Cached weeks now describe pre-write state, so the next read must refetch.
    invalidateWeeks();
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

    /**
     * The whole active-project catalogue, ~5 pages of 100.
     *
     * The timesheet itself only needs allocated projects plus whatever the
     * entries reference, but the picker's search filters across every active
     * project, and entries on projects the user is no longer allocated to
     * still need a name from somewhere. So the full list is fetched — the
     * first page reveals `total_count`, and the rest go out together rather
     * than one after another.
     */
    async getProjects(): Promise<Project[]> {
      report("Loading projects...");

      // The tool answers with an envelope — `{projects, total_count, limit,
      // offset}` — not a bare array.
      const first = await call<McpProjectsPage>("search_projects", {
        stage: "ONGOING",
        limit: PROJECT_PAGE_SIZE,
        offset: 0,
      });
      const firstPage = first?.projects;
      if (!Array.isArray(firstPage) || firstPage.length === 0) {
        report(null);
        return [];
      }

      const total = first.total_count ?? firstPage.length;
      const remaining = Math.min(
        Math.max(0, Math.ceil(total / PROJECT_PAGE_SIZE) - 1),
        MAX_PROJECT_PAGES - 1
      );
      report(`Loading projects — ${total} total...`);

      const laterPages = await mapLimit(
        Array.from({ length: remaining }, (_, i) => (i + 1) * PROJECT_PAGE_SIZE),
        MAX_CONCURRENT_CALLS,
        async (offset) => {
          const page = await call<McpProjectsPage>("search_projects", {
            stage: "ONGOING",
            limit: PROJECT_PAGE_SIZE,
            offset,
          });
          return page?.projects ?? [];
        }
      );
      report(null);

      const collected = [...firstPage, ...laterPages.flat()];
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
      let done = 0;
      report(`Loading ${weeks.length} weeks of time entries...`);

      // A missing week silently understates the flex balance rather than
      // looking broken, so a week that fails twice fails the whole read.
      const cards = await mapLimit(weeks, MAX_CONCURRENT_CALLS, async (week) => {
        try {
          return await fetchWeek(employeeIdArg, week).catch(() => fetchWeek(employeeIdArg, week));
        } finally {
          done++;
          report(`Loading time entries — week ${done} of ${weeks.length}...`);
        }
      });
      report(null);

      // The window rarely aligns to week boundaries, so trim the overhang.
      return cards
        .flatMap(timecardToEntries)
        .filter((entry) => entry.date >= startDate && entry.date <= endDate);
    },

    async createTimeEntry(
      employeeIdArg: string,
      entry: Omit<TimeEntry, "id" | "syncStatus">
    ): Promise<TimeEntry> {
      // The app is the source of truth on save. If AgileDay already holds an
      // entry for this (project, task, date), overwrite it — appending instead
      // is what produced a fresh row on every timer stop.
      const existing = await findSameDayEntry(employeeIdArg, entry);

      const [card] = await applyOperations(
        [
          existing
            ? {
                date: entry.date,
                op: {
                  action: "update",
                  hour_id: existing.id,
                  minutes: entry.minutes,
                  description: entry.description ?? "",
                },
              }
            : {
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
      const written = timecardToEntries(card ?? { week: entry.date }).find((candidate) =>
        existing
          ? candidate.id === existing.id
          : candidate.date === entry.date &&
            candidate.projectId === entry.projectId &&
            candidate.description === (entry.description ?? "")
      );

      return {
        ...entry,
        id: written?.id ?? existing?.id ?? "",
        status: written?.status ?? "SAVED",
        syncStatus: written || existing ? "synced" : "unsaved",
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

    /**
     * Allocations for the openings the user is contracted to.
     *
     * `suggested_hours` alone can't answer this: it carries a percentage but
     * no dates, and `AllocationView` returns 0 for any allocation without a
     * start and end date. `get_employee_allocations` would be the natural
     * tool but is not enabled for this OAuth client, so the opening ids come
     * from the week's timecard and `get_opening_details` supplies the spans.
     */
    async getAllocations(employeeIdArg: string): Promise<Allocation[]> {
      const card = await fetchWeek(employeeIdArg, fmtDate(getWeekStart(now())));

      const openingIds = [
        ...new Set(
          [
            ...(card.suggested_hours ?? []).map((suggestion) => suggestion.opening_id),
            ...(card.rows ?? []).map((row) => row.opening_id),
          ].filter((id): id is string => !!id)
        ),
      ];
      if (openingIds.length === 0) return [];

      report("Loading allocations...");
      const batches = await mapLimit(
        chunk(openingIds, OPENING_DETAIL_BATCH),
        MAX_CONCURRENT_CALLS,
        (ids) =>
          call<McpOpeningsResult>("get_opening_details", { opening_ids: ids }).catch(() => null)
      );
      report(null);

      return batches
        .flatMap((batch) => batch?.openings ?? [])
        .map((opening) => {
          // `allocation` is already a percentage in both allocation modes —
          // the server converts hours mode for us — so the single period is
          // reported as a percentage and needs no further normalisation.
          const percentage = Number.isFinite(opening.allocation) ? opening.allocation! : 0;
          return {
            projectId: opening.project_id,
            projectName: opening.project_name ?? "",
            startDate: opening.start_date ?? null,
            endDate: opening.end_date ?? null,
            percentage,
            hours: Number.isFinite(opening.hours) ? opening.hours! : 0,
            allocationMode: "allocation",
            // The tool reports one overall allocation rather than a period
            // breakdown, so the opening's whole span carries a single rate.
            periods: opening.start_date ? [{ startDate: opening.start_date, percentage }] : [],
          };
        });
    },

    async getMyProjects(employeeIdArg: string): Promise<MyProjectInfo[]> {
      const card = await fetchWeek(employeeIdArg, fmtDate(getWeekStart(now())));

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
