import { describe, it, expect } from "vitest";

import { decodeJwtPayload, employeeIdFromPayload } from "../jwt";

/** Standard base64 for the payload segment, as `btoa` would produce it. */
function tokenWith(payload: Record<string, unknown>): string {
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

/** base64url for the payload segment, as a real OAuth provider produces it. */
function urlSafeTokenWith(payload: Record<string, unknown>): string {
  const segment = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_");
  return `header.${segment}.signature`;
}

describe("decodeJwtPayload", () => {
  it("decodes the payload segment", () => {
    expect(decodeJwtPayload(tokenWith({ sub: "emp-1", email: "a@b.c" }))).toEqual({
      sub: "emp-1",
      email: "a@b.c",
    });
  });

  it("decodes a base64url payload segment", () => {
    const token = urlSafeTokenWith({ sub: "emp?>1", uid: "u1" });
    expect(token.split(".")[1]).toContain("_");
    expect(decodeJwtPayload(token)).toEqual({ sub: "emp?>1", uid: "u1" });
  });

  it("returns null for a missing token", () => {
    expect(decodeJwtPayload(undefined)).toBeNull();
    expect(decodeJwtPayload(null)).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });

  it("returns null when the payload segment is absent", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
  });

  it("returns null when the payload segment is not valid base64 JSON", () => {
    expect(decodeJwtPayload("header.!!!not-base64!!!.signature")).toBeNull();
  });
});

describe("employeeIdFromPayload", () => {
  it("prefers sub", () => {
    expect(employeeIdFromPayload({ sub: "a", employee_id: "b", uid: "c" })).toBe("a");
  });

  it("falls back to employee_id when sub is an empty string", () => {
    expect(employeeIdFromPayload({ sub: "", employee_id: "b" })).toBe("b");
  });

  it("falls back to uid when sub and employee_id are blank", () => {
    expect(employeeIdFromPayload({ sub: "", employee_id: "", uid: "c" })).toBe("c");
  });

  it("returns null when no id claim carries a value", () => {
    expect(employeeIdFromPayload({ sub: "", employee_id: "", uid: "" })).toBeNull();
    expect(employeeIdFromPayload({})).toBeNull();
    expect(employeeIdFromPayload(null)).toBeNull();
  });
});
