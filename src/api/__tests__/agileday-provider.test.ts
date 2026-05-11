import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import {
  createAgileDayProvider,
  mergeDescriptions,
  removeDescription,
  type AgileDayConfig,
} from "../agileday";
import type { ApiProvider } from "../provider";
import type { AuthState } from "../auth";

// Mock global fetch — used by both apiFetch and auth token exchange
const mockFetch = vi.fn() as Mock;
vi.stubGlobal("fetch", mockFetch);

// Mock Tauri HTTP plugin to use our mockFetch
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) => mockFetch(...args),
}));

const TEST_CONFIG: AgileDayConfig = {
  apiBaseUrl: "https://qvik.agileday.io/api",
  authConfig: {
    oauthBaseUrl: "https://qvik.agileday.io/api/v1/oauth",
    clientId: "test-client-id",
    redirectUri: "http://localhost:19847/auth/callback",
  },
};

// Build a fake JWT with employee_id claim
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

const VALID_AUTH: AuthState = {
  accessToken: fakeJwt(),
  refreshToken: "test-refresh-token",
  expiresAt: Date.now() + 3600_000,
};

const EXPIRED_AUTH: AuthState = {
  accessToken: fakeJwt(),
  refreshToken: "test-refresh-token",
  expiresAt: Date.now() - 1000,
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, body = "Error"): Response {
  return new Response(body, { status });
}

let provider: ApiProvider;
let authState: AuthState | null;
let setAuthState: Mock;
let clearAuthState: Mock;

beforeEach(() => {
  mockFetch.mockReset();
  authState = { ...VALID_AUTH };
  setAuthState = vi.fn((s: AuthState) => {
    authState = s;
  });
  clearAuthState = vi.fn(() => {
    authState = null;
  });
  provider = createAgileDayProvider(
    TEST_CONFIG,
    () => authState,
    setAuthState,
    clearAuthState,
    mockFetch as typeof globalThis.fetch
  );
});

// --- AC-48: Verify correct HTTP methods and paths ---

describe("getCurrentEmployee", () => {
  it("fetches full profile from API using JWT employee_id", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: "emp-1", name: "Axel Jonsson", email: "axel@qte.se" })
    );

    const emp = await provider.getCurrentEmployee();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://qvik.agileday.io/api/v1/employee/id/emp-1");
    expect(emp).toEqual({ id: "emp-1", name: "Axel Jonsson", email: "axel@qte.se" });
  });

  it("falls back to JWT claims if employee API fails", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(403, "Forbidden"));

    const emp = await provider.getCurrentEmployee();

    expect(emp.id).toBe("emp-1");
    expect(emp.name).toBe("Axel Jonsson");
    expect(emp.email).toBe("axel@qte.se");
  });

  it("throws when JWT has no employee_id", async () => {
    authState = {
      ...VALID_AUTH,
      accessToken: fakeJwt({ sub: undefined, employee_id: undefined, uid: undefined }),
    };
    provider = createAgileDayProvider(
      TEST_CONFIG,
      () => authState,
      setAuthState,
      clearAuthState,
      mockFetch as typeof globalThis.fetch
    );

    await expect(provider.getCurrentEmployee()).rejects.toThrow("employee ID");
  });

  it("throws when not authenticated", async () => {
    authState = null;
    await expect(provider.getCurrentEmployee()).rejects.toThrow("Not authenticated");
  });
});

describe("getProjects", () => {
  it("calls GET /v1/project with active filter and sorts by name", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: "p1", name: "Fokus", customer: { name: "QTE" } },
        { id: "p2", name: "DHL", customer: null },
      ])
    );

    const projects = await provider.getProjects();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://qvik.agileday.io/api/v1/project?projectStage=ACTIVE&sortBy=name&sortDirection=asc"
    );
    expect(projects).toHaveLength(2);
    expect(projects[0].name).toBe("Fokus");
    expect(projects[0].customerName).toBe("QTE");
    expect(projects[1].customerName).toBeUndefined();
  });

  it("assigns colors to projects", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: "p1", name: "A" },
        { id: "p2", name: "B" },
      ])
    );

    const projects = await provider.getProjects();
    expect(projects[0].color).toBeTruthy();
    expect(projects[1].color).toBeTruthy();
    expect(projects[0].color).not.toBe(projects[1].color);
  });
});

