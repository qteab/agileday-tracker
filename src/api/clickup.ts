import { load } from "@tauri-apps/plugin-store";
import { splitDescriptions, joinDescriptions } from "../utils/descriptions";

/**
 * ClickUp integration. Time on a ClickUp task is logged as a ClickUp time entry
 * (real start + duration) and also folded into the day's AgileDay entry for the
 * chosen project+task, where the task appears as one `CU-<id> <name>` line.
 */

const API = "https://api.clickup.com/api/v2";

export interface ClickUpConfig {
  /** Personal API token (pk_…), from ClickUp → Settings → Apps. */
  token: string;
  teamId: string;
  teamName: string;
}

export interface ClickUpTask {
  id: string;
  name: string;
}

export interface ClickUpTimeEntry {
  id: string;
  taskId: string;
  taskName: string;
  /** Unix ms */
  start: number;
  /** ms; negative while the timer is still running (ClickUp convention) */
  duration: number;
}

/** Minutes a session counts as — same rule the app timer uses for AgileDay. */
export function sessionMinutes(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / 60000));
}

// ---------- description lines ----------

const LINE_RE = /^CU-([a-z0-9]+)(?:\s+(.*))?$/i;

export function clickupLine(task: ClickUpTask): string {
  return `CU-${task.id} ${task.name}`.trim();
}

export function parseClickupLine(line: string): ClickUpTask | null {
  const m = line.match(LINE_RE);
  return m ? { id: m[1], name: m[2] ?? "" } : null;
}

/** ClickUp tasks referenced by a description, in order. */
export function clickupTasksIn(description: string): ClickUpTask[] {
  return splitDescriptions(description)
    .map(parseClickupLine)
    .filter((t): t is ClickUpTask => t !== null);
}

/** Description lines that are not ClickUp lines. */
export function nonClickupLines(description: string): string[] {
  return splitDescriptions(description).filter((l) => !parseClickupLine(l));
}

export function withClickupLine(description: string, task: ClickUpTask): string {
  if (clickupTasksIn(description).some((t) => t.id === task.id)) return description;
  return joinDescriptions([...splitDescriptions(description), clickupLine(task)]);
}

export function withoutClickupLine(description: string, taskId: string): string {
  return joinDescriptions(
    splitDescriptions(description).filter((l) => parseClickupLine(l)?.id !== taskId)
  );
}

/**
 * Turn a pasted task URL / id into a ClickUp task reference. Accepts
 * `https://app.clickup.com/t/86c0abcd1`, `…/t/<team>/DEV-123`, `86c0abcd1`,
 * `#86c0abcd1`, `CU-86c0abcd1` and custom ids like `DEV-123`.
 */
