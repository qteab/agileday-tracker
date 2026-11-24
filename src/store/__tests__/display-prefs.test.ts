import { describe, expect, it } from "vitest";

import { normalizeDisplayPrefs } from "../display-store";

describe("normalizeDisplayPrefs", () => {
  it("defaults autoSubmit to false when nothing is stored", () => {
    expect(normalizeDisplayPrefs(null).autoSubmit).toBe(false);
  });

  it("defaults autoSubmit to false for prefs saved before the setting existed", () => {
    expect(normalizeDisplayPrefs({ menuBarMode: "full" }).autoSubmit).toBe(false);
  });

  it("keeps a stored autoSubmit of true", () => {
    expect(normalizeDisplayPrefs({ autoSubmit: true }).autoSubmit).toBe(true);
  });

  it("still maps the legacy showTimerInMenuBar flag", () => {
    expect(normalizeDisplayPrefs({ showTimerInMenuBar: false }).menuBarMode).toBe("off");
  });
});
