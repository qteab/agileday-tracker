import { describe, it, expect } from "vitest";
import { appReducer, initialState } from "../reducer";

describe("inactivity reducer", () => {
  it("SET_INACTIVITY records current idle and away state", () => {
    const next = appReducer(initialState, {
      type: "SET_INACTIVITY",
      payload: { idleSeconds: 90, isAway: false },
    });
    expect(next.inactivity.idleSeconds).toBe(90);
    expect(next.inactivity.isAway).toBe(false);
    expect(next.inactivity.pendingReturn).toBeNull();
  });

  it("prompts on return: away→active freezes the prior idle as awaySeconds", () => {
    const away = appReducer(initialState, {
      type: "SET_INACTIVITY",
      payload: { idleSeconds: 1230, isAway: true },
    });
    const returned = appReducer(away, {
      type: "SET_INACTIVITY",
      payload: { idleSeconds: 0, isAway: false },
    });
    expect(returned.inactivity.pendingReturn).toEqual({ awaySeconds: 1230 });
    expect(returned.inactivity.isAway).toBe(false);
  });

  it("does not prompt while still away (away→away)", () => {
    const away = appReducer(initialState, {
      type: "SET_INACTIVITY",
      payload: { idleSeconds: 600, isAway: true },
    });
    const stillAway = appReducer(away, {
      type: "SET_INACTIVITY",
      payload: { idleSeconds: 660, isAway: true },
    });
    expect(stillAway.inactivity.pendingReturn).toBeNull();
  });

  it("RESOLVE_RETURN clears a pending prompt (Discard/Keep both resolve)", () => {
    const away = appReducer(initialState, {
      type: "SET_INACTIVITY",
      payload: { idleSeconds: 1230, isAway: true },
    });
    const returned = appReducer(away, {
      type: "SET_INACTIVITY",
      payload: { idleSeconds: 0, isAway: false },
    });
    const resolved = appReducer(returned, { type: "RESOLVE_RETURN" });
    expect(resolved.inactivity.pendingReturn).toBeNull();
  });
});
