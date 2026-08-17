/**
 * Entry Sync Behavior Tests
 *
 * Tests the complete user journey for creating, updating, and deleting
 * time entries between the app (local state) and AgileDay (remote API).
 *
 * See specs/agileday-tracker/entry-sync.md for the full specification.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { createAgileDayProvider, type AgileDayConfig } from "../agileday";
import type { ApiProvider } from "../provider";
import type { AuthState } from "../auth";

const mockFetch = vi.fn() as Mock;
vi.stubGlobal("fetch", mockFetch);
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) => mockFetch(...args),
}));

function fakeJwt(claims: Record<string, unknown> = {}): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      sub: "emp-1",
      employee_id: "emp-1",
      email: "axel@qte.se",
      name: "Axel Jonsson",
      tid: "qvik",
      ...claims,
    })
  );
  return `${header}.${payload}.fake-signature`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type RawEntryLike = Record<string, unknown>;

interface FetchRoutes {
  /** GET /v1/time_entry/employee/id/{id}?startDate=&endDate= — primary read */
  dateRange?: RawEntryLike[];
  /** HTTP status for the primary read, to exercise the fallback */
  dateRangeStatus?: number;
  /** GET /v1/time_entry/employee/id/{id}/updated — fallback read */
  updated?: RawEntryLike[];
  /** GET /v1/timesheets/{id}/summary, keyed by the `month` query param */
  summaryByMonth?: Record<string, RawEntryLike[]>;
  /** Response body for any non-GET call (POST/PATCH/DELETE) */
  write?: RawEntryLike[];
}

/**
 * Route mocked fetch by URL instead of call order, so a test can assert which
 * endpoints were hit without depending on how many calls precede them.
 */
function routeFetch(routes: FetchRoutes) {
  mockFetch.mockImplementation((rawUrl: string, init?: RequestInit) => {
    const url = new URL(String(rawUrl));
    const path = url.pathname;

    if ((init?.method ?? "GET") !== "GET") {
      return Promise.resolve(jsonResponse(routes.write ?? []));
    }
    if (path.endsWith("/updated")) {
      return Promise.resolve(jsonResponse(routes.updated ?? []));
    }
    if (path.includes("/v1/timesheets/")) {
      const month = url.searchParams.get("month") ?? "";
      return Promise.resolve(jsonResponse({ entries: routes.summaryByMonth?.[month] ?? [] }));
    }
    if (path.includes("/v1/time_entry/employee/id/")) {
      const status = routes.dateRangeStatus ?? 200;
      if (status >= 400) {
        return Promise.resolve(jsonResponse({ message: "boom" }, status));
      }
      return Promise.resolve(jsonResponse(routes.dateRange ?? []));
    }
    return Promise.resolve(jsonResponse([]));
  });
}

/** Every URL the mocked fetch was called with. */
function fetchedUrls(): string[] {
  return mockFetch.mock.calls.map((call) => String(call[0]));
}

/** Non-GET calls the mocked fetch received, as {method, body}. */
function writeCalls(): { method: string; body: RawEntryLike[] }[] {
  return mockFetch.mock.calls
    .filter((call) => (call[1]?.method ?? "GET") !== "GET")
    .map((call) => ({
      method: String(call[1].method),
      body: call[1].body ? JSON.parse(String(call[1].body)) : [],
    }));
}

const TEST_CONFIG: AgileDayConfig = {
  apiBaseUrl: "https://qvik.agileday.io/api",
  authConfig: {
    oauthBaseUrl: "https://qvik.agileday.io/api/v1/oauth",
    clientId: "test-client-id",
    redirectUri: "http://localhost:19847/auth/callback",
  },
};

const VALID_AUTH: AuthState = {
  accessToken: fakeJwt(),
  refreshToken: "test-refresh-token",
  expiresAt: Date.now() + 3600_000,
};

let provider: ApiProvider;
let authState: AuthState | null;

beforeEach(() => {
  mockFetch.mockReset();
  authState = { ...VALID_AUTH };
  provider = createAgileDayProvider(
    TEST_CONFIG,
    () => authState,
    vi.fn(),
    vi.fn(),
    mockFetch as typeof globalThis.fetch
  );
});

