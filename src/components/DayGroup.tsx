import { useEffect, useState } from "react";
import { TimeEntry } from "./TimeEntry";
import { formatMinutes } from "../hooks/useTimer";
import { useApp } from "../store/context";
import type { TimeEntry as TimeEntryType } from "../api/types";

interface DayGroupProps {
  date: string;
  entries: TimeEntryType[];
  onContinue: (entry: TimeEntryType) => void;
  onStop: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split("T")[0];

  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DayGroup({ date, entries, onContinue, onStop }: DayGroupProps) {
  const { state } = useApp();
  const { timer } = state;
  const timerOnThisDay =
    timer.isRunning && timer.startTime !== null && localDate(timer.startTime) === date;

  // Re-render every second while a timer is ticking for this day so the
  // header total stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timerOnThisDay) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timerOnThisDay]);

  const runningMinutes = timerOnThisDay
    ? Math.max(1, Math.round((Date.now() - new Date(timer.startTime!).getTime()) / 60000))
    : 0;
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0) + runningMinutes;
  const sorted = [...entries].sort((a, b) => b.startTime.localeCompare(a.startTime));

  return (
    <div className="mb-3">
      {/* Day header */}
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-sm font-semibold text-text">{formatDate(date)}</span>
        <span className="text-sm font-semibold text-text tabular-nums">
          {formatMinutes(totalMinutes)}
        </span>
      </div>

      {/* White card with entries */}
      <div className="mx-2 bg-bg-card rounded-xl shadow-sm overflow-hidden">
        {sorted.map((entry, i) => (
          <div key={entry.id} className={i < sorted.length - 1 ? "border-b border-divider" : ""}>
            <TimeEntry entry={entry} onContinue={onContinue} onStop={onStop} />
          </div>
        ))}
      </div>
    </div>
  );
}
