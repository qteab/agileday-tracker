import { describe, expect, it } from "vitest";

import { isEntryLocked } from "../entry-lock";

describe("isEntryLocked", () => {
  it("locks APPROVED whether or not auto-submit is on", () => {
    expect(isEntryLocked({ status: "APPROVED" }, false)).toBe(true);
    expect(isEntryLocked({ status: "APPROVED" }, true)).toBe(true);
  });

  it("locks SUBMITTED only when auto-submit is off", () => {
    expect(isEntryLocked({ status: "SUBMITTED" }, false)).toBe(true);
    expect(isEntryLocked({ status: "SUBMITTED" }, true)).toBe(false);
  });

  it("never locks an editable status", () => {
    for (const status of ["NEW", "SAVED", "CHANGE_REQUESTED"] as const) {
      expect(isEntryLocked({ status }, false)).toBe(false);
      expect(isEntryLocked({ status }, true)).toBe(false);
    }
  });
});
