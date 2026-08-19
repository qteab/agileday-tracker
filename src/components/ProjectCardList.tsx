import { useMemo, useEffect, useState } from "react";
import { useApp } from "../store/context";
import { ProjectCard } from "./ProjectCard";
import { formatMinutes } from "../hooks/useTimer";
import { shouldAutoCollapse, weekStartOf, formatWeekHeading } from "../utils/entry-list";
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
  const { timer, displayPrefs } = state;
  const today = todayDate();
  const { listAutoCollapse, listGroupByWeek } = displayPrefs;

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

  // Minutes per week (excluding the running timer, added in below) so week
  // headings can show a total the same way day headings do.
  const weekMinutes = useMemo(() => {
    const totals = new Map<string, number>();
    if (!listGroupByWeek) return totals;
    for (const [date, entries] of groupedByDay) {
      const key = weekStartOf(date);
      const sum = entries.reduce((acc, e) => acc + e.minutes, 0);
      totals.set(key, (totals.get(key) ?? 0) + sum);
    }
    return totals;
  }, [groupedByDay, listGroupByWeek]);

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

  // Minutes elapsed on the running timer — counted into today's total and,
  // when weeks are grouped, into the current week's total.
  const runningMinutes = timerOnToday
    ? Math.max(1, Math.round((Date.now() - new Date(timer.startTime!).getTime()) / 60000))
    : 0;

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
      {groupedByDay.map(([date, entries], dayIndex) => {
        const isToday = date === today;
        const weekStart = weekStartOf(date);
        // Days are ordered newest first, so a week heading belongs above the
        // first day whose week differs from the day before it.
        const startsWeek =
          listGroupByWeek &&
          (dayIndex === 0 || weekStartOf(groupedByDay[dayIndex - 1][0]) !== weekStart);

        // Calculate day total including running timer
        const totalMinutes =
          entries.reduce((sum, e) => sum + e.minutes, 0) + (isToday ? runningMinutes : 0);
        const sorted = [...entries].sort((a, b) => b.startTime.localeCompare(a.startTime));

        return (
          <div key={date}>
            {/* Week heading */}
            {startsWeek && (
              <div className="flex items-baseline justify-between pt-[18px] pb-1 px-1 border-b border-border mb-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-text-muted">
                  {formatWeekHeading(weekStart, today)}
                </span>
                <span className="text-[11px] font-semibold tabular-nums text-text-muted">
                  {formatMinutes(
                    (weekMinutes.get(weekStart) ?? 0) +
                      (weekStart === weekStartOf(today) ? runningMinutes : 0)
                  )}
                </span>
              </div>
            )}

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
                <ProjectCard
                  key={entry.id}
                  entry={entry}
                  isToday={isToday}
                  autoCollapsed={shouldAutoCollapse(listAutoCollapse, date, today)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
