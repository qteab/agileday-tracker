import { useMemo } from "react";
import { useApp } from "../store/context";
import { DayGroup } from "./DayGroup";
import type { TimeEntry } from "../api/types";

export function TimeEntryList() {
  const { state } = useApp();

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, TimeEntry[]>();
    for (const entry of state.entries) {
      const existing = groups.get(entry.date);
      if (existing) {
        existing.push(entry);
      } else {
        groups.set(entry.date, [entry]);
      }
    }
    // Sort days descending (newest first)
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [state.entries]);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
        Loading...
      </div>
    );
  }

  if (groupedByDay.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted text-sm gap-1">
        <span>No time entries yet</span>
        <span className="text-xs">Start a timer to begin tracking</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {groupedByDay.map(([date, entries]) => (
        <DayGroup key={date} date={date} entries={entries} />
      ))}
    </div>
  );
}