describe("getTasks", () => {
  it("calls GET /v1/project/id/{projectId}/task", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: "t1", name: "Dev", projectId: "p1", billable: true, active: true },
        { id: "t2", name: "Archived", projectId: "p1", billable: true, active: false },
      ])
    );

    const tasks = await provider.getTasks("p1");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://qvik.agileday.io/api/v1/project/id/p1/task");
    // Only active tasks returned
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("Dev");
  });

  it("filters out inactive tasks", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: "t1", name: "Active", projectId: "p1", billable: true, active: true },
        { id: "t2", name: "Inactive", projectId: "p1", billable: false, active: false },
        { id: "t3", name: "Also Active", projectId: "p1", billable: true, active: true },
      ])
    );

    const tasks = await provider.getTasks("p1");
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.active)).toBe(true);
  });
});

describe("getTimeEntries", () => {
  it("fetches from /updated endpoint and timesheets summary", async () => {
    // First call: /updated endpoint (detailed entries with descriptions)
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "e1",
          description: "work",
          projectId: "p1",
          projectName: "Fokus",
          date: "2026-04-24",
          minutes: 60,
          status: "SAVED",
        },
      ])
    );
    // Second call: timesheets summary
    mockFetch.mockResolvedValueOnce(jsonResponse({ entries: [] }));

    const entries = await provider.getTimeEntries("emp-1", "2026-04-01", "2026-04-30");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/time_entry/employee/id/emp-1/updated");
    expect(entries).toHaveLength(1);
    expect(entries[0].syncStatus).toBe("synced");
    expect(entries[0].description).toBe("work");
  });

  it("handles null description", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "e1",
          description: null,
          projectId: "p1",
          projectName: "Fokus",
          date: "2026-04-24",
          minutes: 30,
          status: "SAVED",
        },
      ])
    );
    mockFetch.mockResolvedValueOnce(jsonResponse({ entries: [] }));

    const entries = await provider.getTimeEntries("emp-1", "2026-04-24", "2026-04-24");
    expect(entries[0].description).toBe("");
  });
});

describe("createTimeEntry", () => {
  it("queries /updated first, then POSTs if no match", async () => {
    // First call: /updated query returns no matches
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    // Second call: POST creates entry
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "new-1",
          date: "2026-04-24",
          minutes: 60,
          status: "SAVED",
          description: "dev",
          projectId: "p1",
        },
      ])
    );

    const entry = await provider.createTimeEntry("emp-1", {
      description: "dev",
      projectId: "p1",
      date: "2026-04-24",
      startTime: "2026-04-24T09:00:00Z",
      endTime: "2026-04-24T10:00:00Z",
      minutes: 60,
      status: "SAVED",
    });

    // First call was /updated query
    expect(mockFetch.mock.calls[0][0]).toContain("/updated");
    // Second call was POST
    const [url, opts] = mockFetch.mock.calls[1];
    expect(url).toContain("/v1/time_entry/employee/id/emp-1");
    expect(opts.method).toBe("POST");
    expect(entry.id).toBe("new-1");
    expect(entry.syncStatus).toBe("synced");
  });

  it("PATCHes existing entry when one match found", async () => {
    // /updated returns one matching entry
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "existing-1",
          date: "2026-04-24",
          minutes: 30,
          status: "SAVED",
          description: "dev",
          projectId: "p1",
        },
      ])
    );
    // PATCH response
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "existing-1",
          date: "2026-04-24",
          minutes: 90,
          status: "SAVED",
          description: "dev",
          projectId: "p1",
        },
      ])
    );

    const entry = await provider.createTimeEntry("emp-1", {
      description: "dev",
      projectId: "p1",
      date: "2026-04-24",
      startTime: "2026-04-24T09:00:00Z",
      minutes: 60,
      status: "SAVED",
    });

    const [, opts] = mockFetch.mock.calls[1];
    expect(opts.method).toBe("PATCH");
    expect(entry.minutes).toBe(90); // 30 existing + 60 new
  });

  it("throws when POST returns empty array", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([])); // /updated
    mockFetch.mockResolvedValueOnce(jsonResponse([])); // POST returns empty
    await expect(
      provider.createTimeEntry("emp-1", {
        description: "test",
        projectId: "p1",
        date: "2026-04-24",
        startTime: "2026-04-24T09:00:00Z",
        minutes: 60,
        status: "SAVED",
      })
    ).rejects.toThrow("No entry returned from API");
  });
});

