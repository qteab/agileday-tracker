import { useState } from "react";
import { useApp } from "../store/context";
import { formatFlexMinutes, type FlexWeek, type MonthStats } from "../utils/flex";
import { useLiveFlex } from "../hooks/useLiveFlex";
import { saveFlexConfig, type FlexConfig } from "../store/flex-store";
import { fmtDate } from "../utils/week";

function formatHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function FlexView() {
  const { state, dispatch } = useApp();
  const { flexConfig } = state;
  const { flex, month, now } = useLiveFlex();

  const [editMode, setEditMode] = useState(!flexConfig);
  const [startDate, setStartDate] = useState(flexConfig?.startDate ?? fmtDate(new Date()));
  const [initialHours, setInitialHours] = useState(flexConfig?.initialHours?.toString() ?? "0");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const hours = parseFloat(initialHours);
    if (!startDate || isNaN(hours)) return;

    setSaving(true);
    const config: FlexConfig = { startDate, initialHours: hours };
    try {
      await saveFlexConfig(config);
      dispatch({ type: "SET_FLEX_CONFIG", payload: config });
      setEditMode(false);
    } catch {
      dispatch({ type: "SET_ERROR", payload: "Failed to save flex config" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {/* Settings section */}
      {editMode ? (
        <div className="bg-bg-card rounded-xl p-4 mb-4 border border-border">
          <h3 className="text-sm font-semibold text-text mb-3">Flex Setup</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">
                Start date (flex counts from the day after)
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">
                Initial flex balance (hours, can be negative)
              </label>
              <input
                type="number"
                step="0.5"
                value={initialHours}
                onChange={(e) => setInitialHours(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !startDate}
                className="flex-1 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              {flexConfig && (
                <button
                  onClick={() => {
                    setStartDate(flexConfig.startDate);
                    setInitialHours(flexConfig.initialHours.toString());
                    setEditMode(false);
                  }}
                  className="px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between bg-bg-card rounded-xl p-4 mb-4 border border-border">
          <div>
            <div className="text-xs text-text-muted">Flex balance (live, includes today)</div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                flex && flex.totalMinutes >= 0 ? "text-emerald-600" : "text-danger"
              }`}
            >
              {flex ? formatFlexMinutes(flex.totalMinutes) : "—"}
            </div>
            {flex && (
              <div className="text-xs text-text-muted mt-1">
                Today: {formatHM(flex.todayWorkedMinutes)} worked
                {flex.todayExpectedMinutes > 0 && (
                  <> of {formatHM(flex.todayExpectedMinutes)} expected</>
                )}
                {" · "}through yesterday: {formatFlexMinutes(flex.baseMinutes)}
              </div>
            )}
          </div>
          <button
            onClick={() => setEditMode(true)}
            className="p-2 text-text-muted hover:text-text transition-colors rounded-lg hover:bg-bg"
            title="Edit flex settings"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
        </div>
      )}

      {/* This month */}
      <MonthCard month={month} now={now} />

      {/* Weekly breakdown */}
      {flex && flex.weeks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide px-1">
            Weekly breakdown
          </h3>
          {[...flex.weeks].reverse().map((week) => (
            <WeekRow key={week.startDate} week={week} />
          ))}
        </div>
      )}

      {!flexConfig && (
        <div className="text-center text-sm text-text-muted py-8">
          Set up your flex start date and initial balance above to start tracking.
        </div>
      )}
    </div>
  );
}

function MonthCard({ month, now }: { month: MonthStats; now: Date }) {
  const monthLabel = now.toLocaleDateString("en-US", { month: "long" });
  const percent =
    month.expectedMinutes > 0 ? (month.workedMinutes / month.expectedMinutes) * 100 : 0;
  const paceDelta = month.workedMinutes - month.expectedToDateMinutes;
  const onPace = paceDelta >= 0;

  return (
    <div className="bg-bg-card rounded-xl p-4 mb-4 border border-border">
      <h3 className="text-sm font-semibold text-text mb-3">This month — {monthLabel}</h3>
      <div className="flex items-center gap-4">
        <MonthDonut percent={percent} />
        <div className="flex-1 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Worked</span>
            <span className="font-semibold tabular-nums text-text">
              {formatHM(month.workedMinutes)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Month target</span>
            <span className="tabular-nums text-text">
              {formatHM(month.expectedMinutes)}
              <span className="text-text-muted"> · {month.workdays} days</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Expected by today</span>
            <span className="tabular-nums text-text">{formatHM(month.expectedToDateMinutes)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Pace</span>
            <span
              className={`font-semibold tabular-nums ${onPace ? "text-emerald-600" : "text-danger"}`}
            >
              {formatFlexMinutes(paceDelta)}
              <span className="font-normal">
                {" "}
                (
                {month.expectedToDateMinutes > 0
                  ? Math.round((month.workedMinutes / month.expectedToDateMinutes) * 100)
                  : 100}
                %)
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Circular progress: worked vs full-month target */
function MonthDonut({ percent }: { percent: number }) {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(percent, 100));

  return (
    <div className="relative w-24 h-24 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-border" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(circumference * clamped) / 100} ${circumference}`}
          className="stroke-primary transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-base font-bold tabular-nums text-text">{Math.round(percent)}%</span>
      </div>
    </div>
  );
}

function WeekRow({ week }: { week: FlexWeek }) {
  const isPositive = week.deltaMinutes >= 0;

  return (
    <div className="bg-bg-card rounded-xl p-3 border border-border">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text">{week.weekLabel}</span>
          {week.isPartial && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              partial
            </span>
          )}
        </div>
        <span
          className={`text-sm font-semibold tabular-nums ${
            isPositive ? "text-emerald-600" : "text-danger"
          }`}
        >
          {formatFlexMinutes(week.deltaMinutes)}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <span>Expected: {formatHM(week.expectedMinutes)}</span>
        <span>Worked: {formatHM(week.workedMinutes)}</span>
        <span>{week.workdays} workdays</span>
      </div>
      {week.holidays.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {week.holidays.map((h) => (
            <span
              key={h.date}
              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700"
            >
              {h.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
