import { useMemo } from "react";
import { useApp } from "../store/context";
import { useNow } from "./useNow";
import { calculateVacation, type VacationResult } from "../utils/vacation";

/**
 * Vacation day balance from entries on the configured vacation project.
 * Null until vacation tracking is configured.
 */
export function useVacation(): VacationResult | null {
  const { state } = useApp();
  const { vacationConfig, entries, flexEntries } = state;
  const now = useNow();

  const allEntries = useMemo(
    () => (flexEntries ? [...entries, ...flexEntries] : entries),
    [entries, flexEntries]
  );

  return useMemo(() => {
    if (!vacationConfig) return null;
    return calculateVacation(
      allEntries,
      vacationConfig.startDate,
      vacationConfig.initialDays,
      vacationConfig.projectId,
      now
    );
  }, [vacationConfig, allEntries, now]);
}
