import { useState } from "react";
import { TimeEntry } from "./TimeEntry";
import { formatMinutes } from "../hooks/useTimer";
import type { TimeEntry as TimeEntryType } from "../api/types";

interface DayGroupProps {
  date: string; // YYYY-MM-DD
  entries: TimeEntryType[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00"); // avoid timezone issues
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

export function DayGroup({ date, entries }: DayGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const hasUnsaved = entries.some((e) => e.syncStatus === "unsaved");

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-3 h-3 text-text-muted transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M9 5l7 7-7 7z" />
          </svg>
          <span className="text-sm font-medium text-text">
            {formatDate(date)}
          </span>
          {hasUnsaved && (
            <span className="w-1.5 h-1.5 rounded-full bg-danger" title="Has unsaved entries" />
          )}
          <span className="text-xs text-text-muted">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        <span className="text-sm font-medium text-text tabular-nums">
          {formatMinutes(totalMinutes)}
        </span>
      </button>

      {expanded && (
        <div className="bg-white/30">
          {entries
            .sort((a, b) => b.startTime.localeCompare(a.startTime))
            .map((entry) => (
              <TimeEntry key={entry.id} entry={entry} />
            ))}
        </div>
      )}
    </div>
  );
}
