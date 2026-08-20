import type { Task } from "./types";

/**
 * Tenant-level "global default" tasks.
 *
 * 75 of ~495 active AgileDay projects own no tasks at all, which leaves them
 * untrackable in this app: no task means no `taskId`, and the timer refuses to
 * start without one. AgileDay's own web UI covers that case by offering a
 * tenant-level task labelled "(global default)" — a row in the task catalogue
 * with `projectId: null` and `defaultTemplate: true`.
 *
 * Those rows are only reachable through the undocumented `/v2/task` endpoint
 * (absent from `specs/agileday-tracker/openapi.yaml`), and that endpoint has no
 * usable server-side filter for them: `filter={"defaultTemplate":{"eq":true}}`,
 * `filter={"projectId":{"is":null}}`, `?defaultTemplate=true`, `?parentTaskId=null`
 * and `sortBy=` were all probed against the live API and are silently ignored,
 * returning an unfiltered page. Only `filter={"projectId":{"in":[…]}}` works,
 * which is the wrong direction.
 *
 * So discovery means paging the whole catalogue (~1519 rows, 8 pages) and
 * filtering client-side. That cost is paid at most once per session: the loader
 * memoises its promise, starts on first call rather than at module load, and
 * fetches every page after the first in parallel.
 */

/** Rows per page. 200 is the largest page size the endpoint honours. */
export const GLOBAL_TASK_PAGE_SIZE = 200;

/** Hard ceiling on pages, so a bad `totalPages` can't spin forever. */
const MAX_PAGES = 40;

interface RawV2Task {
  id?: unknown;
  name?: unknown;
  projectId?: unknown;
  active?: unknown;
  billable?: unknown;
  defaultTemplate?: unknown;
}

interface RawV2TaskPage {
  data?: unknown;
  pagination?: { totalPages?: unknown };
}

/** Minimal fetch contract: the loader validates the payload shape itself. */
export type GlobalTaskFetch = (path: string) => Promise<unknown>;

function pagePath(pageIndex: number): string {
  return `/v2/task?limit=${GLOBAL_TASK_PAGE_SIZE}&offset=${pageIndex * GLOBAL_TASK_PAGE_SIZE}`;
}

function isGlobalDefault(raw: RawV2Task): boolean {
  // Both conditions matter. 314 tasks in the real tenant carry
  // `defaultTemplate: true` while belonging to a project — those are per-project
  // instances of a template, not global defaults, and pulling them in would
  // offer hundreds of other projects' tasks on every project.
  return raw.projectId == null && raw.defaultTemplate === true;
}

function toTask(raw: RawV2Task): Task {
  return {
    id: String(raw.id),
    // Global defaults have no project of their own. The caller rewrites this to
    // the project being asked about; until then it is deliberately blank.
    projectId: "",
    name: typeof raw.name === "string" ? raw.name : "",
    billable: raw.billable === true,
    // Never gated on the API's `active`: the one real global default is
    // `active: false` and AgileDay's web UI offers it anyway.
    active: true,
    defaultTemplate: true,
  };
}

function readPage(payload: unknown): { tasks: Task[]; totalPages: number } {
  const envelope = payload as RawV2TaskPage | null;
  if (!envelope || !Array.isArray(envelope.data)) {
    throw new Error("Unexpected /v2/task response shape");
  }
  const rawTotal = envelope.pagination?.totalPages;
  const totalPages = typeof rawTotal === "number" && rawTotal > 0 ? rawTotal : 1;
  return {
    tasks: (envelope.data as RawV2Task[]).filter(isGlobalDefault).map(toTask),
    totalPages: Math.min(totalPages, MAX_PAGES),
  };
}

/**
 * Collapses repeated ids, keeping the first occurrence.
 *
 * `/v2/task` has no deterministic sort — `sortBy` is ignored — and the pages
 * after the first are fetched in parallel, so a row can shift between offsets
 * and land in two responses. Duplicates would reach React as duplicate keys.
 */
function dedupeById(tasks: Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const task of tasks) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  return [...byId.values()];
}

/**
 * Builds a memoised loader for the tenant's global default tasks.
 *
 * Never rejects — a failure resolves to `[]`, leaving the caller with whatever
 * project-owned tasks it already has. `/v2/task` is undocumented and carries no
 * stability guarantee, so a breaking change there must degrade to the app's
 * previous behaviour rather than break the task picker outright. A failed
 * attempt clears the memo so a later call can retry.
 */
export function createGlobalDefaultTaskLoader(apiFetch: GlobalTaskFetch): () => Promise<Task[]> {
  let inFlight: Promise<Task[]> | null = null;

  async function load(): Promise<Task[]> {
    const first = readPage(await apiFetch(pagePath(0)));
    if (first.totalPages <= 1) return dedupeById(first.tasks);

    const rest = await Promise.all(
      Array.from({ length: first.totalPages - 1 }, (_, i) =>
        apiFetch(pagePath(i + 1)).then((payload) => readPage(payload).tasks)
      )
    );
    return dedupeById([...first.tasks, ...rest.flat()]);
  }

  return () => {
    if (!inFlight) {
      inFlight = load().catch(() => {
        // Drop the memo so the next caller gets a fresh attempt.
        inFlight = null;
        return [];
      });
    }
    return inFlight;
  };
}
