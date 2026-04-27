import { useState, useEffect, useMemo } from "react";
import { useApp } from "../store/context";
import type { Allocation } from "../api/types";

type Period = "week" | "month";

function getWeekRange(ref: Date): { start: string; end: string; label: string } {
  const day = ref.getDay();
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split("T")[0],
    end: sunday.toISOString().split("T")[0],
    label: `Week of ${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
  };
}

function getMonthRange(ref: Date): { start: string; end: string; label: string } {
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return {
    start: first.toISOString().split("T")[0],
    end: last.toISOString().split("T")[0],
    label: ref.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  };
}

function countWeekdays(startDate: string, endDate: string): number {
  let count = 0;
  const current = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/** Get the portion of an allocation that falls within a date range */
function getAllocatedInRange(alloc: Allocation, rangeStart: string, rangeEnd: string): number {
  const overlapStart = alloc.startDate > rangeStart ? alloc.startDate : rangeStart;
  const overlapEnd = alloc.endDate < rangeEnd ? alloc.endDate : rangeEnd;
  if (overlapStart > overlapEnd) return 0;

  const totalWeekdays = countWeekdays(alloc.startDate, alloc.endDate);
  if (totalWeekdays === 0) return 0;

  const overlapWeekdays = countWeekdays(overlapStart, overlapEnd);
  return Math.round((overlapWeekdays / totalWeekdays) * alloc.allocatedMinutes);
}

function getWeekDays(ref: Date): { date: string; label: string }[] {
  const day = ref.getDay();
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      date: d.toISOString().split("T")[0],
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
    };
  });
}

function getMonthWeeks(ref: Date): { startDate: string; endDate: string; label: string }[] {
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const lastDay = new Date(year, month + 1, 0);
  const weeks: { startDate: string; endDate: string; label: string }[] = [];

  const current = new Date(year, month, 1);
  let weekNum = 1;
  while (current <= lastDay) {
    const weekStart = new Date(current);
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (weekEnd > lastDay) weekEnd.setTime(lastDay.getTime());
    weeks.push({
      startDate: weekStart.toISOString().split("T")[0],
      endDate: weekEnd.toISOString().split("T")[0],
      label: `W${weekNum}`,
    });
    current.setDate(current.getDate() + 7);
    weekNum++;
  }
  return weeks;
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface BarData {
  label: string;
  allocated: number;
  tracked: number;
}

function Bar({ data, maxMinutes }: { data: BarData; maxMinutes: number }) {
  const allocatedPct = maxMinutes > 0 ? (data.allocated / maxMinutes) * 100 : 0;
  const trackedPct = maxMinutes > 0 ? (data.tracked / maxMinutes) * 100 : 0;
  const overAllocated = data.tracked > data.allocated && data.allocated > 0;

  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <div className="flex items-end gap-0.5 h-32 w-full justify-center">
        <div className="relative w-5 bg-bg rounded-t" style={{ height: "100%" }}>
          <div
            className="absolute bottom-0 left-0 right-0 bg-primary/20 rounded-t transition-all"
            style={{ height: `${allocatedPct}%` }}
          />
        </div>
        <div className="relative w-5 bg-bg rounded-t" style={{ height: "100%" }}>
          <div
            className={`absolute bottom-0 left-0 right-0 rounded-t transition-all ${
              overAllocated ? "bg-danger/70" : "bg-primary"
            }`}
            style={{ height: `${Math.min(trackedPct, 100)}%` }}
          />
        </div>
      </div>
      <span className="text-[10px] text-text-muted">{data.label}</span>
    </div>
  );
}

export function AllocationView() {
  const { state, api } = useApp();
  const [period, setPeriod] = useState<Period>("week");
  const [allocations, setAllocations] = useState<Allocation[]>([]);

  useEffect(() => {
    if (state.employee) {
      api.getAllocations(state.employee.id).then(setAllocations);
    }
  }, [state.employee, api]);

  const now = new Date();
  const range = period === "week" ? getWeekRange(now) : getMonthRange(now);

  const barData: BarData[] = useMemo(() => {
    if (period === "week") {
      const days = getWeekDays(now);
      return days.map((day) => ({
        label: day.label,
        allocated: allocations.reduce((s, a) => s + getAllocatedInRange(a, day.date, day.date), 0),
        tracked: state.entries
          .filter((e) => e.date === day.date)
          .reduce((s, e) => s + e.minutes, 0),
      }));
    } else {
      const weeks = getMonthWeeks(now);
      return weeks.map((week) => ({
        label: week.label,
        allocated: allocations.reduce(
          (s, a) => s + getAllocatedInRange(a, week.startDate, week.endDate),
          0
        ),
        tracked: state.entries
          .filter((e) => e.date >= week.startDate && e.date <= week.endDate)
          .reduce((s, e) => s + e.minutes, 0),
      }));
    }
  }, [period, allocations, state.entries]);

  const totalAllocated = allocations.reduce(
    (s, a) => s + getAllocatedInRange(a, range.start, range.end),
    0
  );
  const totalTracked = state.entries
    .filter((e) => e.date >= range.start && e.date <= range.end)
    .reduce((s, e) => s + e.minutes, 0);
  const maxMinutes = Math.max(...barData.map((d) => Math.max(d.allocated, d.tracked)), 1);

  return (
    <div className="flex-1 overflow-y-auto pt-2 pb-4">
      <div className="mx-2">
        {/* Period header */}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-semibold text-text">{range.label}</span>
          <div className="flex bg-bg rounded-md p-0.5">
            <button
              onClick={() => setPeriod("week")}
              className={`px-2.5 py-1 text-[10px] font-medium rounded transition-all ${
                period === "week" ? "bg-bg-card text-text shadow-sm" : "text-text-muted"
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setPeriod("month")}
              className={`px-2.5 py-1 text-[10px] font-medium rounded transition-all ${
                period === "month" ? "bg-bg-card text-text shadow-sm" : "text-text-muted"
              }`}
            >
              Month
            </button>
          </div>
        </div>

        {/* Summary card */}
        <div className="bg-bg-card rounded-xl shadow-sm p-4 mb-3">
          <div className="flex justify-between mb-4">
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wide">Allocated</p>
              <p className="text-lg font-semibold text-text">{formatHours(totalAllocated)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-text-muted uppercase tracking-wide">Tracked</p>
              <p
                className={`text-lg font-semibold ${
                  totalTracked > totalAllocated && totalAllocated > 0
                    ? "text-danger"
                    : "text-primary"
                }`}
              >
                {formatHours(totalTracked)}
              </p>
            </div>
          </div>

          {/* Chart */}
          <div className="flex items-end gap-1">
            {barData.map((d) => (
              <Bar key={d.label} data={d} maxMinutes={maxMinutes} />
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-divider">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-primary/20" />
              <span className="text-[10px] text-text-muted">Allocated</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-primary" />
              <span className="text-[10px] text-text-muted">Tracked</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-danger/70" />
              <span className="text-[10px] text-text-muted">Over</span>
            </div>
          </div>
        </div>

        {/* Per-project breakdown */}
        <div className="px-3 py-2">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            By Project
          </span>
        </div>
        <div className="bg-bg-card rounded-xl shadow-sm overflow-hidden">
          {allocations.map((alloc, i) => {
            const allocInRange = getAllocatedInRange(alloc, range.start, range.end);
            const tracked = state.entries
              .filter(
                (e) =>
                  e.projectId === alloc.projectId && e.date >= range.start && e.date <= range.end
              )
              .reduce((s, e) => s + e.minutes, 0);
            const project = state.projects.find((p) => p.id === alloc.projectId);
            const pct = allocInRange > 0 ? Math.min((tracked / allocInRange) * 100, 100) : 0;

            return (
              <div
                key={alloc.projectId}
                className={`px-4 py-3 ${i < allocations.length - 1 ? "border-b border-divider" : ""}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: project?.color ?? "#999" }}
                    />
                    <span className="text-sm text-text">{alloc.projectName}</span>
                  </div>
                  <span className="text-xs text-text-muted tabular-nums">
                    {formatHours(tracked)} / {formatHours(allocInRange)}
                  </span>
                </div>
                <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      tracked > allocInRange ? "bg-danger/70" : "bg-primary"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
