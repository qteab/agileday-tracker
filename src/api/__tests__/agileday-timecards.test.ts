import { describe, it, expect, vi } from "vitest";

import { createAutoSubmitBracket, distinctWeeks, type TimecardApi } from "../agileday-timecards";

describe("distinctWeeks", () => {
  it("returns nothing for no usable dates", () => {
    expect(distinctWeeks([])).toEqual([]);
    expect(distinctWeeks([undefined, undefined])).toEqual([]);
  });

  it("collapses several dates in one week to a single week", () => {
    expect(distinctWeeks(["2026-11-23", "2026-11-25", "2026-11-27"])).toEqual([
      { weekStart: "2026-11-23", month: "2026-11-01" },
    ]);
  });

  it("keeps separate weeks apart", () => {
    expect(distinctWeeks(["2026-11-23", "2026-11-30"])).toEqual([
      { weekStart: "2026-11-23", month: "2026-11-01" },
      { weekStart: "2026-11-30", month: "2026-11-01" },
    ]);
  });

  it("splits one calendar week across a month boundary into two timecards", () => {
    // AgileDay keeps one timecard per week per month, so these two days sit in
    // the same week but on different cards.
    expect(distinctWeeks(["2025-12-30", "2026-01-01"])).toEqual([
      { weekStart: "2025-12-29", month: "2025-12-01" },
      { weekStart: "2025-12-29", month: "2026-01-01" },
    ]);
  });

  it("skips gaps in the date list", () => {
    expect(distinctWeeks([undefined, "2026-11-23", undefined])).toEqual([
      { weekStart: "2026-11-23", month: "2026-11-01" },
    ]);
  });
});

function fakeTimecards(options: { approved?: boolean; statusFails?: boolean } = {}) {
  const setTimesheetStatus = vi.fn<TimecardApi["setTimesheetStatus"]>();
  if (options.statusFails) {
    setTimesheetStatus.mockRejectedValue(new Error("no timecard"));
  } else {
    setTimesheetStatus.mockResolvedValue(undefined);
  }

  const weekHasApprovedEntry = vi
    .fn<TimecardApi["weekHasApprovedEntry"]>()
    .mockResolvedValue(options.approved ?? false);

  const api: TimecardApi = { setTimesheetStatus, weekHasApprovedEntry };
  return { api, setTimesheetStatus, weekHasApprovedEntry };
}

const wrote = () => Promise.resolve("written");

describe("createAutoSubmitBracket", () => {
  it("runs the write untouched when the setting is off", async () => {
    const { api, setTimesheetStatus } = fakeTimecards();
    const bracket = createAutoSubmitBracket(api, () => false);

    await expect(bracket("emp-1", ["2026-11-23"], wrote)).resolves.toBe("written");
    expect(setTimesheetStatus).not.toHaveBeenCalled();
  });

  it("unsubmits before the write and resubmits after", async () => {
    const { api, setTimesheetStatus } = fakeTimecards();
    const order: string[] = [];
    setTimesheetStatus.mockImplementation((_employee, _week, _month, status) => {
      order.push(status);
      return Promise.resolve();
    });

    await createAutoSubmitBracket(api, () => true)("emp-1", ["2026-11-23"], () => {
      order.push("write");
      return Promise.resolve();
    });

    expect(order).toEqual(["SAVED", "write", "SUBMITTED"]);
  });

  it("resubmits even when the write throws", async () => {
    const { api, setTimesheetStatus } = fakeTimecards();
    const bracket = createAutoSubmitBracket(api, () => true);

    await expect(
      bracket("emp-1", ["2026-11-23"], () => Promise.reject(new Error("save failed")))
    ).rejects.toThrow(/save failed/);

    expect(setTimesheetStatus).toHaveBeenCalledTimes(2);
    expect(setTimesheetStatus).toHaveBeenLastCalledWith(
      "emp-1",
      "2026-11-23",
      "2026-11-01",
      "SUBMITTED"
    );
  });

  it("leaves a week holding an approved entry alone", async () => {
    const { api, setTimesheetStatus } = fakeTimecards({ approved: true });
    const bracket = createAutoSubmitBracket(api, () => true);

    await expect(bracket("emp-1", ["2026-11-23"], wrote)).resolves.toBe("written");
    expect(setTimesheetStatus).not.toHaveBeenCalled();
  });

  it("still writes when the status change is refused", async () => {
    const { api } = fakeTimecards({ statusFails: true });
    const bracket = createAutoSubmitBracket(api, () => true);

    await expect(bracket("emp-1", ["2026-11-23"], wrote)).resolves.toBe("written");
  });

  it("brackets every week a batch touches", async () => {
    const { api, setTimesheetStatus } = fakeTimecards();
    const bracket = createAutoSubmitBracket(api, () => true);

    await bracket("emp-1", ["2026-11-23", "2026-11-30"], () => Promise.resolve());

    // Two weeks, each unsubmitted and resubmitted.
    expect(setTimesheetStatus).toHaveBeenCalledTimes(4);
  });

  it("skips the bracket when no employee id is available", async () => {
    const { api, weekHasApprovedEntry } = fakeTimecards();
    const bracket = createAutoSubmitBracket(api, () => true);

    await expect(bracket(null, ["2026-11-23"], wrote)).resolves.toBe("written");
    expect(weekHasApprovedEntry).not.toHaveBeenCalled();
  });

  it("skips the bracket when no date resolves to a week", async () => {
    const { api, setTimesheetStatus } = fakeTimecards();
    const bracket = createAutoSubmitBracket(api, () => true);

    await expect(bracket("emp-1", [undefined], wrote)).resolves.toBe("written");
    expect(setTimesheetStatus).not.toHaveBeenCalled();
  });
});
