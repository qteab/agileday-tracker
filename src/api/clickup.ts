import { load } from "@tauri-apps/plugin-store";
import { splitDescriptions, joinDescriptions } from "../utils/descriptions";

/**
 * ClickUp integration. Time on a ClickUp task is logged as a ClickUp time entry
 * (real start + duration) and also folded into the day's AgileDay entry for the
 * chosen project+task, where the task appears as one `CU-<id> <name>` line.
 */

const API = "https://api.clickup.com/api/v2";

export interface ClickUpTeam {
  id: string;
  name: string;
}

/** One ClickUp login. A personal token covers every workspace that login
 * belongs to; a separate login (e.g. a customer's ClickUp) needs its own. */
export interface ClickUpAccount {
  /** Personal API token (pk_…), from ClickUp → Settings → Apps. */
  token: string;
  /** Shown in settings to tell accounts apart. */
  email: string;
  /** Workspaces this login can see; refreshed on every sync. */
  teams: ClickUpTeam[];
}

export interface ClickUpConfig {
  accounts: ClickUpAccount[];
}

export interface ClickUpTask {
  id: string;
  name: string;
  /** Workspace the task lives in. Unknown for tasks parsed from a `CU-` line. */
  teamId?: string;
}

export interface ClickUpTimeEntry {
  id: string;
  teamId: string;
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
 * Which ClickUp entries are already counted in AgileDay. Per workspace, entries
 * started before `since` (start of the day it was connected) count as already
 * handled, as do entries in workspaces without a `since`.
 * ponytail: per-Mac record — on a second Mac, ClickUp time tracked earlier that
 * same day on a task already linked in AgileDay gets added a second time.
 */
export interface ClickUpSyncState {
  /** workspace id → start of the day it was connected (ms) */
  since: Record<string, number>;
  /** entry id → start ms (start kept so old ids can be pruned) */
  synced: Record<string, number>;
}

export function isAccounted(e: ClickUpTimeEntry, sync: ClickUpSyncState): boolean {
  return (
    e.id.startsWith("local-") || e.start < (sync.since[e.teamId] ?? Infinity) || e.id in sync.synced
  );
}

export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Add or refresh an account; workspaces seen for the first time start syncing today. */
export function upsertAccount(
  stored: ClickUpStored | null,
  account: ClickUpAccount
): ClickUpStored {
  const accounts = stored?.config.accounts ?? [];
  const since = { ...stored?.sync.since };
  for (const t of account.teams) since[t.id] ??= startOfToday();
  const i = accounts.findIndex((a) => a.token === account.token);
  return {
    config: {
      accounts: i < 0 ? [...accounts, account] : accounts.map((a, j) => (j === i ? account : a)),
    },
    sync: { synced: stored?.sync.synced ?? {}, since },
  };
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
      task: { id: e.taskId, name: e.taskName, teamId: e.teamId },
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
  return migrateStored((await store.get<ClickUpStored>(KEY)) ?? null);
}

/** The first version stored one token + one workspace and a single `since`. */
export function migrateStored(stored: ClickUpStored | null): ClickUpStored | null {
  if (!stored || Array.isArray(stored.config.accounts)) return stored;
  const old = stored as unknown as {
    config: { token: string; teamId: string; teamName: string };
    sync: { since: number; synced: Record<string, number> };
  };
  return {
    config: {
      accounts: [
        {
          token: old.config.token,
          email: "",
          teams: [{ id: old.config.teamId, name: old.config.teamName }],
        },
      ],
    },
    sync: { since: { [old.config.teamId]: old.sync.since }, synced: old.sync.synced },
  };
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

function toEntry(r: RawEntry, teamId: string): ClickUpTimeEntry | null {
  if (!r.task?.id) return null;
  return {
    id: String(r.id),
    teamId,
    taskId: r.task.id,
    taskName: r.task.name,
    start: Number(r.start),
    duration: Number(r.duration),
  };
}

/**
 * Workspace-scoped calls take the workspace id and use the token of the account
 * that workspace belongs to.
 */
export function createClickUpClient(
  accounts: Pick<ClickUpAccount, "token" | "teams">[],
  fetchOverride?: typeof globalThis.fetch
) {
  async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
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

  function call<T>(teamId: string, path: string, init?: RequestInit): Promise<T> {
    const account = accounts.find((a) => a.teams.some((t) => t.id === teamId));
    if (!account) throw new Error(`No connected ClickUp account for workspace ${teamId}`);
    return request<T>(account.token, `/team/${teamId}${path}`, init);
  }

  type RawTask = { id: string; name: string; team_id: string };
  const task = (t: RawTask): ClickUpTask => ({ id: t.id, name: t.name, teamId: String(t.team_id) });

  return {
    /** Who a token belongs to and which workspaces it can see. */
    async getAccount(token: string): Promise<ClickUpAccount> {
      const [{ user }, { teams }] = await Promise.all([
        request<{ user: { email: string } }>(token, "/user"),
        request<{ teams: { id: string; name: string }[] }>(token, "/team"),
      ]);
      return {
        token,
        email: user.email,
        teams: teams.map((t) => ({ id: String(t.id), name: t.name })),
      };
    },

    /** Look up a task in whichever account can see it. Custom ids are only
     * unique per workspace, so each workspace is tried in turn. */
    async getTask(ref: { id: string; custom: boolean }): Promise<ClickUpTask> {
      const path = `/task/${encodeURIComponent(ref.id)}`;
      const attempts = accounts.flatMap((a) =>
        ref.custom
          ? a.teams.map(
              (t) => () => request<RawTask>(a.token, `${path}?custom_task_ids=true&team_id=${t.id}`)
            )
          : [() => request<RawTask>(a.token, path)]
      );
      for (const attempt of attempts) {
        try {
          return task(await attempt());
        } catch {
          // not visible to this account / workspace — try the next
        }
      }
      throw new Error(`ClickUp task ${ref.id} not found`);
    },

    /** The authenticated user's time entries in [startMs, endMs]. */
    async getTimeEntries(
      teamId: string,
      startMs: number,
      endMs: number
    ): Promise<ClickUpTimeEntry[]> {
      const res = await call<{ data: RawEntry[] }>(
        teamId,
        `/time_entries?start_date=${startMs}&end_date=${endMs}`
      );
      return res.data
        .map((r) => toEntry(r, teamId))
        .filter((e): e is ClickUpTimeEntry => e !== null);
    },

    async getRunning(teamId: string): Promise<ClickUpTimeEntry | null> {
      const res = await call<{ data: RawEntry | null }>(teamId, "/time_entries/current");
      return res.data ? toEntry(res.data, teamId) : null;
    },

    async createTimeEntry(
      teamId: string,
      taskId: string,
      start: number,
      duration: number
    ): Promise<ClickUpTimeEntry> {
      const res = await call<{ data?: RawEntry } & Partial<RawEntry>>(teamId, "/time_entries", {
        method: "POST",
        body: JSON.stringify({ tid: taskId, start, duration }),
      });
      const raw = res.data ?? (res as RawEntry);
      return { id: String(raw.id), teamId, taskId, taskName: "", start, duration };
    },

    async stopRunning(teamId: string): Promise<void> {
      await call(teamId, "/time_entries/stop", { method: "POST" });
    },

    async updateTimeEntry(
      teamId: string,
      id: string,
      start: number,
      duration: number
    ): Promise<void> {
      await call(teamId, `/time_entries/${id}`, {
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

    async deleteTimeEntry(teamId: string, id: string): Promise<void> {
      await call(teamId, `/time_entries/${id}`, { method: "DELETE" });
    },
  };
}

export type ClickUpClient = ReturnType<typeof createClickUpClient>;
