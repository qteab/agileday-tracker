import { describe, it, expect, vi } from "vitest";
import {
  accountedMinutes,
  clickupTasksIn,
  createClickUpClient,
  markSynced,
  nonClickupLines,
  parseTaskRef,
  unsyncedGroups,
  withClickupLine,
  withoutClickupLine,
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

  it("removes a task's line", () => {
    const desc = withClickupLine("- standup", task);
    expect(withoutClickupLine(desc, task.id)).toBe("- standup");
    expect(withoutClickupLine(withClickupLine("", task), task.id)).toBe("");
  });
});

describe("sync accounting", () => {
  const day = new Date(2026, 9, 2, 9, 0).getTime();
  const since = new Date(2026, 9, 2).getTime();
  const e = (id: string, start: number, minutes: number): ClickUpTimeEntry => ({
    id,
    taskId: task.id,
    taskName: task.name,
    start,
    duration: minutes * 60000,
  });
  const entries = [
    e("old", since - 3600_000, 10), // before connect day → counted as logged
    e("a", day, 30),
    e("b", day + 7200_000, 15),
    e("running", day + 9000_000, 0),
  ];

  it("splits accounted from unsynced time", () => {
    const sync = markSynced({ since, synced: {} }, [entries[1]]);
    expect(accountedMinutes(entries, sync, task.id, "2026-10-02")).toBe(30);
    const groups = unsyncedGroups(entries, sync);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ date: "2026-10-02", minutes: 15, task });
    expect(groups[0].entries.map((x) => x.id)).toEqual(["b"]);
  });

  it("marking synced moves time over", () => {
    const sync = markSynced({ since, synced: {} }, [entries[1], entries[2]]);
    expect(unsyncedGroups(entries, sync)).toEqual([]);
    expect(accountedMinutes(entries, sync, task.id, "2026-10-02")).toBe(45);
  });
});

describe("ClickUp client", () => {
  it("creates a time entry with start + duration on the task", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { id: "123" } }), { status: 200 })
    );
    const client = createClickUpClient("pk_test", "9015", fetchMock as typeof fetch);
    const created = await client.createTimeEntry(task.id, 1000, 60000);
    expect(created.id).toBe("123");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.clickup.com/api/v2/team/9015/time_entries");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("pk_test");
    expect(JSON.parse(init.body as string)).toEqual({ tid: task.id, start: 1000, duration: 60000 });
  });

  it("maps time entries and drops ones without a task", async () => {
    const body = {
      data: [
        { id: "1", task: { id: "t1", name: "One" }, start: "1000", duration: "60000" },
        { id: "2", task: null, start: "2000", duration: "60000" },
      ],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const client = createClickUpClient("pk_test", "9015", fetchMock as typeof fetch);
    expect(await client.getTimeEntries(0, 5000)).toEqual([
      { id: "1", taskId: "t1", taskName: "One", start: 1000, duration: 60000 },
    ]);
  });

  it("throws on API errors", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = createClickUpClient("pk_bad", "9015", fetchMock as typeof fetch);
    await expect(client.getRunning()).rejects.toThrow("ClickUp 401");
  });
});
