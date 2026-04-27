import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { createAgileDayProvider, type AgileDayConfig } from "../agileday";
import type { ApiProvider } from "../provider";
import type { AuthState } from "../auth";

// Mock global fetch
const mockFetch = vi.fn() as Mock;
vi.stubGlobal("fetch", mockFetch);

const TEST_CONFIG: AgileDayConfig = {
  apiBaseUrl: "https://qvik.agileday.io/api",
  authConfig: {
    oauthBaseUrl: "https://qvik.agileday.io/api/v1/oauth",
    clientId: "test-client-id",
    redirectUri: "http://localhost:19847/auth/callback",
  },
};

const VALID_AUTH: AuthState = {
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  expiresAt: Date.now() + 3600_000, // 1 hour from now
};

const EXPIRED_AUTH: AuthState = {
  accessToken: "expired-token",
  refreshToken: "test-refresh-token",
  expiresAt: Date.now() - 1000, // already expired
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
  provider = createAgileDayProvider(TEST_CONFIG, () => authState, setAuthState, clearAuthState);
});

// --- AC-48: Verify correct HTTP methods and paths ---

describe("getCurrentEmployee", () => {
  it("calls GET /v1/employee?limit=1", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "emp-1",
          firstName: "Axel",
          lastName: "Jonsson",
          name: "Axel Jonsson",
          email: "axel@qte.se",
        },
      ])
    );

    const emp = await provider.getCurrentEmployee();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://qvik.agileday.io/api/v1/employee?limit=1");
    expect(opts.method).toBeUndefined(); // GET is default
    expect(emp).toEqual({ id: "emp-1", name: "Axel Jonsson", email: "axel@qte.se" });
  });

  it("throws when no employees returned", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    await expect(provider.getCurrentEmployee()).rejects.toThrow("No employee found");
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
  it("calls GET with employee ID and date range", async () => {
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

    const entries = await provider.getTimeEntries("emp-1", "2026-04-01", "2026-04-30");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://qvik.agileday.io/api/v1/time_entry/employee/id/emp-1?startDate=2026-04-01&endDate=2026-04-30"
    );
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

    const entries = await provider.getTimeEntries("emp-1", "2026-04-24", "2026-04-24");
    expect(entries[0].description).toBe("");
  });
});

describe("createTimeEntry", () => {
  it("POSTs array to /v1/time_entry/employee/id/{id}", async () => {
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

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://qvik.agileday.io/api/v1/time_entry/employee/id/emp-1");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body);
    expect(body).toHaveLength(1);
    expect(body[0].date).toBe("2026-04-24");
    expect(body[0].minutes).toBe(60);
    expect(body[0].projectId).toBe("p1");
    expect(body[0].description).toBe("dev");

    expect(entry.id).toBe("new-1");
    expect(entry.syncStatus).toBe("synced");
  });

  it("omits optional fields when not provided", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: "new-2", date: "2026-04-24", minutes: 30, status: "SAVED", projectId: "p1" },
      ])
    );

    await provider.createTimeEntry("emp-1", {
      description: "",
      projectId: "p1",
      date: "2026-04-24",
      startTime: "2026-04-24T09:00:00Z",
      minutes: 30,
      status: "SAVED",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body[0]).not.toHaveProperty("taskId");
    expect(body[0]).not.toHaveProperty("description"); // empty string is falsy
  });

  it("throws when API returns empty array", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
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
    expect(opts.headers.Authorization).toBe("Bearer test-access-token");
  });

  it("throws when not authenticated", async () => {
    authState = null;
    await expect(provider.getProjects()).rejects.toThrow("Not authenticated");
  });

  it("clears auth state on 401 response", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401));
    await expect(provider.getProjects()).rejects.toThrow("Authentication failed");
    expect(clearAuthState).toHaveBeenCalledOnce();
  });

  it("propagates non-401 API errors", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, "Internal Server Error"));
    await expect(provider.getProjects()).rejects.toThrow("API error 500: Internal Server Error");
    expect(clearAuthState).not.toHaveBeenCalled();
  });

  it("refreshes expired token before making request", async () => {
    authState = { ...EXPIRED_AUTH };

    // First call: refresh token endpoint
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: "new-access-token",
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
    expect(apiOpts.headers.Authorization).toBe("Bearer new-access-token");

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
      clearAuthState
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
