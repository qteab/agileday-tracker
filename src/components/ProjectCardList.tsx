import { useMemo, useEffect, useState } from "react";
import { useApp } from "../store/context";
import { ProjectCard } from "./ProjectCard";
import { formatMinutes } from "../hooks/useTimer";
import type { TimeEntry } from "../api/types";

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

function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function ProjectCardList() {
  const { state } = useApp();
  const { timer } = state;
  const today = todayDate();

  const groupedByDay = useMemo(() => {
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
  }, [state.entries, today]);

  // Tick every second while timer is running so day totals stay current
  const timerOnToday =
    timer.isRunning && timer.startTime !== null && localDate(timer.startTime) === today;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timerOnToday) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timerOnToday]);

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
        <span className="text-xs">Tap + to start tracking</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-2 pb-[88px]">
      {groupedByDay.map(([date, entries]) => {
        const isToday = date === today;

        // Calculate day total including running timer
        const runningMinutes =
          isToday && timerOnToday
            ? Math.max(1, Math.round((Date.now() - new Date(timer.startTime!).getTime()) / 60000))
            : 0;
        const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0) + runningMinutes;
        const sorted = [...entries].sort((a, b) => b.startTime.localeCompare(a.startTime));

        return (
          <div key={date}>
            {/* Day header */}
            <div className="flex items-baseline justify-between py-[10px] pt-[18px] px-1">
              <span className="font-bold text-[19px] text-text">{formatDate(date)}</span>
              <span className="font-bold text-[18px] text-text tabular-nums">
                {formatMinutes(totalMinutes)}
              </span>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-3">
              {sorted.map((entry) => (
                <ProjectCard key={entry.id} entry={entry} isToday={isToday} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
