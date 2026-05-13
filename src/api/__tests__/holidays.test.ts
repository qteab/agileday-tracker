import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { createAgileDayProvider, type AgileDayConfig } from "../agileday";
import type { AuthState } from "../auth";
import { isHoliday, getHolidayName, holidaySet } from "../../utils/holidays";
import type { Holiday } from "../types";

// Mock fetch
const mockFetch = vi.fn() as Mock;

const TEST_CONFIG: AgileDayConfig = {
  apiBaseUrl: "https://qvik.agileday.io/api",
  authConfig: {
    oauthBaseUrl: "https://qvik.agileday.io/api/v1/oauth",
    clientId: "test-client-id",
    redirectUri: "http://localhost:19847/auth/callback",
  },
};

function fakeJwt(): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      sub: "emp-1",
      employee_id: "emp-1",
      email: "axel@qte.se",
      name: "Axel Jonsson",
      tid: "qvik",
    })
  );
  return `${header}.${payload}.fake-signature`;
}

const VALID_AUTH: AuthState = {
  accessToken: fakeJwt(),
  refreshToken: "test-refresh-token",
  expiresAt: Date.now() + 3600_000,
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AgileDay getHolidays", () => {
  let authState: AuthState | null = VALID_AUTH;

  beforeEach(() => {
    mockFetch.mockReset();
    authState = VALID_AUTH;
  });

  function createProvider() {
    return createAgileDayProvider(
      TEST_CONFIG,
      () => authState,
      (s) => {
        authState = s;
      },
      () => {
        authState = null;
      },
      mockFetch
    );
  }

  it("fetches holidays for SE country code with date range", async () => {
    const holidays = [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-01-06", name: "Epiphany" },
      { date: "2026-04-03", name: "Good Friday" },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse(holidays));

    const provider = createProvider();
    const result = await provider.getHolidays("SE", "2026-01-01", "2026-12-31");

    expect(result).toEqual(holidays);
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("/v1/workpackages/SE/holidays");
    expect(url).toContain("startDate=2026-01-01");
    expect(url).toContain("endDate=2026-12-31");
  });

  it("returns empty array when no holidays configured", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    const provider = createProvider();
    const result = await provider.getHolidays("SE", "2026-01-01", "2026-03-31");

    expect(result).toEqual([]);
  });

  it("encodes country code in URL", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    const provider = createProvider();
    await provider.getHolidays("SE", "2026-01-01", "2026-12-31");

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("/v1/workpackages/SE/holidays");
  });
});

describe("Holiday utility functions", () => {
  const holidays: Holiday[] = [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-06", name: "Epiphany" },
    { date: "2026-04-03", name: "Good Friday" },
    { date: "2026-06-19", name: "Midsummer Evening" },
    { date: "2026-12-24", name: "Christmas Eve" },
    { date: "2026-12-25", name: "Christmas Day" },
  ];

  describe("isHoliday", () => {
    it("returns true for a holiday date", () => {
      expect(isHoliday("2026-01-01", holidays)).toBe(true);
      expect(isHoliday("2026-06-19", holidays)).toBe(true);
    });

    it("returns false for a non-holiday date", () => {
      expect(isHoliday("2026-01-02", holidays)).toBe(false);
      expect(isHoliday("2026-07-15", holidays)).toBe(false);
    });

    it("returns false for empty holiday list", () => {
      expect(isHoliday("2026-01-01", [])).toBe(false);
    });
  });

  describe("getHolidayName", () => {
    it("returns the name for a holiday date", () => {
      expect(getHolidayName("2026-01-01", holidays)).toBe("New Year's Day");
      expect(getHolidayName("2026-12-25", holidays)).toBe("Christmas Day");
    });

    it("returns undefined for a non-holiday date", () => {
      expect(getHolidayName("2026-03-15", holidays)).toBeUndefined();
    });
  });

  describe("holidaySet", () => {
    it("builds a Set of date strings", () => {
      const set = holidaySet(holidays);
      expect(set.size).toBe(6);
      expect(set.has("2026-01-01")).toBe(true);
      expect(set.has("2026-12-25")).toBe(true);
      expect(set.has("2026-03-15")).toBe(false);
    });

    it("returns empty set for empty holidays", () => {
      expect(holidaySet([]).size).toBe(0);
    });
  });
});
