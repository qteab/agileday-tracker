import { useMemo } from "react";
import { useApp } from "../store/context";
import { DayGroup } from "./DayGroup";
import type { TimeEntry } from "../api/types";

interface TimeEntryListProps {
  onContinue: (entry: TimeEntry) => void;
  onStop: () => void;
}

export function TimeEntryList({ onContinue, onStop }: TimeEntryListProps) {
  const { state } = useApp();

  const groupedByDay = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const groups = new Map<string, TimeEntry[]>();
    for (const entry of state.entries) {
      if (entry.date > today) continue;
      const existing = groups.get(entry.date);
      if (existing) {
        existing.push(entry);
      } else {
        groups.set(entry.date, [entry]);
      }
    }
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
    <div className="flex-1 overflow-y-auto pt-2 pb-4">
      {groupedByDay.map(([date, entries]) => (
        <DayGroup key={date} date={date} entries={entries} onContinue={onContinue} onStop={onStop} />
      ))}
    </div>
  );
}