describe("updateTimeEntry", () => {
  it("PATCHes with entry ID and only changed fields", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "e1",
          date: "2026-04-24",
          minutes: 120,
          status: "SAVED",
          description: "updated",
          projectId: "p1",
        },
      ])
    );

    await provider.updateTimeEntry("emp-1", "e1", {
      description: "updated",
      minutes: 120,
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://qvik.agileday.io/api/v1/time_entry/employee/id/emp-1");
    expect(opts.method).toBe("PATCH");

    const body = JSON.parse(opts.body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("e1");
    expect(body[0].description).toBe("updated");
    expect(body[0].minutes).toBe(120);
    // Fields not in updates should not be in the body
    expect(body[0]).not.toHaveProperty("date");
    expect(body[0]).not.toHaveProperty("projectId");
  });
});

describe("deleteTimeEntry", () => {
  it("DELETEs with IDs as query param", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await provider.deleteTimeEntry(["e1", "e2"]);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://qvik.agileday.io/api/v1/time_entry?ids=e1,e2");
    expect(opts.method).toBe("DELETE");
  });

  it("skips API call for empty IDs array", async () => {
    await provider.deleteTimeEntry([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// --- Auth header and token handling ---

describe("authentication", () => {
  it("sends Bearer token in Authorization header", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await provider.getProjects();

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toMatch(/^Bearer eyJ/);
  });

  it("throws when not authenticated", async () => {
    authState = null;
    await expect(provider.getProjects()).rejects.toThrow("Not authenticated");
  });

  it("clears auth state on 401 response", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401));
    await expect(provider.getProjects()).rejects.toThrow("Auth failed (401)");
    // Auth is NOT cleared on 401 anymore — user sees the error and can retry
  });

  it("propagates non-401 API errors", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, "Internal Server Error"));
    await expect(provider.getProjects()).rejects.toThrow("API error 500");
    expect(clearAuthState).not.toHaveBeenCalled();
  });

  it("refreshes expired token before making request", async () => {
    authState = { ...EXPIRED_AUTH };

    // First call: refresh token endpoint
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: fakeJwt({ sub: "emp-2" }),
        refresh_token: "new-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
      })
    );
    // Second call: actual API request
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await provider.getProjects();

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call was to token endpoint
    const [refreshUrl] = mockFetch.mock.calls[0];
    expect(refreshUrl).toBe("https://qvik.agileday.io/api/v1/oauth/token");

    // Second call used new token
    const [, apiOpts] = mockFetch.mock.calls[1];
    expect(apiOpts.headers.Authorization).toMatch(/^Bearer /);

    expect(setAuthState).toHaveBeenCalledOnce();
  });

  it("clears auth when refresh fails", async () => {
    authState = { ...EXPIRED_AUTH };
    mockFetch.mockResolvedValueOnce(errorResponse(400, "invalid_grant"));

    await expect(provider.getProjects()).rejects.toThrow("Session expired");
    expect(clearAuthState).toHaveBeenCalledOnce();
  });

  it("clears auth when expired and no refresh token", async () => {
    authState = { ...EXPIRED_AUTH, refreshToken: undefined };

    await expect(provider.getProjects()).rejects.toThrow("Session expired");
    expect(clearAuthState).toHaveBeenCalledOnce();
  });
});

// --- Security ---

describe("security", () => {
  it("rejects HTTP URLs (enforces HTTPS)", async () => {
    const httpProvider = createAgileDayProvider(
      { ...TEST_CONFIG, apiBaseUrl: "http://qvik.agileday.io/api" },
      () => authState,
      setAuthState,
      clearAuthState,
      mockFetch as typeof globalThis.fetch
    );

    await expect(httpProvider.getProjects()).rejects.toThrow("API calls must use HTTPS");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends Content-Type: application/json on all requests", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await provider.getProjects();

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });
});

