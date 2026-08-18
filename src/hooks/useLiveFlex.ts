import { useMemo } from "react";
import { useApp } from "../store/context";
import { useNow } from "./useNow";
import {
  calculateLastMonthSummary,
  calculateLiveFlex,
  calculateMonthStats,
  type LiveFlexResult,
  type MonthStats,
  type MonthSummary,
} from "../utils/flex";

export interface LiveFlex {
  /** Null until flex is configured. */
  flex: LiveFlexResult | null;
  month: MonthStats;
  /** Null until a full month lies inside the flex period. */
  lastMonth: MonthSummary | null;
  now: Date;
}

/**
 * Live flex balance and month stats, re-rendering once a minute so today's
 * hours — including a running timer — are always reflected.
 */
export function useLiveFlex(): LiveFlex {
  const { state } = useApp();
  const { flexConfig, entries, flexEntries, holidays, timer } = state;
  const now = useNow();

  // Elapsed minutes of the running timer, not yet saved as an entry
  const runningMinutes =
    timer.isRunning && timer.startTime
      ? Math.max(0, Math.floor((now.getTime() - new Date(timer.startTime).getTime()) / 60_000))
      : 0;

  const allEntries = useMemo(
    () => (flexEntries ? [...entries, ...flexEntries] : entries),
    [entries, flexEntries]
  );

  const flex = useMemo(() => {
    if (!flexConfig) return null;
    return calculateLiveFlex(
      allEntries,
      flexConfig.startDate,
      flexConfig.initialHours,
      holidays,
      now,
      runningMinutes
    );
  }, [flexConfig, allEntries, holidays, now, runningMinutes]);

  const month = useMemo(
    () => calculateMonthStats(allEntries, holidays, now, runningMinutes),
    [allEntries, holidays, now, runningMinutes]
  );

  const lastMonth = useMemo(() => {
    if (!flexConfig) return null;
    return calculateLastMonthSummary(
      allEntries,
      flexConfig.startDate,
      flexConfig.initialHours,
      holidays,
      now
    );
  }, [flexConfig, allEntries, holidays, now]);

  return { flex, month, lastMonth, now };
}
