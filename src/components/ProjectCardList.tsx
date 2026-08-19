import { useMemo, useEffect, useState } from "react";
import { useApp } from "../store/context";
import { ProjectCard } from "./ProjectCard";
import { Collapsible } from "./Collapsible";
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

/** Chevron that points down when a group is open and right when it's folded. */
function GroupChevron({ folded }: { folded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 self-center transition-transform duration-200 motion-reduce:transition-none ${
        folded ? "-rotate-90" : ""
      }`}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function ProjectCardList() {
  const { state } = useApp();
  const { timer, displayPrefs } = state;
  const today = todayDate();
  const { listAutoCollapse, listGroupByWeek, listCollapsibleGroups, listStickyHeadings } =
    displayPrefs;

  // Week headings only pin in "both" mode, and only when they exist at all; the
  // day heading then pins directly below the week strip instead of at the top.
  const stickyWeek = listStickyHeadings === "both" && listGroupByWeek;
  const dayStickyClass =
    listStickyHeadings === "off" ? "" : stickyWeek ? "sticky top-[27px] z-10" : "sticky top-0 z-10";

  // Day and week groups the user has folded away. Keyed "day:<date>" /
  // "week:<monday>", and only reachable when collapsible groups are enabled.
  const [foldedGroups, setFoldedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setFoldedGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

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

  // Days grouped under their week. Without week grouping there is a single
  // section holding every day, so the render path stays the same either way.
  const sections = useMemo(() => {
    if (!listGroupByWeek) return [{ weekStart: null as string | null, days: groupedByDay }];
    const out: { weekStart: string | null; days: typeof groupedByDay }[] = [];
    for (const day of groupedByDay) {
      const weekStart = weekStartOf(day[0]);
      const last = out[out.length - 1];
      if (last && last.weekStart === weekStart) last.days.push(day);
      else out.push({ weekStart, days: [day] });
    }
    return out;
  }, [groupedByDay, listGroupByWeek]);

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
    <div className="flex-1 overflow-y-auto px-4 pb-[88px]">
      {sections.map(({ weekStart, days }, sectionIndex) => {
        const weekKey = weekStart ? `week:${weekStart}` : "";
        const weekFolded = listCollapsibleGroups && foldedGroups.has(weekKey);
        const weekTotal =
          weekStart === null
            ? 0
            : (weekMinutes.get(weekStart) ?? 0) +
              (weekStart === weekStartOf(today) ? runningMinutes : 0);

        const dayList = days.map(([date, entries], dayIndex) => {
          const isToday = date === today;
          const dayKey = `day:${date}`;
          const dayFolded = listCollapsibleGroups && foldedGroups.has(dayKey);
          const totalMinutes =
            entries.reduce((sum, e) => sum + e.minutes, 0) + (isToday ? runningMinutes : 0);
          const sorted = [...entries].sort((a, b) => b.startTime.localeCompare(a.startTime));

          const cards = (
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
          );

          return (
            <div key={date} className={dayIndex > 0 ? "mt-4" : ""}>
              {/* Day header — sticky, so the day you're scrolling through stays
                  labelled. Sits below the week heading when weeks are grouped.
                  Full-bleed (-mx-4) so nothing shows through in the gutters. */}
              <div
                className={`bg-bg flex items-baseline justify-between py-2 -mx-4 px-5 ${dayStickyClass}`}
              >
                {listCollapsibleGroups ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(dayKey)}
                    aria-expanded={!dayFolded}
                    className="flex items-baseline gap-1.5 font-bold text-[19px] text-text hover:text-primary transition-colors cursor-pointer"
                  >
                    <GroupChevron folded={dayFolded} />
                    <span>{formatDate(date)}</span>
                  </button>
                ) : (
                  <span className="font-bold text-[19px] text-text">{formatDate(date)}</span>
                )}
                <span className="font-bold text-[18px] text-text tabular-nums">
                  {formatMinutes(totalMinutes)}
                </span>
              </div>

              {/* Cards */}
              {listCollapsibleGroups ? (
                <Collapsible collapsed={dayFolded}>{cards}</Collapsible>
              ) : (
                cards
              )}
            </div>
          );
        });

        return (
          <div key={weekStart ?? "all"} className={sectionIndex > 0 ? "mt-5" : ""}>
            {/* Week heading */}
            {weekStart !== null && (
              <div
                className={`flex items-baseline justify-between bg-bg border-b border-border -mx-4 px-5 py-[6px] ${
                  stickyWeek ? "sticky top-0 z-20" : ""
                }`}
              >
                {listCollapsibleGroups ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(weekKey)}
                    aria-expanded={!weekFolded}
                    className="flex items-baseline gap-1 text-[11px] font-bold uppercase tracking-[0.07em] text-text-muted hover:text-primary transition-colors cursor-pointer"
                  >
                    <GroupChevron folded={weekFolded} />
                    <span>{formatWeekHeading(weekStart, today)}</span>
                  </button>
                ) : (
                  <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-text-muted">
                    {formatWeekHeading(weekStart, today)}
                  </span>
                )}
                <span className="text-[11px] font-semibold tabular-nums text-text-muted">
                  {formatMinutes(weekTotal)}
                </span>
              </div>
            )}

            {listCollapsibleGroups && weekStart !== null ? (
              <Collapsible collapsed={weekFolded}>{dayList}</Collapsible>
            ) : (
              dayList
            )}
          </div>
        );
      })}
    </div>
  );
}