// --- mergeDescriptions utility ---

describe("mergeDescriptions", () => {
  it("returns prefixed incoming when existing is empty", () => {
    expect(mergeDescriptions("", "task 1")).toBe("- task 1");
  });

  it("returns existing unchanged when incoming is empty", () => {
    expect(mergeDescriptions("- task 1", "")).toBe("- task 1");
  });

  it("appends new description as a bullet line", () => {
    expect(mergeDescriptions("- task 1", "task 2")).toBe("- task 1\n- task 2");
  });

  it("deduplicates matching descriptions", () => {
    expect(mergeDescriptions("- task 1", "task 1")).toBe("- task 1");
  });

  it("handles plain text existing (no dash prefix)", () => {
    expect(mergeDescriptions("task 1", "task 2")).toBe("- task 1\n- task 2");
  });

  it("handles multiple existing lines", () => {
    const existing = "- task 1\n- task 2";
    expect(mergeDescriptions(existing, "task 3")).toBe("- task 1\n- task 2\n- task 3");
  });

  it("deduplicates against any existing line", () => {
    const existing = "- task 1\n- task 2";
    expect(mergeDescriptions(existing, "task 2")).toBe("- task 1\n- task 2");
  });
});

// --- removeDescription utility ---

describe("removeDescription", () => {
  it("removes a matching line from grouped description", () => {
    expect(removeDescription("- task 1\n- task 2\n- task 3", "task 2")).toBe("- task 1\n- task 3");
  });

  it("removes dash-prefixed input", () => {
    expect(removeDescription("- task 1\n- task 2", "- task 1")).toBe("- task 2");
  });

  it("returns empty string when last line is removed", () => {
    expect(removeDescription("- task 1", "task 1")).toBe("");
  });

  it("returns existing unchanged when toRemove is empty", () => {
    expect(removeDescription("- task 1", "")).toBe("- task 1");
  });

  it("returns existing unchanged when no match found", () => {
    expect(removeDescription("- task 1\n- task 2", "task 3")).toBe("- task 1\n- task 2");
  });

  it("handles plain text existing", () => {
    expect(removeDescription("task 1\ntask 2", "task 1")).toBe("- task 2");
  });

  it("returns empty for empty existing", () => {
    expect(removeDescription("", "task 1")).toBe("");
  });
});

// --- createTimeEntry grouping ---

