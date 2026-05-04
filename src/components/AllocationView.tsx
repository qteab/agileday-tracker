import { useState, useEffect, useMemo, useRef } from "react";
import { useApp, useApi } from "../store/context";
import type { Allocation } from "../api/types";

type Period = "week" | "month";

const WORKDAY_MINUTES = 480; // 8 hours
const ALLOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

function isWeekday(dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function getWeekDays(ref: Date): string[] {
  const day = ref.getDay();
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split("T")[0];
  });
}

/** Get the allocation percentage for a specific date from an allocation's periods */
function getAllocPercentageOnDate(alloc: Allocation, dateStr: string): number {
  if (dateStr < alloc.startDate || dateStr > alloc.endDate) return 0;
  if (!isWeekday(dateStr)) return 0;

  // Find the applicable period (last period with startDate <= dateStr)
  let pct = 0;
  for (const p of alloc.periods.sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    if (p.startDate <= dateStr) {
      pct = p.percentage;
    }
  }
  return pct;
}

/** Get allocated minutes for a date range across all allocations */
function getAllocatedMinutesForDay(allocations: Allocation[], dateStr: string): number {
  let total = 0;
  for (const alloc of allocations) {
    const pct = getAllocPercentageOnDate(alloc, dateStr);
    total += Math.round((pct / 100) * WORKDAY_MINUTES);
  }
  return total;
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
  const { state, dispatch } = useApp();
  const api = useApi();
  const [period, setPeriod] = useState<Period>("week");
  const [refreshing, setRefreshing] = useState(false);
  const allocations = state.allocations;
  const fetchedAt = state.allocationsFetchedAt;
  const inflightRef = useRef(false);

  const fetchAllocations = async (force: boolean) => {
    if (!state.employee || inflightRef.current) return;
    if (!force && fetchedAt !== null && Date.now() - fetchedAt < ALLOCATION_CACHE_TTL_MS) {
      return;
    }
    inflightRef.current = true;
    if (force) setRefreshing(true);
    try {
      const data = await api.getAllocations(state.employee.id);
      dispatch({ type: "SET_ALLOCATIONS", payload: { allocations: data, fetchedAt: Date.now() } });
    } catch {
      // Network or auth failure — leave any prior cache in place
    } finally {
      inflightRef.current = false;
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAllocations(false);
  }, [state.employee, api]);

  const now = new Date();
  const range = period === "week" ? getWeekRange(now) : getMonthRange(now);

  // Build day-level data for the chart
  const barData: BarData[] = useMemo(() => {
    if (period === "week") {
      const days = getWeekDays(now);
      return days.map((dateStr) => {
        const d = new Date(dateStr + "T12:00:00");
        return {
          label: d.toLocaleDateString("en-US", { weekday: "short" }),
          allocated: getAllocatedMinutesForDay(allocations, dateStr),
          tracked: state.entries
            .filter((e) => e.date === dateStr)
            .reduce((s, e) => s + e.minutes, 0),
        };
      });
    } else {
      // Month view: group by week
      const weeks: { label: string; dates: string[] }[] = [];
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const current = new Date(first);
      let weekNum = 1;
      while (current <= last) {
        const weekDates: string[] = [];
        for (let i = 0; i < 7 && current <= last; i++) {
          weekDates.push(current.toISOString().split("T")[0]);
          current.setDate(current.getDate() + 1);
        }
        weeks.push({ label: `W${weekNum}`, dates: weekDates });
        weekNum++;
      }
      return weeks.map((w) => ({
        label: w.label,
        allocated: w.dates.reduce((s, d) => s + getAllocatedMinutesForDay(allocations, d), 0),
        tracked: state.entries
          .filter((e) => w.dates.includes(e.date))
          .reduce((s, e) => s + e.minutes, 0),
      }));
    }
  }, [period, allocations, state.entries]);

  const totalAllocated = barData.reduce((s, d) => s + d.allocated, 0);
  const totalTracked = barData.reduce((s, d) => s + d.tracked, 0);
  const maxMinutes = Math.max(...barData.map((d) => Math.max(d.allocated, d.tracked)), 1);

  return (
    <div className="flex-1 overflow-y-auto pt-2 pb-4">
      <div className="mx-2">
        {/* Period header */}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-semibold text-text">{range.label}</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fetchAllocations(true)}
              disabled={refreshing || !state.employee}
              title={
                fetchedAt
                  ? `Last refreshed ${new Date(fetchedAt).toLocaleString(undefined, {
                      year: "numeric",
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "Refresh allocations"
              }
              className="p-1 rounded text-text-muted hover:text-text hover:bg-bg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Refresh allocations"
            >
              <svg
                className={`w-3.5 h-3.5 ${refreshing ? "animate-spin [animation-direction:reverse]" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
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
          {allocations.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-text-muted">
              No allocation data available
            </div>
          )}
          {allocations
            .filter((a) => a.endDate >= range.start)
            .map((alloc, i, arr) => {
              // Calculate allocated and tracked for this project in the current range
              const days: string[] = [];
              const start = new Date(range.start + "T12:00:00");
              const end = new Date(range.end + "T12:00:00");
              const cur = new Date(start);
              while (cur <= end) {
                days.push(cur.toISOString().split("T")[0]);
                cur.setDate(cur.getDate() + 1);
              }
              const allocMinutes = days.reduce(
                (s, d) =>
                  s + Math.round((getAllocPercentageOnDate(alloc, d) / 100) * WORKDAY_MINUTES),
                0
              );
              const tracked = state.entries
                .filter(
                  (e) =>
                    e.projectId === alloc.projectId && e.date >= range.start && e.date <= range.end
                )
                .reduce((s, e) => s + e.minutes, 0);
              const project = state.projects.find((p) => p.id === alloc.projectId);
              const pct = allocMinutes > 0 ? Math.min((tracked / allocMinutes) * 100, 100) : 0;

              return (
                <div
                  key={alloc.projectId + alloc.startDate}
                  className={`px-4 py-3 ${i < arr.length - 1 ? "border-b border-divider" : ""}`}
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
                      {formatHours(tracked)} / {formatHours(allocMinutes)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-bg rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          tracked > allocMinutes ? "bg-danger/70" : "bg-primary"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-text-muted tabular-nums w-8 text-right">
                      {Math.round(alloc.percentage)}%
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