// =============================================================================
// CREATE: Timer Stop
// =============================================================================

describe("Create (Timer Stop)", () => {
  it("creates a new entry when no existing match in AgileDay", async () => {
    // same-day lookup returns no matches
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    // POST creates entry
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "agile-1",
          date: "2026-04-28",
          minutes: 5,
          status: "SAVED",
          description: "code review",
          projectId: "p1",
        },
      ])
    );

    const entry = await provider.createTimeEntry("emp-1", {
      description: "code review",
      projectId: "p1",
      date: "2026-04-28",
      startTime: "2026-04-28T09:00:00Z",
      minutes: 5,
      status: "SAVED",
    });

    // First call: existence lookup for that day (by work date, not update time)
    expect(mockFetch.mock.calls[0][0]).toContain("startDate=2026-04-28&endDate=2026-04-29");
    // Second call: POST
    expect(mockFetch.mock.calls[1][1].method).toBe("POST");
    expect(entry.id).toBe("agile-1");
    expect(entry.minutes).toBe(5);
  });

  it("PATCHes existing entry with app's full state (overwrite)", async () => {
    // /updated returns one existing entry
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "agile-existing",
          date: "2026-04-28",
          minutes: 10,
          status: "SAVED",
          description: "old desc",
          projectId: "p1",
        },
      ])
    );
    // PATCH response
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "agile-existing",
          date: "2026-04-28",
          minutes: 15,
          status: "SAVED",
          description: "- code review",
          projectId: "p1",
        },
      ])
    );

    const entry = await provider.createTimeEntry("emp-1", {
      description: "- code review",
      projectId: "p1",
      date: "2026-04-28",
      startTime: "2026-04-28T09:30:00Z",
      minutes: 15,
      status: "SAVED",
    });

    expect(mockFetch.mock.calls[1][1].method).toBe("PATCH");
    const patchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    // App sends full state — minutes and description overwrite, not merge
    expect(patchBody[0].minutes).toBe(15);
    expect(patchBody[0].description).toBe("- code review");
    expect(entry.id).toBe("agile-existing");
  });

  it("only matches entries with same project+task+date+SAVED status", async () => {
    // /updated returns entries: only one matches project+task+date+SAVED
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "submitted-1",
          date: "2026-04-28",
          minutes: 10,
          status: "SUBMITTED",
          description: "review",
          projectId: "p1",
        },
        {
          id: "different-project",
          date: "2026-04-28",
          minutes: 5,
          status: "SAVED",
          description: "review",
          projectId: "p2",
        },
        {
          id: "different-task",
          date: "2026-04-28",
          minutes: 5,
          status: "SAVED",
          description: "other work",
          projectId: "p1",
          taskId: "t2",
        },
      ])
    );
    // No matches (SUBMITTED, different project, different task) → POST new
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "new-1",
          date: "2026-04-28",
          minutes: 5,
          status: "SAVED",
          description: "review",
          projectId: "p1",
          taskId: "t1",
        },
      ])
    );

    await provider.createTimeEntry("emp-1", {
      description: "review",
      projectId: "p1",
      taskId: "t1",
      date: "2026-04-28",
      startTime: "2026-04-28T09:00:00Z",
      minutes: 5,
      status: "SAVED",
    });

    // Should POST (no SAVED match for same project+task+date)
    expect(mockFetch.mock.calls[1][1].method).toBe("POST");
  });

  it("PATCHes an existing entry last updated before its own work date", async () => {
    // The existence lookup used /updated?updatedAfter={entry.date}, which
    // cannot see an entry left untouched since before that date — so the app
    // POSTed a duplicate instead of updating it.
    const existing = {
      id: "stale-1",
      date: "2026-08-05",
      minutes: 60,
      status: "SAVED",
      description: "planning",
      projectId: "p1",
      taskId: "t1",
    };
    routeFetch({ dateRange: [existing], write: [{ ...existing, minutes: 90 }] });

    const result = await provider.createTimeEntry("emp-1", {
      description: "planning",
      projectId: "p1",
      taskId: "t1",
      date: "2026-08-05",
      startTime: "2026-08-05T09:00:00Z",
      minutes: 90,
      status: "SAVED",
    });

    const writes = writeCalls();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("PATCH");
    expect(writes[0].body[0].id).toBe("stale-1");
    expect(result.minutes).toBe(90);

    // Lookup is a single-day range: startDate inclusive, endDate exclusive.
    const lookup = fetchedUrls().find((url) => url.includes("/v1/time_entry/employee/id/emp-1?"));
    expect(lookup).toBeDefined();
    const params = new URL(lookup as string).searchParams;
    expect(params.get("startDate")).toBe("2026-08-05");
    expect(params.get("endDate")).toBe("2026-08-06");
  });
});

