import { describe, it, expect, vi } from "vitest";
import {
  accountedMinutes,
  clickupTasksIn,
  createClickUpClient,
  isClickupOnly,
  markSynced,
  migrateStored,
  nonClickupLines,
  parseTaskRef,
  startOfToday,
  unsyncedGroups,
  upsertAccount,
  withClickupLine,
  withoutClickupLine,
  type ClickUpStored,
  type ClickUpTimeEntry,
} from "../clickup";

const task = { id: "86c0abcd1", name: "Handle PC new parcel id format" };

describe("parseTaskRef", () => {
  it.each([
    ["https://app.clickup.com/t/86c0abcd1", { id: "86c0abcd1", custom: false }],
    ["https://app.clickup.com/t/9015123456/DEV-123", { id: "DEV-123", custom: true }],
    ["86c0abcd1", { id: "86c0abcd1", custom: false }],
    ["#86c0abcd1", { id: "86c0abcd1", custom: false }],
    ["CU-86c0abcd1", { id: "86c0abcd1", custom: false }],
    ["dev-42", { id: "DEV-42", custom: true }],
  ])("%s", (input, expected) => {
    expect(parseTaskRef(input)).toEqual(expected);
  });

  it("rejects junk", () => {
    expect(parseTaskRef("")).toBeNull();
    expect(parseTaskRef("not a task")).toBeNull();
  });
});

describe("description lines", () => {
  it("adds one line per task and keeps other lines", () => {
    const once = withClickupLine("- standup", task);
    expect(once).toBe("- standup\n- CU-86c0abcd1 Handle PC new parcel id format");
    expect(withClickupLine(once, task)).toBe(once);
    expect(clickupTasksIn(once)).toEqual([task]);
    expect(nonClickupLines(once)).toEqual(["standup"]);
  });

  it("detects entries holding only ClickUp lines", () => {
    expect(isClickupOnly({ description: withClickupLine("", task) })).toBe(true);
    expect(isClickupOnly({ description: withClickupLine("- standup", task) })).toBe(false);
    expect(isClickupOnly({ description: "" })).toBe(false);
  });

  it("removes a task's line", () => {
    const desc = withClickupLine("- standup", task);
    expect(withoutClickupLine(desc, task.id)).toBe("- standup");
    expect(withoutClickupLine(withClickupLine("", task), task.id)).toBe("");
  });
});

describe("sync accounting", () => {
  const day = new Date(2026, 9, 2, 9, 0).getTime();
  const connected = new Date(2026, 9, 2).getTime();
  const since = { qte: connected };
  const e = (id: string, start: number, minutes: number, teamId = "qte"): ClickUpTimeEntry => ({
    id,
    teamId,
    taskId: task.id,
    taskName: task.name,
    start,
    duration: minutes * 60000,
  });
  const entries = [
    e("old", connected - 3600_000, 10), // before connect day → counted as logged
    e("a", day, 30),
    e("b", day + 7200_000, 15),
    e("running", day + 9000_000, 0),
    e("other", day, 20, "unknown"), // workspace never connected → counted as logged
  ];

  it("splits accounted from unsynced time", () => {
    const sync = markSynced({ since, synced: {} }, [entries[1]]);
    expect(accountedMinutes(entries, sync, task.id, "2026-10-02")).toBe(50);
    const groups = unsyncedGroups(entries, sync);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ date: "2026-10-02", minutes: 15, task });
    expect(groups[0].entries.map((x) => x.id)).toEqual(["b"]);
  });

  it("marking synced moves time over", () => {
    const sync = markSynced({ since, synced: {} }, [entries[1], entries[2]]);
    expect(unsyncedGroups(entries, sync)).toEqual([]);
    expect(accountedMinutes(entries, sync, task.id, "2026-10-02")).toBe(65);
  });
});

