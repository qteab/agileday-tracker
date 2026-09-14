import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { createMcpProvider, weeksInRange } from "../mcp-provider";
import { createMcpClient } from "../mcp-client";
import { isAuthError } from "../token-claims";
import type { ApiProvider } from "../provider";
import type { AuthState } from "../auth";

const mockFetch = vi.fn() as Mock;
vi.stubGlobal("fetch", mockFetch);
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) => mockFetch(...args),
}));

const CONFIG = {
  apiBaseUrl: "https://qvik.agileday.io/api",
  authConfig: {
    oauthBaseUrl: "https://qvik.agileday.io/api/v1/oauth",
    clientId: "test-client-id",
    redirectUri: "http://localhost:19847/auth/callback",
  },
};

const MCP_URL = "https://qvik.agileday.io/api/v1/mcp";
const EMP = "emp-1";

function fakeJwt(claims: Record<string, unknown> = {}): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      sub: EMP,
      employee_id: EMP,
      email: "axel@qte.se",
      name: "Axel Jonsson",
      aud: MCP_URL,
      scope: "mcp:read mcp:write",
      ...claims,
    })
  );
  return `${header}.${payload}.fake-signature`;
}

const VALID_AUTH: AuthState = {
  accessToken: fakeJwt(),
  refreshToken: "test-refresh-token",
  expiresAt: Date.now() + 3600_000,
};

/** A JSON-RPC success carrying an MCP tool result envelope. */
function toolResult(payload: unknown, init: { sessionId?: string } = {}): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...(init.sessionId ? { "mcp-session-id": init.sessionId } : {}),
      },
    }
  );
}

/** The initialize reply, which also assigns the session. */
function initResult(sessionId = "sess-1"): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "mcp-session-id": sessionId },
    }
  );
}

/** The 202 with no body that answers `notifications/initialized`. */
function notificationAck(): Response {
  return new Response("", { status: 202 });
}

/** Queue the two-response handshake, then the given tool replies in order. */
function expectHandshakeThen(...responses: Response[]) {
  mockFetch.mockResolvedValueOnce(initResult());
  mockFetch.mockResolvedValueOnce(notificationAck());
  for (const response of responses) mockFetch.mockResolvedValueOnce(response);
}

/** The JSON-RPC body of the nth fetch call. */
function bodyOf(callIndex: number): { method: string; params?: Record<string, unknown> } {
  return JSON.parse(mockFetch.mock.calls[callIndex][1].body);
}

let provider: ApiProvider;
let authState: AuthState | null;

beforeEach(() => {
  mockFetch.mockReset();
  authState = { ...VALID_AUTH };
  provider = createMcpProvider(
    CONFIG,
    () => authState,
    (next) => {
      authState = next;
    },
    () => {
      authState = null;
    },
    undefined,
    () => new Date("2026-09-14T09:00:00Z")
  );
});

describe("weeksInRange", () => {
  it("returns the Monday of each week the range touches", () => {
    // 2026-09-14 is a Monday; the range ends mid-week.
    expect(weeksInRange("2026-09-14", "2026-09-16")).toEqual(["2026-09-14"]);
    expect(weeksInRange("2026-09-14", "2026-09-23")).toEqual(["2026-09-14", "2026-09-21"]);
  });

  it("snaps a mid-week start back to its Monday", () => {
    expect(weeksInRange("2026-09-16", "2026-09-16")).toEqual(["2026-09-14"]);
  });

  it("returns [] for an inverted range", () => {
    expect(weeksInRange("2026-09-20", "2026-09-01")).toEqual([]);
  });
});