// =============================================================================
// DELETE: Session from Group
// =============================================================================

describe("Delete (deleteTimeEntry)", () => {
  it("deletes entry from AgileDay by ID", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: "agile-1" }]));

    await provider.deleteTimeEntry(["agile-1"]);

    expect(mockFetch.mock.calls[0][0]).toContain("ids=agile-1");
    expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
  });

  it("skips API call for empty ID list", async () => {
    await provider.deleteTimeEntry([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// UPDATE: Edit entry
// =============================================================================

describe("Update (updateTimeEntry)", () => {
  it("PATCHes with only changed fields", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "agile-1",
          date: "2026-04-28",
          minutes: 30,
          status: "SAVED",
          description: "updated",
          projectId: "p1",
        },
      ])
    );

    await provider.updateTimeEntry("emp-1", "agile-1", {
      description: "updated",
      minutes: 30,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body[0].id).toBe("agile-1");
    expect(body[0].description).toBe("updated");
    expect(body[0].minutes).toBe(30);
    expect(body[0]).not.toHaveProperty("projectId");
  });

  it("sends total minutes on update", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "agile-1",
          date: "2026-04-28",
          minutes: 12,
          status: "SAVED",
          description: "work",
          projectId: "p1",
        },
      ])
    );

    const result = await provider.updateTimeEntry("emp-1", "agile-1", {
      minutes: 12, // group total: edited 5 + other 7
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body[0].minutes).toBe(12);
    expect(result.minutes).toBe(12);
  });

  it("updates description on entry", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "agile-1",
          date: "2026-04-28",
          minutes: 75,
          status: "SAVED",
          description: "- planning\n- new desc",
          projectId: "p1",
        },
      ])
    );

    const result = await provider.updateTimeEntry("emp-1", "agile-1", {
      description: "- planning\n- new desc", // old "code review" swapped for "new desc"
      minutes: 75,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body[0].description).toBe("- planning\n- new desc");
    expect(result.description).toBe("- planning\n- new desc");
  });
});

// =============================================================================
// READ: Loading entries
// =============================================================================

