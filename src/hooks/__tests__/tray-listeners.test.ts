import { describe, it, expect } from "vitest";

import { default as app } from "../../App.tsx?raw";
import { default as timer } from "../useTimer.ts?raw";

// Regression: tray listeners inside useTimer() were registered once per
// mounted ProjectCard, so one tray Stop click created 10–30 entries.
describe("tray timer listeners", () => {
  it("are registered only in useTrayTimerListeners, mounted once", () => {
    const useTimerBody = timer.slice(
      timer.indexOf("export function useTimer()"),
      timer.indexOf("export function useTrayTimerListeners()")
    );
    expect(useTimerBody).not.toContain('listen("tray-');
    expect(app.match(/useTrayTimerListeners\(\)/g)).toHaveLength(1);
  });
});
