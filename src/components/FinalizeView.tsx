import { useState, useMemo, useCallback } from "react";
import { useApp, useApi } from "../store/context";
import {
  buildRoundingPlan,
  applyOverrides,
  ceilTo15,
  floorTo15,
  type DayProjectRounding,
} from "../api/rounding";
import { getWeekStart, fmtDate, formatWeekLabel, syncedOnly } from "../utils/week";
import type { TimeEntry } from "../api/types";

interface FinalizeViewProps {
  onBack: () => void;
}

const WORKDAY_MINUTES = 480;

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// --- Types ---

type WeekStatus = "active" | "rounded" | "submitted";

interface WeekSummary {
  weekStart: string;
  weekEnd: string;
  label: string;
  totalMinutes: number;
  entryCount: number;
  groupsToRound: number;
  unsavedCount: number;
  status: WeekStatus;
  entries: TimeEntry[];
}

function computeWeekStatus(entries: TimeEntry[]): WeekStatus {
  const synced = syncedOnly(entries);
  if (synced.length === 0) return "rounded";
  const allSubmitted = synced.every((e) => e.status === "SUBMITTED" || e.status === "APPROVED");
  if (allSubmitted) return "submitted";
  const plan = buildRoundingPlan(synced);
  const needsRounding = plan.some((p) => p.difference > 0);
  return needsRounding ? "active" : "rounded";
}

