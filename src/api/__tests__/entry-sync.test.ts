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
    // /updated query returns no matches
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

    // First call: /updated query
    expect(mockFetch.mock.calls[0][0]).toContain("/updated");
    // Second call: POST
    expect(mockFetch.mock.calls[1][1].method).toBe("POST");
    expect(entry.id).toBe("agile-1");
    expect(entry.minutes).toBe(5);
  });

  it("PATCHes existing entry when one match found", async () => {
    // /updated returns one existing entry with 10 min
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "agile-existing",
          date: "2026-04-28",
          minutes: 10,
          status: "SAVED",
          description: "code review",
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
          description: "code review",
          projectId: "p1",
        },
      ])
    );

    const entry = await provider.createTimeEntry("emp-1", {
      description: "code review",
      projectId: "p1",
      date: "2026-04-28",
      startTime: "2026-04-28T09:30:00Z",
      minutes: 5,
      status: "SAVED",
    });

    expect(mockFetch.mock.calls[1][1].method).toBe("PATCH");
    const patchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(patchBody[0].minutes).toBe(15); // 10 existing + 5 new
    expect(entry.id).toBe("agile-existing");
    expect(entry.minutes).toBe(15);
  });

  it("consolidates when multiple matches found: creates new + deletes old", async () => {
    // /updated returns 3 duplicates
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "dup-1",
          date: "2026-04-28",
          minutes: 2,
          status: "SAVED",
          description: "review",
          projectId: "p1",
        },
        {
          id: "dup-2",
          date: "2026-04-28",
          minutes: 3,
          status: "SAVED",
          description: "review",
          projectId: "p1",
        },
        {
          id: "dup-3",
          date: "2026-04-28",
          minutes: 4,
          status: "SAVED",
          description: "review",
          projectId: "p1",
        },
      ])
    );
    // POST consolidated entry (2+3+4+5 = 14 min)
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "consolidated",
          date: "2026-04-28",
          minutes: 14,
          status: "SAVED",
          description: "review",
          projectId: "p1",
        },
      ])
    );
    // DELETE dup-1, dup-2, dup-3 (one by one)
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: "dup-1" }]));
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: "dup-2" }]));
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: "dup-3" }]));

    const entry = await provider.createTimeEntry("emp-1", {
      description: "review",
      projectId: "p1",
      date: "2026-04-28",
      startTime: "2026-04-28T10:00:00Z",
      minutes: 5,
      status: "SAVED",
    });

    // POST with consolidated total
    const postBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(postBody[0].minutes).toBe(14); // 2+3+4+5

    // 3 DELETE calls
    expect(mockFetch.mock.calls[2][0]).toContain("ids=dup-1");
    expect(mockFetch.mock.calls[3][0]).toContain("ids=dup-2");
    expect(mockFetch.mock.calls[4][0]).toContain("ids=dup-3");

    expect(entry.id).toBe("consolidated");
    expect(entry.minutes).toBe(14);
  });

  it("only matches entries with same description+project+date+SAVED status", async () => {
    // /updated returns entries, but only one matches fully
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
          id: "different-desc",
          date: "2026-04-28",
          minutes: 5,
          status: "SAVED",
          description: "other work",
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
      ])
    );
    // No matches → POST new
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "new-1",
          date: "2026-04-28",
          minutes: 5,
          status: "SAVED",
          description: "review",
          projectId: "p1",
        },
      ])
    );

    await provider.createTimeEntry("emp-1", {
      description: "review",
      projectId: "p1",
      date: "2026-04-28",
      startTime: "2026-04-28T09:00:00Z",
      minutes: 5,
      status: "SAVED",
    });

    // Should POST (no SAVED match for same desc+project)
    expect(mockFetch.mock.calls[1][1].method).toBe("POST");
  });

  it("different description creates separate entry even on same project+date", async () => {
    // /updated returns an entry with different description
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "existing",
          date: "2026-04-28",
          minutes: 30,
          status: "SAVED",
          description: "meetings",
          projectId: "p1",
        },
      ])
    );
    // POST new (different description)
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "new-1",
          date: "2026-04-28",
          minutes: 15,
          status: "SAVED",
          description: "code review",
          projectId: "p1",
        },
      ])
    );

    await provider.createTimeEntry("emp-1", {
      description: "code review",
      projectId: "p1",
      date: "2026-04-28",
      startTime: "2026-04-28T09:00:00Z",
      minutes: 15,
      status: "SAVED",
    });

    expect(mockFetch.mock.calls[1][1].method).toBe("POST");
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

  it("sends group total when editing one session in a multi-session group", async () => {
    // Scenario: Group has Session A (3 min) + Session B (7 min) = 10 min on AgileDay
    // User edits Session A to 5 min
    // The component calculates: groupTotal = 5 (edited) + 7 (other) = 12
    // Then calls updateTimeEntry with minutes: 12
    //
    // This test verifies the API receives and returns the correct total.
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
});