export function parseTaskRef(input: string): { id: string; custom: boolean } | null {
  let s = input.trim();
  const url = s.match(/clickup\.com\/t\/(?:\d+\/)?([^/?#\s]+)/i);
  if (url) s = url[1];
  s = s.replace(/^#/, "").replace(/^CU-/i, "");
  if (/^[a-z0-9]+$/i.test(s)) return { id: s, custom: false };
  if (/^[a-z0-9]+-\d+$/i.test(s)) return { id: s.toUpperCase(), custom: true };
  return null;
}

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function entryDate(e: ClickUpTimeEntry): string {
  return localDate(e.start);
}

// ---------- sync bookkeeping ----------

/**
 * Which ClickUp entries are already counted in AgileDay. Entries started before
 * `since` (start of the day ClickUp was connected) count as already handled.
 * ponytail: per-Mac record — on a second Mac, ClickUp time tracked earlier that
 * same day on a task already linked in AgileDay gets added a second time.
 */
export interface ClickUpSyncState {
  since: number;
  /** entry id → start ms (start kept so old ids can be pruned) */
  synced: Record<string, number>;
}

export function isAccounted(e: ClickUpTimeEntry, sync: ClickUpSyncState): boolean {
  return e.id.startsWith("local-") || e.start < sync.since || e.id in sync.synced;
}

/** Minutes per ClickUp task already in AgileDay for one date. */
export function accountedMinutes(
  entries: ClickUpTimeEntry[],
  sync: ClickUpSyncState,
  taskId: string,
  date: string
): number {
  return entries
    .filter((e) => e.taskId === taskId && e.duration > 0 && entryDate(e) === date)
    .filter((e) => isAccounted(e, sync))
    .reduce((sum, e) => sum + sessionMinutes(e.duration), 0);
}

/** Completed ClickUp time not yet in AgileDay, grouped per (date, task). */
export function unsyncedGroups(
  entries: ClickUpTimeEntry[],
  sync: ClickUpSyncState
): { date: string; task: ClickUpTask; entries: ClickUpTimeEntry[]; minutes: number }[] {
  const groups = new Map<
    string,
    { date: string; task: ClickUpTask; entries: ClickUpTimeEntry[]; minutes: number }
  >();
  for (const e of entries) {
    if (e.duration <= 0 || isAccounted(e, sync)) continue;
    const date = entryDate(e);
    const key = `${date}|${e.taskId}`;
    const g = groups.get(key) ?? {
      date,
      task: { id: e.taskId, name: e.taskName },
      entries: [],
      minutes: 0,
    };
    g.entries.push(e);
    g.minutes += sessionMinutes(e.duration);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function markSynced(
  sync: ClickUpSyncState,
  entries: Pick<ClickUpTimeEntry, "id" | "start">[]
): ClickUpSyncState {
  const cutoff = Date.now() - 45 * 86_400_000;
  const synced: Record<string, number> = {};
  for (const [id, start] of Object.entries(sync.synced)) if (start >= cutoff) synced[id] = start;
  for (const e of entries) synced[e.id] = e.start;
  return { ...sync, synced };
}

// ---------- persistence ----------

export interface ClickUpStored {
  config: ClickUpConfig;
  sync: ClickUpSyncState;
}

const STORE_FILE = "clickup.json";
const KEY = "clickup";

export async function loadClickUp(): Promise<ClickUpStored | null> {
  const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
  return (await store.get<ClickUpStored>(KEY)) ?? null;
}

export async function saveClickUp(value: ClickUpStored | null): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
  if (value) await store.set(KEY, value);
  else await store.delete(KEY);
  await store.save();
}

// ---------- API ----------

let resolvedFetch: typeof globalThis.fetch | null = null;
async function tauriFetch(): Promise<typeof globalThis.fetch> {
  if (!resolvedFetch) {
    try {
      resolvedFetch = (await import("@tauri-apps/plugin-http")).fetch;
    } catch {
      resolvedFetch = globalThis.fetch;
    }
  }
  return resolvedFetch;
}

type RawEntry = {
  id: string;
  task?: { id: string; name: string } | null;
  start: string | number;
  duration: string | number;
};

function toEntry(r: RawEntry): ClickUpTimeEntry | null {
  if (!r.task?.id) return null;
  return {
    id: String(r.id),
    taskId: r.task.id,
    taskName: r.task.name,
    start: Number(r.start),
    duration: Number(r.duration),
  };
}

export function createClickUpClient(
  token: string,
  teamId: string,
  fetchOverride?: typeof globalThis.fetch
) {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const doFetch = fetchOverride ?? (await tauriFetch());
    const res = await doFetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: token, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ClickUp ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  const team = `/team/${teamId}`;

  return {
    async getTeams(): Promise<{ id: string; name: string }[]> {
      const res = await call<{ teams: { id: string; name: string }[] }>("/team");
      return res.teams.map((t) => ({ id: String(t.id), name: t.name }));
    },

    async getTask(ref: { id: string; custom: boolean }): Promise<ClickUpTask> {
      const q = ref.custom ? `?custom_task_ids=true&team_id=${teamId}` : "";
      const t = await call<{ id: string; name: string }>(`/task/${encodeURIComponent(ref.id)}${q}`);
      return { id: t.id, name: t.name };
    },

    /** The authenticated user's time entries in [startMs, endMs]. */
    async getTimeEntries(startMs: number, endMs: number): Promise<ClickUpTimeEntry[]> {
      const res = await call<{ data: RawEntry[] }>(
        `${team}/time_entries?start_date=${startMs}&end_date=${endMs}`
      );
      return res.data.map(toEntry).filter((e): e is ClickUpTimeEntry => e !== null);
    },

    async getRunning(): Promise<ClickUpTimeEntry | null> {
      const res = await call<{ data: RawEntry | null }>(`${team}/time_entries/current`);
      return res.data ? toEntry(res.data) : null;
    },

    async createTimeEntry(
      taskId: string,
      start: number,
      duration: number
    ): Promise<ClickUpTimeEntry> {
      const res = await call<{ data?: RawEntry } & Partial<RawEntry>>(`${team}/time_entries`, {
        method: "POST",
        body: JSON.stringify({ tid: taskId, start, duration }),
      });
      const raw = res.data ?? (res as RawEntry);
      return { id: String(raw.id), taskId, taskName: "", start, duration };
    },

    async stopRunning(): Promise<void> {
      await call(`${team}/time_entries/stop`, { method: "POST" });
    },

    async updateTimeEntry(id: string, start: number, duration: number): Promise<void> {
      await call(`${team}/time_entries/${id}`, {
        method: "PUT",
        // `tags` is required by the API; adding none leaves the entry's tags alone.
        body: JSON.stringify({
          start,
          end: start + duration,
          duration,
          tags: [],
          tag_action: "add",
        }),
      });
    },

    async deleteTimeEntry(id: string): Promise<void> {
      await call(`${team}/time_entries/${id}`, { method: "DELETE" });
    },
  };
}

export type ClickUpClient = ReturnType<typeof createClickUpClient>;