describe("MCP transport", () => {
  it("handshakes once and reuses the session for later calls", async () => {
    expectHandshakeThen(
      toolResult({ employee_id: EMP, basic: { name: "Axel", email: "a@qte.se" } }),
      toolResult({ employee_id: EMP, basic: { name: "Axel", email: "a@qte.se" } })
    );

    await provider.getCurrentEmployee();
    await provider.getCurrentEmployee();

    expect(bodyOf(0).method).toBe("initialize");
    expect(bodyOf(1).method).toBe("notifications/initialized");
    expect(bodyOf(2).method).toBe("tools/call");
    expect(bodyOf(3).method).toBe("tools/call");
    // Four calls total: the second employee read must not re-handshake.
    expect(mockFetch).toHaveBeenCalledTimes(4);

    const headers = mockFetch.mock.calls[3][1].headers;
    expect(headers["Mcp-Session-Id"]).toBe("sess-1");
    expect(headers.Authorization).toMatch(/^Bearer eyJ/);
  });

  it("parses a tool result delivered as an event stream", async () => {
    mockFetch.mockResolvedValueOnce(initResult());
    mockFetch.mockResolvedValueOnce(notificationAck());
    mockFetch.mockResolvedValueOnce(
      new Response(
        `: keep-alive\n\nevent: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: JSON.stringify({ employee_id: "emp-9" }) }] },
        })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    );

    const employee = await provider.getCurrentEmployee();

    expect(employee.id).toBe("emp-9");
  });

  it("surfaces a JSON-RPC unauthorized code as a typed auth error", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32001, message: "Unauthorized: Bearer token required" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const err = await provider.getCurrentEmployee().catch((e) => e);

    expect(isAuthError(err)).toBe(true);
    expect(err.kind).toBe("unauthorized");
  });

  it("classifies a token minted for another audience", async () => {
    authState = { ...VALID_AUTH, accessToken: fakeJwt({ aud: "https://elsewhere.example/api" }) };
    mockFetch.mockResolvedValueOnce(new Response("nope", { status: 401 }));

    const err = await provider.getCurrentEmployee().catch((e) => e);

    expect(err.kind).toBe("wrong-audience");
    expect(err.message).toContain("https://elsewhere.example/api");
  });

  it("re-handshakes once when the server drops the session", async () => {
    expectHandshakeThen(new Response("gone", { status: 404 }));
    // The retry path: a fresh handshake, then the real answer.
    mockFetch.mockResolvedValueOnce(initResult("sess-2"));
    mockFetch.mockResolvedValueOnce(notificationAck());
    mockFetch.mockResolvedValueOnce(toolResult({ employee_id: "emp-2" }));

    const employee = await provider.getCurrentEmployee();

    expect(employee.id).toBe("emp-2");
  });

  it("reports a tool-level error instead of returning empty data", async () => {
    mockFetch.mockResolvedValueOnce(initResult());
    mockFetch.mockResolvedValueOnce(notificationAck());
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { isError: true, content: [{ type: "text", text: "week is locked" }] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(provider.getCurrentEmployee()).rejects.toThrow(/week is locked/);
  });

  it("refuses a non-HTTPS base url", () => {
    expect(() =>
      createMcpClient(
        { apiBaseUrl: "http://qvik.agileday.io/api" },
        async () => "token",
        () => authState
      )
    ).toThrow(/HTTPS/);
  });
});

describe("getTimeEntries", () => {
  const CARD = {
    week: "2026-09-14",
    status: "SAVED",
    rows: [
      {
        id: "row-1",
        project_id: "proj-1",
        task_id: "task-1",
        opening_id: "open-1",
        hours: [
          { id: "hour-1", date: "2026-09-14T00:00:00Z", minutes: 60, description: "Review" },
          { id: "hour-2", date: "2026-09-16T00:00:00Z", minutes: 120, description: "Build" },
        ],
      },
      // A contracted row with nothing logged yet must not become an entry.
      { id: "row-2", project_id: "proj-2", task_id: "task-2", hours: [] },
    ],
  };

  it("maps timecard rows into flat entries", async () => {
    expectHandshakeThen(toolResult(CARD));

    const entries = await provider.getTimeEntries(EMP, "2026-09-14", "2026-09-18");

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      id: "hour-1",
      description: "Review",
      projectId: "proj-1",
      openingId: "open-1",
      taskId: "task-1",
      date: "2026-09-14",
      startTime: "",
      minutes: 60,
      status: "SAVED",
      syncStatus: "synced",
    });
  });

  it("trims entries outside the requested window", async () => {
    expectHandshakeThen(toolResult(CARD));

    // The week starts 09-14 but the caller only asked from 09-15.
    const entries = await provider.getTimeEntries(EMP, "2026-09-15", "2026-09-18");

    expect(entries.map((entry) => entry.id)).toEqual(["hour-2"]);
  });

  it("requests one timecard per week the window spans", async () => {
    expectHandshakeThen(toolResult({ ...CARD, rows: [] }), toolResult({ week: "2026-09-21" }));

    await provider.getTimeEntries(EMP, "2026-09-14", "2026-09-22");

    const weeks = [bodyOf(2), bodyOf(3)].map(
      (body) => (body.params as { arguments: { week: string } }).arguments.week
    );
    expect(weeks).toEqual(["2026-09-14", "2026-09-21"]);
  });

  it("retries a week that fails once", async () => {
    expectHandshakeThen(
      toolResult(CARD),
      new Response("boom", { status: 500 }),
      toolResult({ week: "2026-09-21" })
    );

    const entries = await provider.getTimeEntries(EMP, "2026-09-14", "2026-09-22");

    expect(entries).toHaveLength(2);
  });

  it("fails the whole read when a week fails twice", async () => {
    expectHandshakeThen(
      toolResult(CARD),
      new Response("boom", { status: 500 }),
      new Response("boom", { status: 500 })
    );

    // Silently dropping a week understates the flex balance — a visibly failed
    // read is better than a quietly wrong number.
    await expect(provider.getTimeEntries(EMP, "2026-09-14", "2026-09-22")).rejects.toThrow(/500/);
  });

  it("fetches each week once even when several callers want it", async () => {
    expectHandshakeThen(toolResult(CARD));

    const [first, second] = await Promise.all([
      provider.getTimeEntries(EMP, "2026-09-14", "2026-09-18"),
      provider.getTimeEntries(EMP, "2026-09-14", "2026-09-18"),
    ]);

    // Handshake (2) plus a single show_timecard — the second read is served
    // from the in-flight promise rather than opening another request.
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(first).toEqual(second);
  });
});

describe("writes", () => {
  it("sends an add operation carrying every field, so the server never elicits", async () => {
    expectHandshakeThen(toolResult({ week: "2026-09-14", rows: [] }));

    await provider.createTimeEntry(EMP, {
      description: "Review",
      projectId: "proj-1",
      taskId: "task-1",
      openingId: "open-1",
      date: "2026-09-14",
      startTime: "",
      minutes: 90,
      status: "NEW",
    });

    const args = (bodyOf(2).params as { arguments: Record<string, unknown> }).arguments;
    expect(args.week).toBe("2026-09-14");
    expect(args.operations).toEqual([
      {
        action: "add",
        date: "2026-09-14",
        minutes: 90,
        project_id: "proj-1",
        task_id: "task-1",
        opening_id: "open-1",
        description: "Review",
      },
    ]);
  });

  it("returns the server-assigned id after a create", async () => {
    expectHandshakeThen(
      toolResult({
        week: "2026-09-14",
        status: "SAVED",
        rows: [
          {
            id: "row-1",
            project_id: "proj-1",
            hours: [
              { id: "hour-new", date: "2026-09-14T00:00:00Z", minutes: 90, description: "Review" },
            ],
          },
        ],
      })
    );

    const created = await provider.createTimeEntry(EMP, {
      description: "Review",
      projectId: "proj-1",
      taskId: "task-1",
      date: "2026-09-14",
      startTime: "",
      minutes: 90,
      status: "NEW",
    });

    expect(created.id).toBe("hour-new");
    expect(created.syncStatus).toBe("synced");
  });

  it("marks a create unsaved when the server doesn't echo the row back", async () => {
    expectHandshakeThen(toolResult({ week: "2026-09-14", rows: [] }));

    const created = await provider.createTimeEntry(EMP, {
      description: "Review",
      projectId: "proj-1",
      date: "2026-09-14",
      startTime: "",
      minutes: 90,
      status: "NEW",
    });

    // Reporting "synced" on an unconfirmed write would lose the entry silently.
    expect(created.syncStatus).toBe("unsaved");
  });

  it("splits a multi-week batch so the server never has to pick a week", async () => {
    expectHandshakeThen(
      toolResult({ week: "2026-09-14", rows: [] }),
      toolResult({ week: "2026-09-21", rows: [] })
    );

    await provider.batchUpdateEntries(EMP, [
      { id: "hour-1", date: "2026-09-15", minutes: 30 },
      { id: "hour-2", date: "2026-09-22", minutes: 45 },
    ]);

    // Two weeks, two calls, each pinned. An update op carries only hour_id, so
    // without the explicit week the server would fall back to asking the host
    // which week was meant — a prompt this client can never answer.
    expect(mockFetch).toHaveBeenCalledTimes(4);
    const first = (bodyOf(2).params as { arguments: Record<string, unknown> }).arguments;
    const second = (bodyOf(3).params as { arguments: Record<string, unknown> }).arguments;
    expect(first.week).toBe("2026-09-14");
    expect(first.operations).toEqual([{ action: "update", hour_id: "hour-1", minutes: 30 }]);
    expect(second.week).toBe("2026-09-21");
    expect(second.operations).toEqual([{ action: "update", hour_id: "hour-2", minutes: 45 }]);
  });

  it("pins the week on a single update when the date is known", async () => {
    expectHandshakeThen(toolResult({ week: "2026-09-14", rows: [] }));

    await provider.updateTimeEntry(EMP, "hour-1", { date: "2026-09-16", minutes: 15 });

    const args = (bodyOf(2).params as { arguments: Record<string, unknown> }).arguments;
    expect(args.week).toBe("2026-09-14");
    // The date routes the call but must not leak into the operation itself.
    expect(args.operations).toEqual([{ action: "update", hour_id: "hour-1", minutes: 15 }]);
  });

  it("sends one delete operation per id", async () => {
    expectHandshakeThen(toolResult({ employee_id: EMP }), toolResult({ week: "", rows: [] }));

    await provider.deleteTimeEntry(["hour-1", "hour-2"]);

    const args = (bodyOf(3).params as { arguments: Record<string, unknown> }).arguments;
    expect(args.operations).toEqual([
      { action: "delete", hour_id: "hour-1" },
      { action: "delete", hour_id: "hour-2" },
    ]);
  });

  it("makes no call at all for an empty delete", async () => {
    await provider.deleteTimeEntry([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("projects and allocations", () => {
  it("reads projects out of the result envelope", async () => {
    // The tool answers `{projects, total_count, limit, offset}`. Treating that
    // as a bare array yields zero projects and every entry renders as
    // "Unknown project".
    expectHandshakeThen(
      toolResult({
        projects: [
          { projectId: "p1", name: "DHL Retainer", customerName: "DHL", projectType: "EXTERNAL" },
        ],
        total_count: 1,
        limit: 100,
        offset: 0,
      })
    );

    const projects = await provider.getProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: "p1",
      name: "DHL Retainer",
      customerName: "DHL",
      projectType: "EXTERNAL",
    });
    expect(projects[0].color).toBeTruthy();
  });

  it("pages until total_count is covered", async () => {
    const page = (n: number, offset: number) => ({
      projects: Array.from({ length: n }, (_, i) => ({
        projectId: `p${offset + i}`,
        name: `Project ${offset + i}`,
      })),
      total_count: 103,
    });
    expectHandshakeThen(toolResult(page(100, 0)), toolResult(page(3, 100)));

    const projects = await provider.getProjects();

    expect(projects).toHaveLength(103);
    const second = (bodyOf(3).params as { arguments: { offset: number } }).arguments;
    expect(second.offset).toBe(100);
  });

  it("derives allocations from the current week's suggested hours", async () => {
    expectHandshakeThen(
      toolResult({
        week: "2026-09-14",
        suggested_hours: [
          {
            project_id: "proj-1",
            project_name: "DHL Retainer",
            opening_id: "open-1",
            allocation_percent: 19.3,
            hours: 7.7,
          },
        ],
      })
    );

    const allocations = await provider.getAllocations(EMP);

    expect(allocations).toEqual([
      {
        projectId: "proj-1",
        projectName: "DHL Retainer",
        startDate: null,
        endDate: null,
        percentage: 19.3,
        hours: 7.7,
        allocationMode: "allocation",
        periods: [],
      },
    ]);
  });

  it("includes worked-but-unsuggested projects in getMyProjects", async () => {
    expectHandshakeThen(
      toolResult({
        week: "2026-09-14",
        suggested_hours: [{ project_id: "proj-1", project_name: "DHL", opening_id: "open-1" }],
        rows: [{ id: "row-9", project_id: "proj-9", opening_id: "open-9", hours: [] }],
      })
    );

    const mine = await provider.getMyProjects(EMP);

    expect(mine.map((project) => project.id).sort()).toEqual(["proj-1", "proj-9"]);
  });

  it("returns no absence projects, leaving them to the allocation fallback", async () => {
    expect(await provider.getAbsenceProjects()).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("tasks", () => {
  const TASK_CARD = {
    week: "2026-09-14",
    rows: [
      { id: "row-1", project_id: "proj-1", task_id: "task-aaa11111", hours: [] },
      { id: "row-2", project_id: "proj-1", task_id: "task-bbb22222", hours: [] },
      { id: "row-3", project_id: "proj-2", task_id: "task-ccc33333", hours: [] },
    ],
  };

  /** Handshake, then the employee lookup the index needs, then timecards. */
  function expectTaskIndexFetch(card: unknown) {
    mockFetch.mockResolvedValueOnce(initResult());
    mockFetch.mockResolvedValueOnce(notificationAck());
    mockFetch.mockResolvedValueOnce(toolResult({ employee_id: EMP }));
    mockFetch.mockResolvedValue(toolResult(card));
  }

  it("recovers task ids for a project from timecard history", async () => {
    expectTaskIndexFetch(TASK_CARD);

    const tasks = await provider.getTasks("proj-1");

    expect(tasks.map((task) => task.id).sort()).toEqual(["task-aaa11111", "task-bbb22222"]);
    // Names don't exist anywhere in the MCP surface, so the id stands in.
    expect(tasks[0].name).toContain(tasks[0].id.slice(0, 8));
  });

  it("returns [] for a project with no logged history", async () => {
    expectTaskIndexFetch({ week: "2026-09-14", rows: [] });

    expect(await provider.getTasks("proj-unknown")).toEqual([]);
  });

  it("reuses already-fetched weeks instead of sweeping again", async () => {
    expectHandshakeThen(toolResult(TASK_CARD));

    await provider.getTimeEntries(EMP, "2026-09-14", "2026-09-18");
    const afterRead = mockFetch.mock.calls.length;
    const tasks = await provider.getTasks("proj-1");

    // The entry read already pulled this week, so the index costs nothing —
    // the old code fired a separate 26-week sweep here.
    expect(mockFetch.mock.calls.length).toBe(afterRead);
    expect(tasks).toHaveLength(2);
  });
});

describe("holidays", () => {
  it("serves them locally without touching the network", async () => {
    const holidays = await provider.getHolidays("SE", "2026-12-24", "2026-12-26");

    expect(holidays.map((holiday) => holiday.date)).toEqual(["2026-12-25", "2026-12-26"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
