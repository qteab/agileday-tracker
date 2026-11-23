/**
 * Auto-submit behaviour: when the setting is on, every AgileDay write is
 * bracketed by timecard status changes — unsubmit the affected week, write,
 * resubmit — so the existing consolidation path still sees editable entries.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { createAgileDayProvider, type AgileDayConfig } from "../agileday";
import type { AuthState } from "../auth";
import type { ApiProvider } from "../provider";

const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: Parameters<typeof globalThis.fetch>) => mockFetch(...args),
}));

function fakeJwt(): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ sub: "emp-1", employee_id: "emp-1", tid: "qvik" }));
  return `${header}.${payload}.fake-signature`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CONFIG: AgileDayConfig = {
  apiBaseUrl: "https://qvik.agileday.io/api",
  authConfig: {
    oauthBaseUrl: "https://qvik.agileday.io/api/v1/oauth",
    clientId: "test-client-id",
    redirectUri: "http://localhost:19847/auth/callback",
  },
};

const AUTH: AuthState = {
  accessToken: fakeJwt(),
  refreshToken: "r",
  expiresAt: Date.now() + 3600_000,
};

/** Tuesday 2026-05-05 → week of Monday 2026-05-04, month 2026-05-01. */
const DATE = "2026-05-05";
const WEEK = "2026-05-04";
const MONTH = "2026-05-01";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let enabled: boolean;
let provider: ApiProvider;
let calls: Call[];
/** Status of each week's fake timecard, keyed by its Monday. */
let cardStatuses: Record<string, string>;
/** Entries the fake API reports for the looked-up day. */
let dayEntries: Array<Record<string, unknown>>;
/** Make the timecard lookup find nothing, as for a week with no timesheet. */
let cardMissing: boolean;
/** Make the status POST fail, as a frozen or approved timecard would. */
let statusFails: boolean;

function statusBodies(): unknown[] {
  return calls.filter((c) => c.path.includes("/time_card/")).map((c) => c.body);
}

/** Write calls to the time_entry collection, in order. */
function writeMethods(): string[] {
  return calls
    .filter((c) => /\/v1\/time_entry\/employee\/id\/emp-1$/.test(c.path) && c.method !== "GET")
    .map((c) => c.method);
}

