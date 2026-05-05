import { useState, useEffect, useMemo, useRef } from "react";
import { useApp, useApi } from "../store/context";
import type { Allocation } from "../api/types";

type Period = "week" | "month";

const WORKDAY_MINUTES = 480; // 8 hours
const WEEK_CAPACITY_MINUTES = 2400; // 40 hours
const ALLOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function getWeekRange(ref: Date): { start: string; end: string; label: string } {
  const day = ref.getDay();
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const startOrd = ordinal(monday.getDate());
  const endOrd = sameMonth
    ? ordinal(sunday.getDate())
    : `${ordinal(sunday.getDate())} ${sunday.toLocaleDateString("en-US", { month: "short" })}`;
  const startBase = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return {
    start: monday.toISOString().split("T")[0],
    end: sunday.toISOString().split("T")[0],
    label: `Week of ${startBase} (${startOrd} - ${endOrd})`,
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
  return Array.from({ length: 5 }, (_, i) => {
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

interface BarSegment {
  key: string;
  label: string;
  color: string;
  minutes: number;
}

const SEGMENT_FALLBACK_COLOR = "#9CA3AF";
const BILLABLE_COLOR = "#7A59FC"; // matches --color-primary
const NON_BILLABLE_COLOR = "#D1CCC9"; // matches the bar's empty track tint

function StackedBar({ segments, totalMinutes }: { segments: BarSegment[]; totalMinutes: number }) {
  if (totalMinutes === 0 || segments.length === 0) {
    return <div className="h-3 bg-bg rounded-full" />;
  }
  const visible = segments.filter((s) => s.minutes > 0);
  // Precompute each segment's center position so we can anchor its tooltip to
  // the side of the segment that keeps the popover within the bar.
  let runningPct = 0;
  const segmentsWithPos = visible.map((s) => {
    const widthPct = (s.minutes / totalMinutes) * 100;
    const centerPct = runningPct + widthPct / 2;
    runningPct += widthPct;
    return { s, widthPct, centerPct };
  });
  return (
    <div className="flex h-3 bg-bg rounded-full">
      {segmentsWithPos.map(({ s, widthPct, centerPct }, i) => {
        const isFirst = i === 0;
        const isLast = i === segmentsWithPos.length - 1;
        const onlyOne = segmentsWithPos.length === 1;
        const rounded = `${isFirst ? "rounded-l-full" : ""} ${isLast ? "rounded-r-full" : ""}`;
        const separator = !isLast ? "border-r-2 border-bg-card" : "";
        const tooltipAlign = onlyOne
          ? "left-1/2 -translate-x-1/2"
          : centerPct > 50
            ? "right-0"
            : "left-0";
        return (
          <div key={s.key} className="group relative h-full" style={{ width: `${widthPct}%` }}>
            <div
              className={`h-full ${rounded} ${separator}`}
              style={{ backgroundColor: s.color }}
            />
            <div
              className={`hidden group-hover:block pointer-events-none absolute bottom-full mb-2 px-2 py-1.5 rounded-md bg-bg-dark text-bg-card text-[10px] leading-tight whitespace-nowrap shadow-md z-10 ${tooltipAlign}`}
            >
              <div className="font-semibold mb-0.5">{s.label}</div>
              <div>
                {formatHours(s.minutes)} ({Math.round(widthPct)}%)
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarVisual({ data, maxMinutes }: { data: BarData; maxMinutes: number }) {
  const allocatedPct = maxMinutes > 0 ? (data.allocated / maxMinutes) * 100 : 0;
  const trackedPct = maxMinutes > 0 ? (data.tracked / maxMinutes) * 100 : 0;
  const overAllocated = data.tracked > data.allocated && data.allocated > 0;
  const usagePct = data.allocated > 0 ? (data.tracked / data.allocated) * 100 : 0;

  return (
    <div className="group relative flex items-end gap-0.5 flex-1 h-full justify-center min-w-0">
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
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1.5 rounded-md bg-bg-dark text-bg-card text-[10px] leading-tight whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10">
        <div className="font-semibold mb-0.5">{data.label}</div>
        <div>Allocated: {formatHours(data.allocated)}</div>
        <div>Tracked: {formatHours(data.tracked)}</div>
        {data.allocated > 0 && (
          <div className={overAllocated ? "text-danger" : ""}>{Math.round(usagePct)}%</div>
        )}
        <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 w-2 h-2 bg-bg-dark rotate-45" />
      </div>
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

  // Tracked-time breakdown for the current period (week/month)
  const projectSegments = useMemo<BarSegment[]>(() => {
    const totals = new Map<string, { name: string; minutes: number }>();
    for (const e of state.entries) {
      if (e.date < range.start || e.date > range.end) continue;
      const existing = totals.get(e.projectId);
      if (existing) {
        existing.minutes += e.minutes;
        if (!existing.name && e.projectName) existing.name = e.projectName;
      } else {
        totals.set(e.projectId, { name: e.projectName ?? "", minutes: e.minutes });
      }
    }
    return [...totals.entries()]
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .map(([projectId, { name, minutes }]) => {
        const project = state.projects.find((p) => p.id === projectId);
        return {
          key: projectId,
          label: project?.name ?? name ?? "Unknown project",
          color: project?.color ?? SEGMENT_FALLBACK_COLOR,
          minutes,
        };
      });
  }, [state.entries, state.projects, range.start, range.end]);

  const billableSegments = useMemo<BarSegment[]>(() => {
    let billable = 0;
    let nonBillable = 0;
    for (const e of state.entries) {
      if (e.date < range.start || e.date > range.end) continue;
      // Bucket as billable strictly when the task is known billable; tasks
      // that aren't loaded yet (or entries without a taskId) fall into
      // non-billable until task data arrives. This keeps segment widths
      // summing to the displayed total.
      const isBillable = e.taskId ? state.taskBillableById[e.taskId] === true : false;
      if (isBillable) billable += e.minutes;
      else nonBillable += e.minutes;
    }
    const segs: BarSegment[] = [];
    if (billable > 0)
      segs.push({ key: "billable", label: "Billable", color: BILLABLE_COLOR, minutes: billable });
    if (nonBillable > 0)
      segs.push({
        key: "non-billable",
        label: "Non-billable",
        color: NON_BILLABLE_COLOR,
        minutes: nonBillable,
      });
    return segs;
  }, [state.entries, state.taskBillableById, range.start, range.end]);

  const billableMinutes = billableSegments.find((s) => s.key === "billable")?.minutes ?? 0;
  const nonBillableMinutes = billableSegments.find((s) => s.key === "non-billable")?.minutes ?? 0;
  const billablePct = totalTracked > 0 ? (billableMinutes / totalTracked) * 100 : 0;
  const nonBillablePct = totalTracked > 0 ? (nonBillableMinutes / totalTracked) * 100 : 0;

  // Per-project rows for the allocation list. Multiple openings on the same
  // project (common for vacation) are merged into a single row by summing
  // each opening's allocMinutes for the visible range.
  const projectRows = useMemo(() => {
    type Row = {
      projectId: string;
      projectName: string;
      allocMinutes: number;
      tracked: number;
    };

    const days: string[] = [];
    const start = new Date(range.start + "T12:00:00");
    const end = new Date(range.end + "T12:00:00");
    const cur = new Date(start);
    while (cur <= end) {
      days.push(cur.toISOString().split("T")[0]);
      cur.setDate(cur.getDate() + 1);
    }

    const byProject = new Map<string, Row>();
    for (const alloc of allocations) {
      const allocMinutes = days.reduce(
        (s, d) => s + Math.round((getAllocPercentageOnDate(alloc, d) / 100) * WORKDAY_MINUTES),
        0
      );
      const existing = byProject.get(alloc.projectId);
      if (existing) {
        existing.allocMinutes += allocMinutes;
      } else {
        byProject.set(alloc.projectId, {
          projectId: alloc.projectId,
          projectName: alloc.projectName,
          allocMinutes,
          tracked: 0,
        });
      }
    }

    for (const row of byProject.values()) {
      row.tracked = state.entries
        .filter(
          (e) => e.projectId === row.projectId && e.date >= range.start && e.date <= range.end
        )
        .reduce((s, e) => s + e.minutes, 0);
    }

    return [...byProject.values()].filter((r) => r.allocMinutes > 0 || r.tracked > 0);
  }, [allocations, state.entries, range.start, range.end]);
  const referenceMinutes = period === "week" ? WORKDAY_MINUTES : WEEK_CAPACITY_MINUTES;
  const referenceLabel = period === "week" ? "8h" : "40h";
  const maxMinutes = Math.max(
    ...barData.map((d) => Math.max(d.allocated, d.tracked)),
    referenceMinutes
  );

  return (
    <div className="flex-1 overflow-y-auto overflow-x-clip pt-2 pb-4">
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
          <div className="pr-6">
            <div className="relative flex items-end gap-1 h-32">
              {barData.map((d) => (
                <BarVisual key={d.label} data={d} maxMinutes={maxMinutes} />
              ))}
              <div
                className="absolute left-0 -right-6 border-t border-dashed border-text-muted/50 pointer-events-none"
                style={{ bottom: `${(referenceMinutes / maxMinutes) * 100}%` }}
              />
              <span
                className="absolute -right-6 text-[9px] text-text-muted leading-none pointer-events-none"
                style={{ bottom: `calc(${(referenceMinutes / maxMinutes) * 100}% + 3px)` }}
              >
                {referenceLabel}
              </span>
            </div>
            <div className="flex gap-1 mt-1">
              {barData.map((d) => (
                <span
                  key={d.label}
                  className="flex-1 text-center text-[10px] text-text-muted min-w-0"
                >
                  {d.label}
                </span>
              ))}
            </div>
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

        {/* Tracked-time breakdown (per project + billable split) */}
        <div className="px-3 py-2">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Tracked time ({period === "week" ? "this week" : "this month"})
          </span>
        </div>
        <div className="bg-bg-card rounded-xl shadow-sm px-4 py-3 mb-3">
          <div className="space-y-2.5">
            <div className="text-[10px] text-text-muted uppercase tracking-wide">By project</div>
            <StackedBar segments={projectSegments} totalMinutes={totalTracked} />
          </div>
          <div className="border-t border-divider my-4" />
          <div className="space-y-2.5">
            <StackedBar segments={billableSegments} totalMinutes={totalTracked} />
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide tabular-nums text-primary">
                Billable {Math.round(billablePct)}%
              </span>
              <span className="text-[10px] uppercase tracking-wide tabular-nums text-text-muted">
                {Math.round(nonBillablePct)}% Non-billable
              </span>
            </div>
          </div>
        </div>

        {/* Per-project breakdown */}
        <div className="px-3 py-2">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Allocation by project ({period === "week" ? "this week" : "this month"})
          </span>
        </div>
        <div className="bg-bg-card rounded-xl shadow-sm overflow-hidden">
          {allocations.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-text-muted">
              No allocation data available
            </div>
          )}
          {projectRows.map((row, i, arr) => {
            const project = state.projects.find((p) => p.id === row.projectId);
            const pct =
              row.allocMinutes > 0 ? Math.min((row.tracked / row.allocMinutes) * 100, 100) : 0;

            return (
              <div
                key={row.projectId}
                className={`px-4 py-3 ${i < arr.length - 1 ? "border-b border-divider" : ""}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: project?.color ?? "#999" }}
                    />
                    <span className="text-sm text-text">{row.projectName}</span>
                  </div>
                  <span className="text-xs text-text-muted tabular-nums">
                    {formatHours(row.tracked)} / {formatHours(row.allocMinutes)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        row.tracked > row.allocMinutes ? "bg-danger/70" : "bg-primary"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-muted tabular-nums w-8 text-right">
                    {Math.round(pct)}%
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