describe("Read (getTimeEntries)", () => {
  it("merges /updated and /timesheets/summary data", async () => {
    // /updated returns detailed entry
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "e1",
          date: "2026-04-28",
          minutes: 60,
          status: "SAVED",
          description: "work",
          projectId: "p1",
          projectName: "Fokus",
        },
      ])
    );
    // timesheets/summary returns same + extra entry without description
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        entries: [
          {
            date: "2026-04-28",
            minutes: 60,
            project: "Fokus",
            projectId: "p1",
            status: "SAVED",
            customer: "FPG",
          },
          {
            date: "2026-04-28",
            minutes: 30,
            project: "KBV",
            projectId: "p2",
            status: "SAVED",
            customer: "KBV",
          },
        ],
      })
    );

    const entries = await provider.getTimeEntries("emp-1", "2026-04-28", "2026-04-28");

    // e1 from /updated (has description)
    const e1 = entries.find((e) => e.id === "e1");
    expect(e1?.description).toBe("work");
    expect(e1?.minutes).toBe(60);

    // p2 entry from summary (no description, minutes not covered by /updated)
    const summary = entries.find((e) => e.projectId === "p2");
    expect(summary).toBeDefined();
    expect(summary?.minutes).toBe(30);
  });

  it("does not duplicate entries that appear in both sources", async () => {
    // /updated returns 60 min for p1
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "e1",
          date: "2026-04-28",
          minutes: 60,
          status: "SAVED",
          description: "work",
          projectId: "p1",
          projectName: "Fokus",
        },
      ])
    );
    // summary also shows 60 min for p1 (same data)
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        entries: [
          {
            date: "2026-04-28",
            minutes: 60,
            project: "Fokus",
            projectId: "p1",
            status: "SAVED",
            customer: "FPG",
          },
        ],
      })
    );

    const entries = await provider.getTimeEntries("emp-1", "2026-04-28", "2026-04-28");

    // Should have exactly 1 entry, not 2
    expect(entries).toHaveLength(1);
    expect(entries[0].minutes).toBe(60);
  });

  it("fetches a summary for every month the window touches", async () => {
    // A ±30-day window spans three calendar months. Fetching only the first and
    // last silently skipped the middle one — for a window centred on Aug 13
    // that meant August itself was never requested.
    routeFetch({});

    await provider.getTimeEntries("emp-1", "2026-07-14", "2026-09-12");

    const summaryMonths = fetchedUrls()
      .filter((url) => url.includes("/v1/timesheets/emp-1/summary"))
      .map((url) => new URL(url).searchParams.get("month"));

    expect(summaryMonths).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });

  it("returns entries in the window even when they were last updated before it", async () => {
    // Vacation for Aug 3-7 booked months in advance. /updated filters on
    // updatedAt, so it cannot see these; the read must query by work date.
    const vacation = ["03", "04", "05", "06", "07"].map((day, i) => ({
      id: `vac-${i}`,
      date: `2026-08-${day}`,
      minutes: 480,
      status: "APPROVED",
      description: "",
      projectId: "abs-1",
      projectName: "Qte Vacation",
    }));
    routeFetch({ dateRange: vacation, updated: [], summaryByMonth: {} });

    const entries = await provider.getTimeEntries("emp-1", "2026-07-14", "2026-09-12");

    const vacationMinutes = entries
      .filter((e) => e.date >= "2026-08-03" && e.date <= "2026-08-07")
      .reduce((sum, e) => sum + e.minutes, 0);
    expect(vacationMinutes).toBe(2400); // 5 × 8h
  });

  it("queries startDate inclusive and endDate exclusive, keeping the final day", async () => {
    routeFetch({
      dateRange: [
        {
          id: "e-last",
          date: "2026-08-31",
          minutes: 60,
          status: "SAVED",
          description: "last day",
          projectId: "p1",
          projectName: "Fokus",
        },
      ],
    });

    const entries = await provider.getTimeEntries("emp-1", "2026-08-01", "2026-08-31");

    const primary = fetchedUrls().find((url) => url.includes("/v1/time_entry/employee/id/emp-1?"));
    expect(primary).toBeDefined();
    const params = new URL(primary as string).searchParams;
    expect(params.get("startDate")).toBe("2026-08-01");
    expect(params.get("endDate")).toBe("2026-09-01"); // exclusive per the API spec

    expect(entries.find((e) => e.id === "e-last")).toBeDefined();
  });

  it("falls back to /updated when the date-range read fails", async () => {
    routeFetch({
      dateRangeStatus: 500,
      updated: [
        {
          id: "e1",
          date: "2026-08-05",
          minutes: 480,
          status: "SAVED",
          description: "work",
          projectId: "p1",
          projectName: "Fokus",
        },
      ],
    });

    const entries = await provider.getTimeEntries("emp-1", "2026-07-14", "2026-09-12");
    expect(entries.find((e) => e.id === "e1")?.minutes).toBe(480);

    // The fallback needs a wide lookback, otherwise it reintroduces the very
    // gap it is standing in for.
    const updatedUrl = fetchedUrls().find((url) => url.includes("/updated"));
    expect(updatedUrl).toBeDefined();
    const updatedAfter = new URL(updatedUrl as string).searchParams.get("updatedAfter") as string;
    expect(Date.parse(updatedAfter)).toBeLessThan(Date.parse("2025-07-01T00:00:00Z"));
  });
});
