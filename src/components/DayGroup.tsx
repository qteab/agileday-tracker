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
  /** The representative entry (most recent) */
  entry: TimeEntryType;
  /** All individual sessions in this group */
  sessions: TimeEntryType[];
  /** Total minutes across all sessions */
  totalMinutes: number;
  /** Number of sessions with same description+project */
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
}: {
  group: GroupedEntry;
  onContinue: (entry: TimeEntryType) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      {/* Main grouped row */}
      <div className="flex items-center">
        {/* Counter on the far left — clickable to expand */}
        {group.count > 1 ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className={`w-10 shrink-0 flex items-center justify-center self-stretch transition-colors ${
              expanded
                ? "bg-primary/10 text-primary"
                : "hover:bg-white/50 text-text-muted"
            }`}
            title={`${group.count} sessions — click to expand`}
          >
            <span className="w-6 h-6 rounded border border-current text-xs flex items-center justify-center">
              {group.count}
            </span>
          </button>
        ) : (
          <div className="w-10 shrink-0" />
        )}

        {/* Entry content */}
        <div className="flex-1 min-w-0">
          <TimeEntry
            entry={group.entry}
            onContinue={onContinue}
          />
        </div>
      </div>

      {/* Expanded individual sessions */}
      {expanded && (
        <div className="bg-white/20 border-l-2 border-primary/30 ml-5">
          {group.sessions.map((session) => (
            <div key={session.id} className="flex items-center">
              <div className="w-5 shrink-0" />
              <div className="flex-1 min-w-0">
                <TimeEntry
                  entry={session}
                  onContinue={onContinue}
                />
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
    <div>
      {/* Day header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/30">
        <span className="text-sm font-semibold text-text">
          {formatDate(date)}
        </span>
        <span className="text-sm font-semibold text-text tabular-nums">
          {formatMinutes(totalMinutes)}
        </span>
      </div>

      {/* Entries */}
      <div>
        {grouped.map((g) => (
          <GroupedEntryRow
            key={g.entry.id}
            group={g}
            onContinue={onContinue}
          />
        ))}
      </div>
    </div>
  );
}