describe("accounts", () => {
  const qte = { token: "pk_qte", email: "me@qte.se", teams: [{ id: "1", name: "QTE" }] };
  const dhl = { token: "pk_dhl", email: "me@dhl.com", teams: [{ id: "2", name: "DHL" }] };

  it("adding an account starts its workspaces syncing today, keeping existing ones", () => {
    const first = upsertAccount(null, qte);
    const old = { ...first, sync: { ...first.sync, since: { "1": 5 } } };
    const both = upsertAccount(old, dhl);
    expect(both.config.accounts.map((a) => a.email)).toEqual(["me@qte.se", "me@dhl.com"]);
    expect(both.sync.since["1"]).toBe(5);
    expect(both.sync.since["2"]).toBe(startOfToday());
    // Re-adding the same token refreshes it in place.
    const renamed = upsertAccount(both, { ...qte, teams: [{ id: "1", name: "QTE AB" }] });
    expect(renamed.config.accounts).toHaveLength(2);
    expect(renamed.config.accounts[0].teams[0].name).toBe("QTE AB");
  });

  it("migrates the single-workspace config", () => {
    const old = {
      config: { token: "pk_qte", teamId: "1", teamName: "QTE" },
      sync: { since: 5, synced: { x: 6 } },
    } as unknown as ClickUpStored;
    expect(migrateStored(old)).toEqual({
      config: { accounts: [{ token: "pk_qte", email: "", teams: [{ id: "1", name: "QTE" }] }] },
      sync: { since: { "1": 5 }, synced: { x: 6 } },
    });
  });
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const accounts = [
  { token: "pk_qte", teams: [{ id: "1", name: "QTE" }] },
  { token: "pk_dhl", teams: [{ id: "2", name: "DHL" }] },
];
const authOf = (init: RequestInit) => (init.headers as Record<string, string>).Authorization;

describe("ClickUp client", () => {
  it("creates a time entry with the token of the workspace's account", async () => {
    const fetchMock = vi.fn(async () => ok({ data: { id: "123" } }));
    const client = createClickUpClient(accounts, fetchMock as typeof fetch);
    const created = await client.createTimeEntry("2", task.id, 1000, 60000);
    expect(created).toMatchObject({ id: "123", teamId: "2" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.clickup.com/api/v2/team/2/time_entries");
    expect(init.method).toBe("POST");
    expect(authOf(init)).toBe("pk_dhl");
    expect(JSON.parse(init.body as string)).toEqual({ tid: task.id, start: 1000, duration: 60000 });
  });

  it("finds a task in whichever account can see it", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      authOf(init) === "pk_dhl"
        ? ok({ id: task.id, name: task.name, team_id: 2 })
        : new Response("not found", { status: 404 })
    );
    const client = createClickUpClient(accounts, fetchMock as unknown as typeof fetch);
    expect(await client.getTask({ id: task.id, custom: false })).toEqual({ ...task, teamId: "2" });
    await expect(
      createClickUpClient(accounts.slice(0, 1), fetchMock as unknown as typeof fetch).getTask({
        id: task.id,
        custom: false,
      })
    ).rejects.toThrow("not found");
  });

  it("maps time entries and drops ones without a task", async () => {
    const body = {
      data: [
        { id: "1", task: { id: "t1", name: "One" }, start: "1000", duration: "60000" },
        { id: "2", task: null, start: "2000", duration: "60000" },
      ],
    };
    const fetchMock = vi.fn(async () => ok(body));
    const client = createClickUpClient(accounts, fetchMock as typeof fetch);
    expect(await client.getTimeEntries("1", 0, 5000)).toEqual([
      { id: "1", teamId: "1", taskId: "t1", taskName: "One", start: 1000, duration: 60000 },
    ]);
  });

  it("throws on API errors and unknown workspaces", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = createClickUpClient(accounts, fetchMock as typeof fetch);
    await expect(client.getRunning("1")).rejects.toThrow("ClickUp 401");
    await expect(client.getRunning("999")).rejects.toThrow("No connected ClickUp account");
  });
});
