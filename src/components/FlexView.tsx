import { useState, useMemo } from "react";
import { useApp } from "../store/context";
import { calculateFlex, formatFlexMinutes, type FlexWeek } from "../utils/flex";
import { saveFlexConfig, type FlexConfig } from "../store/flex-store";
import { fmtDate } from "../utils/week";

function formatHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function FlexView() {
  const { state, dispatch } = useApp();
  const { flexConfig, entries, flexEntries, holidays } = state;

  const [editMode, setEditMode] = useState(!flexConfig);
  const [startDate, setStartDate] = useState(flexConfig?.startDate ?? fmtDate(new Date()));
  const [initialHours, setInitialHours] = useState(flexConfig?.initialHours?.toString() ?? "0");
  const [saving, setSaving] = useState(false);

  const flex = useMemo(() => {
    if (!flexConfig) return null;
    const allEntries = flexEntries ? [...entries, ...flexEntries] : entries;
    return calculateFlex(
      allEntries,
      flexConfig.startDate,
      flexConfig.initialHours,
      holidays,
      new Date()
    );
  }, [flexConfig, entries, flexEntries, holidays]);

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
            <div className="text-xs text-text-muted">Flex balance (through yesterday)</div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                flex && flex.totalMinutes >= 0 ? "text-emerald-600" : "text-danger"
              }`}
            >
              {flex ? formatFlexMinutes(flex.totalMinutes) : "—"}
            </div>
            {flexConfig && (
              <div className="text-xs text-text-muted mt-1">
                Starting {formatFlexMinutes(Math.round(flexConfig.initialHours * 60))} on{" "}
                {new Date(flexConfig.startDate + "T12:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
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
