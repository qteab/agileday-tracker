import { describe, it, expect } from "vitest";
import { appReducer, initialState } from "../reducer";

// Regression: tray Continue resumed the project card instead of the ClickUp task.
describe("lastTimer", () => {
  const running = appReducer(initialState, {
    type: "SET_TIMER",
    payload: {
      projectId: "p1",
      taskId: "t1",
      clickupTask: { id: "cu1", name: "Fix bug", teamId: "team", timerId: "ct1" },
      isRunning: true,
      startTime: "2026-10-04T08:00:00.000Z",
    },
  });

  it("remembers the stopped timer's ClickUp task, without the adopted timer", () => {
    const stopped = appReducer(running, { type: "RESET_TIMER", stopped: true });
    expect(stopped.timer).toEqual(initialState.timer);
    expect(stopped.lastTimer).toEqual({
      projectId: "p1",
      taskId: "t1",
      clickupTask: { id: "cu1", name: "Fix bug", teamId: "team", timerId: undefined },
    });
  });

  it("is not set when the timer is discarded (entry deleted)", () => {
    expect(appReducer(running, { type: "RESET_TIMER" }).lastTimer).toBeNull();
  });
});
