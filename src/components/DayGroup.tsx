import { useState } from "react";
import { TimeEntry } from "./TimeEntry";
import { formatMinutes } from "../hooks/useTimer";
import type { TimeEntry as TimeEntryType } from "../api/types";

interface DayGroupProps {
  date: string;
  entries: TimeEntryType[];
  onContinue: (entry: TimeEntryType) => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now.getTime() - 86400000)
    .toISOString()
    .split("T")[0];

  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

interface GroupedEntry {
  entry: TimeEntryType;
  sessions: TimeEntryType[];
  totalMinutes: number;
  count: number;
}

function groupEntries(entries: TimeEntryType[]): GroupedEntry[] {
  const groups = new Map<string, TimeEntryType[]>();
  for (const entry of entries) {
    const key = `${entry.description}::${entry.projectId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  return [...groups.values()]
    .map((group) => {
      group.sort((a, b) => b.startTime.localeCompare(a.startTime));
      const totalMinutes = group.reduce((sum, e) => sum + e.minutes, 0);
      return {
        entry: { ...group[0], minutes: totalMinutes },
        sessions: group,
        totalMinutes,
        count: group.length,
      };
    })
    .sort((a, b) => b.entry.startTime.localeCompare(a.entry.startTime));
}

function GroupedEntryRow({
  group,
  onContinue,
  isLast,
}: {
  group: GroupedEntry;
  onContinue: (entry: TimeEntryType) => void;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      {/* Main grouped row */}
      <div className={`flex items-center ${!isLast && !expanded ? "border-b border-divider" : ""}`}>
        {/* Counter on the far left */}
        {group.count > 1 ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className={`w-10 shrink-0 flex items-center justify-center self-stretch transition-colors ${
              expanded
                ? "text-primary"
                : "text-text-muted hover:text-primary"
            }`}
            title={`${group.count} sessions`}
          >
            <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center border ${
              expanded ? "border-primary bg-primary/10" : "border-text-muted/30"
            }`}>
              {group.count}
            </span>
          </button>
        ) : (
          <div className="w-10 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <TimeEntry entry={group.entry} onContinue={onContinue} />
        </div>
      </div>

      {/* Expanded individual sessions */}
      {expanded && (
        <div className={`bg-bg/50 ${!isLast ? "border-b border-divider" : ""}`}>
          {group.sessions.map((session, i) => (
            <div
              key={session.id}
              className={`flex items-center ${
                i < group.sessions.length - 1 ? "border-b border-divider" : ""
              }`}
            >
              <div className="w-10 shrink-0 flex items-center justify-center self-stretch">
                <div className="w-px h-full bg-primary/20" />
              </div>
              <div className="flex-1 min-w-0">
                <TimeEntry entry={session} onContinue={onContinue} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DayGroup({ date, entries, onContinue }: DayGroupProps) {
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const grouped = groupEntries(entries);

  return (
    <div className="mb-3">
      {/* Day header */}
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-sm font-semibold text-text">
          {formatDate(date)}
        </span>
        <span className="text-sm font-semibold text-text tabular-nums">
          {formatMinutes(totalMinutes)}
        </span>
      </div>

      {/* White card with entries */}
      <div className="mx-2 bg-bg-card rounded-xl shadow-sm overflow-hidden">
        {grouped.map((g, i) => (
          <GroupedEntryRow
            key={g.entry.id}
            group={g}
            onContinue={onContinue}
            isLast={i === grouped.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