/** The sequence of status changes and writes, to assert ordering. */
function timeline(): string[] {
  return calls.flatMap((c) => {
    if (c.path.includes("/time_card/")) return [(c.body as { status: string }).status];
    if (/\/v1\/time_entry\/employee\/id\/emp-1$/.test(c.path) && c.method !== "GET")
      return ["write"];
    if (c.path.startsWith("/v1/time_entry") && c.method === "DELETE") return ["write"];
    return [];
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  calls = [];
  enabled = false;
  cardStatuses = { [WEEK]: "SUBMITTED", "2026-05-11": "SUBMITTED" };
  cardMissing = false;
  statusFails = false;
  dayEntries = [];

  mockFetch.mockImplementation((rawUrl, init) => {
    const url = new URL(rawUrl as string);
    const path = url.pathname.replace("/api", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
    calls.push({ method, path, body });

    if (path.startsWith("/v1/timesheets/by-employee/month/")) {
      const cards = cardMissing
        ? []
        : Object.entries(cardStatuses).map(([week, status]) => ({
            id: `tc-${week}`,
            employeeId: "emp-1",
            week,
            month: MONTH,
            status,
          }));
      return Promise.resolve(jsonResponse({ timecards: cards }));
    }

    if (path.includes("/time_card/")) {
      if (statusFails) return Promise.resolve(jsonResponse({ error: "frozen" }, 403));
      const week = path.split("/time_card/id/tc-")[1] ?? WEEK;
      const status = (body as { status: string }).status;
      cardStatuses[week] = status;
      // The real endpoint cascades the status onto that week's entries.
      if (week === WEEK) for (const e of dayEntries) e["status"] = status;
      return Promise.resolve(jsonResponse({}));
    }

    // Day lookup used by createTimeEntry to find a mergeable entry.
    if (method === "GET" && /\/v1\/time_entry\/employee\/id\/emp-1$/.test(path)) {
      return Promise.resolve(jsonResponse(dayEntries));
    }

    // Writes echo one entry back.
    return Promise.resolve(
      jsonResponse([
        { id: "e-new", date: DATE, minutes: 60, status: "SAVED", projectId: "p1", taskId: "t1" },
      ])
    );
  });

  provider = createAgileDayProvider(
    CONFIG,
    () => AUTH,
    () => {},
    () => {},
    undefined,
    { autoSubmit: () => enabled }
  );
});

function entry(over: Partial<Parameters<ApiProvider["createTimeEntry"]>[1]> = {}) {
  return {
    description: "work",
    projectId: "p1",
    taskId: "t1",
    date: DATE,
    startTime: `${DATE}T09:00:00.000Z`,
    minutes: 30,
    status: "SAVED" as const,
    ...over,
  };
}

describe("auto-submit off", () => {
  it("makes no timecard requests", async () => {
    await provider.createTimeEntry("emp-1", entry());
    expect(calls.filter((c) => c.path.includes("time_card") || c.path.includes("timesheets"))).toEqual(
      []
    );
  });
});

describe("auto-submit on", () => {
  beforeEach(() => {
    enabled = true;
  });

  it("unsubmits the week, writes, then resubmits", async () => {
    await provider.createTimeEntry("emp-1", entry());
    expect(statusBodies()).toEqual([{ status: "SAVED" }, { status: "SUBMITTED" }]);
    expect(timeline()).toEqual(["SAVED", "write", "SUBMITTED"]);
  });

  it("merges into the existing entry instead of creating a duplicate", async () => {
    // The day already holds this project+task, locked by the submitted week.
    dayEntries = [
      { id: "e1", date: DATE, minutes: 60, status: "SUBMITTED", projectId: "p1", taskId: "t1" },
    ];
    await provider.createTimeEntry("emp-1", entry({ minutes: 30 }));
    expect(writeMethods()).toEqual(["PATCH"]);
  });

  it("still saves the entry when the week has no timecard", async () => {
    cardMissing = true;
    await expect(provider.createTimeEntry("emp-1", entry())).resolves.toMatchObject({ id: "e-new" });
    expect(writeMethods()).toEqual(["POST"]);
  });

  it("still saves the entry when the status call fails", async () => {
    statusFails = true;
    await expect(provider.createTimeEntry("emp-1", entry())).resolves.toMatchObject({ id: "e-new" });
    expect(writeMethods()).toEqual(["POST"]);
  });

  it("submits each distinct week once for a batch spanning two weeks", async () => {
    await provider.batchUpdateEntries("emp-1", [
      { id: "a", date: DATE, minutes: 60 },
      { id: "b", date: "2026-05-12", minutes: 60 },
    ]);
    const submitted = calls
      .filter((c) => c.path.includes("/timesheets/by-employee/month/"))
      .map((c) => c.path);
    expect(submitted).toHaveLength(4); // two weeks, looked up to unsubmit and to resubmit
    expect(statusBodies()).toEqual([
      { status: "SAVED" },
      { status: "SAVED" },
      { status: "SUBMITTED" },
      { status: "SUBMITTED" },
    ]);
  });

  it("writes without auto-submitting when no date is available", async () => {
    await provider.deleteTimeEntry(["e1"]);
    expect(statusBodies()).toEqual([]);
    expect(timeline()).toEqual(["write"]);
  });

  it("submits the week of a delete when the date is given", async () => {
    await provider.deleteTimeEntry(["e1"], [DATE]);
    expect(timeline()).toEqual(["SAVED", "write", "SUBMITTED"]);
  });
});