describe("createTimeEntry grouping", () => {
  it("matches by project+task+date only, ignoring description", async () => {
    // /updated returns an entry with different description but same project+task+date
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "existing-1",
          date: "2026-04-24",
          minutes: 30,
          status: "SAVED",
          description: "- task 1",
          projectId: "p1",
          taskId: "t1",
        },
      ])
    );
    // PATCH response
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "existing-1",
          date: "2026-04-24",
          minutes: 90,
          status: "SAVED",
          description: "- task 1\n- task 2",
          projectId: "p1",
          taskId: "t1",
        },
      ])
    );

    const entry = await provider.createTimeEntry("emp-1", {
      description: "task 2",
      projectId: "p1",
      taskId: "t1",
      date: "2026-04-24",
      startTime: "2026-04-24T09:00:00Z",
      minutes: 60,
      status: "SAVED",
    });

    // Should PATCH, not POST
    const [, opts] = mockFetch.mock.calls[1];
    expect(opts.method).toBe("PATCH");
    expect(entry.minutes).toBe(90);

    // Verify the PATCH body includes updated description
    const body = JSON.parse(opts.body);
    expect(body[0].description).toBe("- task 1\n- task 2");
  });

  it("creates new entry when no match exists", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([])); // /updated: no matches
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "new-1",
          date: "2026-04-24",
          minutes: 60,
          status: "SAVED",
          description: "task 1",
          projectId: "p1",
          taskId: "t1",
        },
      ])
    );

    const entry = await provider.createTimeEntry("emp-1", {
      description: "task 1",
      projectId: "p1",
      taskId: "t1",
      date: "2026-04-24",
      startTime: "2026-04-24T09:00:00Z",
      minutes: 60,
      status: "SAVED",
    });

    const [, opts] = mockFetch.mock.calls[1];
    expect(opts.method).toBe("POST");
    expect(entry.id).toBe("new-1");
  });

  it("does not append empty description", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "existing-1",
          date: "2026-04-24",
          minutes: 30,
          status: "SAVED",
          description: "- task 1",
          projectId: "p1",
          taskId: "t1",
        },
      ])
    );
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "existing-1",
          date: "2026-04-24",
          minutes: 90,
          status: "SAVED",
          description: "- task 1",
          projectId: "p1",
          taskId: "t1",
        },
      ])
    );

    await provider.createTimeEntry("emp-1", {
      description: "",
      projectId: "p1",
      taskId: "t1",
      date: "2026-04-24",
      startTime: "2026-04-24T09:00:00Z",
      minutes: 60,
      status: "SAVED",
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    // Should not include description field since it's empty
    expect(body[0].description).toBeUndefined();
  });

  it("matches entries without taskId (both undefined)", async () => {
    // Both existing and new entry have no taskId — should match
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "existing-1",
          date: "2026-04-24",
          minutes: 30,
          status: "SAVED",
          description: "- meetings",
          projectId: "p1",
          // no taskId
        },
      ])
    );
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "existing-1",
          date: "2026-04-24",
          minutes: 90,
          status: "SAVED",
          description: "- meetings\n- standup",
          projectId: "p1",
        },
      ])
    );

    const entry = await provider.createTimeEntry("emp-1", {
      description: "standup",
      projectId: "p1",
      // no taskId
      date: "2026-04-24",
      startTime: "2026-04-24T09:00:00Z",
      minutes: 60,
      status: "SAVED",
    });

    const [, opts] = mockFetch.mock.calls[1];
    expect(opts.method).toBe("PATCH");
    expect(entry.minutes).toBe(90);
    const body = JSON.parse(opts.body);
    expect(body[0].description).toBe("- meetings\n- standup");
  });

  it("merges descriptions from multiple matches during consolidation", async () => {
    // 2 existing entries with different descriptions on same project+task+date
    // (plain text — as created by single sessions before grouping merged them)
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "dup-1",
          date: "2026-04-24",
          minutes: 20,
          status: "SAVED",
          description: "review",
          projectId: "p1",
          taskId: "t1",
        },
        {
          id: "dup-2",
          date: "2026-04-24",
          minutes: 30,
          status: "SAVED",
          description: "planning",
          projectId: "p1",
          taskId: "t1",
        },
      ])
    );
    // POST consolidated
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "consolidated",
          date: "2026-04-24",
          minutes: 65,
          status: "SAVED",
          description: "- review\n- planning\n- coding",
          projectId: "p1",
          taskId: "t1",
        },
      ])
    );
    // DELETE old entries
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: "dup-1" }]));
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: "dup-2" }]));

    await provider.createTimeEntry("emp-1", {
      description: "coding",
      projectId: "p1",
      taskId: "t1",
      date: "2026-04-24",
      startTime: "2026-04-24T09:00:00Z",
      minutes: 15,
      status: "SAVED",
    });

    const postBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(postBody[0].minutes).toBe(65); // 20+30+15
    expect(postBody[0].description).toBe("- review\n- planning\n- coding");
  });

  it("does not group across different tasks", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "existing-1",
          date: "2026-04-24",
          minutes: 30,
          status: "SAVED",
          description: "task 1",
          projectId: "p1",
          taskId: "t1",
        },
      ])
    );
    // No match for taskId "t2", so POST
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "new-1",
          date: "2026-04-24",
          minutes: 60,
          status: "SAVED",
          description: "task 2",
          projectId: "p1",
          taskId: "t2",
        },
      ])
    );

    await provider.createTimeEntry("emp-1", {
      description: "task 2",
      projectId: "p1",
      taskId: "t2",
      date: "2026-04-24",
      startTime: "2026-04-24T09:00:00Z",
      minutes: 60,
      status: "SAVED",
    });

    const [, opts] = mockFetch.mock.calls[1];
    expect(opts.method).toBe("POST");
  });
});
