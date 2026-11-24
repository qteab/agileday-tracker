/**
 * Weekly timecards, and the auto-submit bracket built on them.
 *
 * A timecard is AgileDay's per-week container for time entries. Its status is a
 * workflow state, and moving it cascades onto every entry in that week — which
 * is what makes auto-submit possible and what makes it something to be careful
 * with.
 */

import { posthogLogger } from "../posthog";
import { addDays } from "../utils/date-range";
import { getTimesheetPeriod } from "../utils/week";
import type { ApiFetch } from "./agileday-http";

/** The two timecard statuses this app sets. */
export type TimecardStatus = "SUBMITTED" | "SAVED";

interface Timecard {
  id: string;
  employeeId: string;
  week: string;
  month: string;
  status: string;
}

export interface Week {
  weekStart: string;
  month: string;
}

export interface TimecardApi {
  /** Move one week's timecard to a status, or do nothing if it is already there. */
  setTimesheetStatus(
    employeeId: string,
    weekStart: string,
    month: string,
    status: TimecardStatus
  ): Promise<void>;
  /** Whether a manager has approved any entry in the week. Rejects if the week can't be read. */
  weekHasApprovedEntry(employeeId: string, weekStart: string): Promise<boolean>;
}

export function createTimecardApi(apiFetch: ApiFetch): TimecardApi {
  async function findTimecard(
    employeeId: string,
    weekStart: string,
    month: string
  ): Promise<Timecard> {
    const { timecards } = await apiFetch<{ timecards: Timecard[] }>(
      `/v1/timesheets/by-employee/month/${month}`,
      {
        method: "POST",
        body: JSON.stringify({ text: "", filter: { id: { in: [employeeId] } } }),
      }
    );

    const card = timecards.find(
      (t) =>
        t.employeeId === employeeId &&
        t.week.slice(0, 10) === weekStart &&
        t.month.slice(0, 10) === month
    );
    if (!card) throw new Error(`No AgileDay timesheet found for week of ${weekStart}`);
    return card;
  }

  return {
    async setTimesheetStatus(employeeId, weekStart, month, status) {
      const card = await findTimecard(employeeId, weekStart, month);
      if (card.status === status) return;
      await apiFetch(`/v1/time_entry/employee/id/${employeeId}/time_card/id/${card.id}`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },

    async weekHasApprovedEntry(employeeId, weekStart) {
      type RawStatus = { status?: string };
      const entries = await apiFetch<RawStatus[]>(
        `/v1/time_entry/employee/id/${employeeId}?startDate=${weekStart}&endDate=${addDays(weekStart, 7)}`
      );
      return entries.some((e) => e.status === "APPROVED");
    },
  };
}

/** The distinct weeks a set of entry dates falls in. Dates may be sparse. */
export function distinctWeeks(dates: Array<string | undefined>): Week[] {
  const byKey = new Map<string, Week>();
  for (const date of dates) {
    if (!date) continue;
    const { weekStart, month } = getTimesheetPeriod(date);
    byKey.set(`${weekStart}|${month}`, { weekStart, month });
  }
  return [...byKey.values()];
}

/** Fails closed: a week we can't read might hold an approved entry, so it is not moved. */
async function isMovable(timecards: TimecardApi, employeeId: string, week: Week): Promise<boolean> {
  try {
    return !(await timecards.weekHasApprovedEntry(employeeId, week.weekStart));
  } catch {
    posthogLogger?.warn("agileday_auto_submit_approved_check_failed");
    return false;
  }
}

/** Runs a write with each affected week unsubmitted around it. */
export type AutoSubmitBracket = <T>(
  employeeId: string | null,
  dates: Array<string | undefined>,
  write: () => Promise<T>
) => Promise<T>;

/**
 * Wrap writes so that, while the setting is on, the week they touch ends up
 * submitted: unsubmit each affected week so the write sees editable entries,
 * run the write untouched, then submit each week again.
 *
 * Two rules keep this from costing the user anything. Status changes are
 * best-effort — a week with no timecard, or one the API refuses to move, must
 * never cost a time entry. And a week holding an APPROVED entry is left alone
 * entirely, because the cascade would revert a manager's decision; so is a
 * week whose entries can't be read to check.
 */
export function createAutoSubmitBracket(
  timecards: TimecardApi,
  isEnabled: () => boolean
): AutoSubmitBracket {
  return async function withAutoSubmit<T>(
    employeeId: string | null,
    dates: Array<string | undefined>,
    write: () => Promise<T>
  ): Promise<T> {
    if (!isEnabled() || !employeeId) return write();

    const weeks = distinctWeeks(dates);
    if (weeks.length === 0) return write();

    const movable: Week[] = [];
    for (const week of weeks) {
      if (await isMovable(timecards, employeeId, week)) movable.push(week);
    }
    if (movable.length === 0) return write();

    const moveAll = async (status: TimecardStatus): Promise<void> => {
      for (const { weekStart, month } of movable) {
        try {
          await timecards.setTimesheetStatus(employeeId, weekStart, month, status);
        } catch {
          posthogLogger?.warn("agileday_auto_submit_status_failed", { target_status: status });
        }
      }
    };

    await moveAll("SAVED");
    try {
      return await write();
    } finally {
      // Resubmit even when the write threw, so a failed save never leaves the
      // week sitting unsubmitted with nothing to tell the user.
      await moveAll("SUBMITTED");
    }
  };
}