function buildWeekSummaries(entries: TimeEntry[]): WeekSummary[] {
  const weekMap = new Map<string, TimeEntry[]>();

  for (const entry of entries) {
    const d = new Date(entry.date + "T12:00:00");
    const monday = getWeekStart(d);
    const key = fmtDate(monday);
    const existing = weekMap.get(key) ?? [];
    existing.push(entry);
    weekMap.set(key, existing);
  }

  const summaries: WeekSummary[] = [];
  for (const [weekStartStr, weekEntries] of weekMap) {
    const monday = new Date(weekStartStr + "T12:00:00");
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const synced = syncedOnly(weekEntries);
    const plan = buildRoundingPlan(synced);

    summaries.push({
      weekStart: weekStartStr,
      weekEnd: fmtDate(sunday),
      label: formatWeekLabel(monday),
      totalMinutes: weekEntries.reduce((s, e) => s + e.minutes, 0),
      entryCount: weekEntries.length,
      groupsToRound: plan.filter((p) => p.difference > 0).length,
      unsavedCount: weekEntries.length - synced.length,
      status: computeWeekStatus(weekEntries),
      entries: weekEntries,
    });
  }

  return summaries.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

// --- Status badge ---

function StatusBadge({ status }: { status: WeekStatus }) {
  const config = {
    active: { label: "Active", bg: "bg-amber-100", text: "text-amber-700" },
    rounded: { label: "Rounded", bg: "bg-green-100", text: "text-green-700" },
    submitted: { label: "Submitted", bg: "bg-primary/10", text: "text-primary" },
  }[status];

  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${config.bg} ${config.text}`}
    >
      {config.label}
    </span>
  );
}

// --- Rounding info panel ---

function RoundingInfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text transition-colors rounded-lg hover:bg-bg"
          title="Back"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <span className="text-sm font-semibold text-text">Rounding Policy</span>
      </div>

      <div className="px-4 py-4 space-y-4">
        <p className="text-sm text-text">
          Rounding is applied per <strong>project per day</strong>. Each day&apos;s entries for a
          project are summed, then rounded up to the nearest 15-minute increment. The difference is
          added to the largest entry for that project on that day.
        </p>

        <div>
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
            Example
          </h4>
          <div className="bg-white rounded-lg border border-border p-3 text-sm space-y-2">
            <p className="text-text-muted">
              Project A on Monday: 2:30 + 1:17 = <strong>3:47</strong>
            </p>
            <p className="text-text-muted">
              Rounded up to nearest 15 min: <strong>4:00</strong> (+13 min)
            </p>
            <p className="text-text-muted">
              The 13 minutes are added to the largest entry (2:30 → 2:43). You can manually adjust
              the rounded total down to reduce the buffer.
            </p>
          </div>
        </div>

        <p className="text-xs text-text-muted">
          Based on the Qte Time Logging Policy: &quot;Round each entry up to the nearest 15
          minutes.&quot;
        </p>
      </div>
    </div>
  );
}

// --- Editable rounded total ---

function RoundedTotalInput({
  group,
  onChange,
}: {
  group: DayProjectRounding;
  onChange: (value: number) => void;
}) {
  const min = floorTo15(group.totalMinutes);
  const max = ceilTo15(group.totalMinutes);

  // If total is already a multiple of 15, no range to adjust
  if (min === max) return null;

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onChange(Math.max(min, group.roundedTotal - 15))}
        disabled={group.roundedTotal <= min}
        className="w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold text-text-muted bg-bg hover:bg-border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Decrease by 15 min"
      >
        −
      </button>
      <span className="text-xs tabular-nums font-medium text-primary min-w-[36px] text-center">
        {fmtHM(group.roundedTotal)}
      </span>
      <button
        onClick={() => onChange(Math.min(max, group.roundedTotal + 15))}
        disabled={group.roundedTotal >= max}
        className="w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold text-text-muted bg-bg hover:bg-border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Increase by 15 min"
      >
        +
      </button>
    </div>
  );
}

// --- Main component ---

export function FinalizeView({ onBack }: FinalizeViewProps) {
  const { state } = useApp();
  const [selectedWeek, setSelectedWeek] = useState<WeekSummary | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const today = new Date();
  const todayStr = fmtDate(today);

  const weeks = useMemo(() => {
    const pastEntries = state.entries.filter((e) => e.date <= todayStr);
    return buildWeekSummaries(pastEntries);
  }, [state.entries, todayStr]);

  if (showInfo) {
    return <RoundingInfoPanel onClose={() => setShowInfo(false)} />;
  }

  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <button
          onClick={selectedWeek ? () => setSelectedWeek(null) : onBack}
          className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text transition-colors rounded-lg hover:bg-bg"
          title="Back"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <span className="text-sm font-semibold text-text flex-1">
          {selectedWeek ? selectedWeek.label : "Finalize Timesheet"}
        </span>
        {selectedWeek && <StatusBadge status={selectedWeek.status} />}
      </div>

      {selectedWeek ? (
        <WeekDetail
          week={selectedWeek}
          onRounded={() => setSelectedWeek(null)}
          onShowInfo={() => setShowInfo(true)}
        />
      ) : (
        <WeekList weeks={weeks} onSelect={setSelectedWeek} />
      )}
    </div>
  );
}

// --- Week list ---

function WeekList({
  weeks,
  onSelect,
}: {
  weeks: WeekSummary[];
  onSelect: (w: WeekSummary) => void;
}) {
  if (weeks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-text-muted">No entries to finalize.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-2">
      {weeks.map((week) => (
        <button
          key={week.weekStart}
          onClick={() => onSelect(week)}
          className="w-full text-left bg-white rounded-lg border border-border p-3 hover:border-text-muted transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-text">{week.label}</span>
            <StatusBadge status={week.status} />
          </div>
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span>{formatHours(week.totalMinutes)}</span>
            <span>·</span>
            <span>
              {week.entryCount} {week.entryCount === 1 ? "entry" : "entries"}
            </span>
            {week.groupsToRound > 0 && (
              <>
                <span>·</span>
                <span className="text-amber-600">{week.groupsToRound} to round</span>
              </>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// --- Week detail ---

function WeekDetail({
  week,
  onRounded,
  onShowInfo,
}: {
  week: WeekSummary;
  onRounded: () => void;
  onShowInfo: () => void;
}) {
  const { state, dispatch } = useApp();
  const api = useApi();
  const [showConfirm, setShowConfirm] = useState(false);
  const [rounding, setRounding] = useState(false);
  const [error, setError] = useState("");
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());

  const synced = useMemo(() => syncedOnly(week.entries), [week.entries]);
  const unsavedCount = week.entries.length - synced.length;
  const basePlan = useMemo(() => buildRoundingPlan(synced), [synced]);
  const plan = useMemo(() => applyOverrides(basePlan, overrides), [basePlan, overrides]);
  const groupsToRound = plan.filter((p) => p.difference !== 0);
  const adjustedEntries = plan.flatMap((p) => p.entries.filter((e) => e.isAdjusted));
  const canRound = groupsToRound.length > 0 && week.status !== "submitted";

  const handleOverride = useCallback((key: string, value: number) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
  }, []);

  // Group plan entries by day for display
  const dayGroups = useMemo(() => {
    const map = new Map<string, DayProjectRounding[]>();
    for (const group of plan) {
      const existing = map.get(group.date) ?? [];
      existing.push(group);
      map.set(group.date, existing);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [plan]);

  const projectColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of state.projects) {
      map.set(p.id, p.color);
    }
    return map;
  }, [state.projects]);

  async function handleRound() {
    if (!state.employee) return;
    setRounding(true);
    setError("");

    try {
      const updates = adjustedEntries.map((e) => ({
        id: e.id,
        minutes: e.adjustedMinutes,
      }));
      await api.batchUpdateEntries(state.employee.id, updates);

      // Trigger sync to reload fresh data
      dispatch({ type: "SET_LOADING", payload: true });
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const now = new Date();
      const past = new Date(now);
      past.setDate(past.getDate() - 30);
      const future = new Date(now);
      future.setDate(future.getDate() + 30);
      const entries = await api.getTimeEntries(state.employee.id, fmt(past), fmt(future));
      dispatch({ type: "SET_ENTRIES", payload: entries });
      dispatch({ type: "SET_LOADING", payload: false });

      onRounded();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to round entries";
      setError(msg);
      setRounding(false);
      setShowConfirm(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Unsaved warning */}
        {unsavedCount > 0 && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800">
            <svg
              className="w-3.5 h-3.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            {unsavedCount} unsaved {unsavedCount === 1 ? "entry is" : "entries are"} excluded — sync
            to AgileDay first
          </div>
        )}

        {/* Day groups */}
        {dayGroups.map(([date, projectGroups]) => {
          const dayTotal = projectGroups.reduce(
            (s, g) => s + g.entries.reduce((se, e) => se + e.currentMinutes, 0),
            0
          );
          const dayAdjusted = projectGroups.reduce(
            (s, g) => s + g.entries.reduce((se, e) => se + e.adjustedMinutes, 0),
            0
          );
          const hasChanges = dayTotal !== dayAdjusted;
          const adjustedOff = dayAdjusted !== WORKDAY_MINUTES;

          return (
            <div key={date} className="bg-white rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-bg/50 border-b border-border">
                <span className="text-xs font-medium text-text">{formatDayLabel(date)}</span>
                <span
                  className={`text-xs tabular-nums font-medium ${adjustedOff ? "text-amber-600" : "text-text-muted"}`}
                >
                  {fmtHM(dayTotal)}
                  {hasChanges && ` → ${fmtHM(dayAdjusted)}`}
                </span>
              </div>
              <div className="divide-y divide-border">
                {projectGroups.map((group) => (
                  <ProjectGroupSection
                    key={group.projectId}
                    group={group}
                    projectColor={projectColors.get(group.projectId)}
                    onOverride={(value) =>
                      handleOverride(`${group.projectId}:${group.date}`, value)
                    }
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Round All section */}
      <div className="border-t border-border bg-bg-card px-4 py-3 space-y-2">
        {error && <p className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex items-start gap-1.5 text-xs text-text-muted">
          <span>
            Rounds each project&apos;s daily total up to the nearest 15 minutes. Use the +/− buttons
            to adjust.
          </span>
          <button
            onClick={onShowInfo}
            className="w-4 h-4 shrink-0 rounded-full bg-text-muted/20 text-text-muted text-[10px] font-bold leading-none inline-flex items-center justify-center hover:bg-text-muted/30 transition-colors"
          >
            ?
          </button>
        </div>

        {showConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">
              Adjust {adjustedEntries.length} {adjustedEntries.length === 1 ? "entry" : "entries"}?
            </span>
            <button
              onClick={handleRound}
              disabled={rounding}
              className="px-4 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {rounding ? "Rounding..." : "Yes, apply"}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              disabled={rounding}
              className="px-3 py-1.5 text-xs font-medium text-text-muted bg-bg rounded-lg hover:bg-border transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirm(true)}
            disabled={!canRound}
            className="w-full py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {week.status === "submitted"
              ? "Already submitted"
              : groupsToRound.length === 0
                ? "All entries rounded"
                : `Round ${groupsToRound.length} ${groupsToRound.length === 1 ? "group" : "groups"}`}
          </button>
        )}
      </div>
    </div>
  );
}

// --- Project group within a day ---

function ProjectGroupSection({
  group,
  projectColor,
  onOverride,
}: {
  group: DayProjectRounding;
  projectColor?: string;
  onOverride: (value: number) => void;
}) {
  const needsRounding = ceilTo15(group.totalMinutes) !== group.totalMinutes;
  const isLocked = group.entries.every((e) => e.status === "SUBMITTED" || e.status === "APPROVED");

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 ${isLocked ? "opacity-50" : ""} ${needsRounding ? "bg-primary/5" : ""}`}
    >
      {projectColor && (
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: projectColor }} />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-text truncate">
          {group.projectName ?? "Unknown project"}
        </div>
      </div>
      <div className="text-xs tabular-nums text-right shrink-0 flex items-center gap-2">
        {needsRounding ? (
          <>
            <span className="text-text-muted">{fmtHM(group.totalMinutes)}</span>
            <RoundedTotalInput group={group} onChange={onOverride} />
          </>
        ) : (
          <span className="text-text-muted">{fmtHM(group.totalMinutes)}</span>
        )}
        {isLocked && (
          <svg
            className="w-3 h-3 inline-block text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
