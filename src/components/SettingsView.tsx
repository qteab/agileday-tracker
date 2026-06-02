import { useState, useMemo } from "react";
import { useApp } from "../store/context";
import { saveFlexConfig, type FlexConfig } from "../store/flex-store";
import { saveDisplayPrefs, type MenuBarMode } from "../store/display-store";
import { calculateFlex, formatFlexMinutes } from "../utils/flex";
import { fmtDate } from "../utils/week";

export type SettingsTab = "flex" | "display" | "account";

interface SettingsViewProps {
  onBack: () => void;
  defaultTab?: SettingsTab;
}

export function SettingsView({ onBack, defaultTab = "flex" }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header with back button */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-3 border-b border-border">
        <button
          onClick={onBack}
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
        <span className="text-sm font-semibold text-text">Settings</span>
      </div>

      {/* Tab switcher */}
      <div className="flex shrink-0 mx-4 mt-3 rounded-full border border-border overflow-hidden">
        <button
          onClick={() => setActiveTab("flex")}
          className={`flex-1 py-1.5 text-xs font-medium transition-all ${
            activeTab === "flex"
              ? "bg-bg-card text-text"
              : "bg-transparent text-text-muted hover:text-text"
          }`}
        >
          Flex
        </button>
        <button
          onClick={() => setActiveTab("display")}
          className={`flex-1 py-1.5 text-xs font-medium transition-all ${
            activeTab === "display"
              ? "bg-bg-card text-text"
              : "bg-transparent text-text-muted hover:text-text"
          }`}
        >
          Display
        </button>
        <button
          onClick={() => setActiveTab("account")}
          className={`flex-1 py-1.5 text-xs font-medium transition-all ${
            activeTab === "account"
              ? "bg-bg-card text-text"
              : "bg-transparent text-text-muted hover:text-text"
          }`}
        >
          Account
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "flex" && <FlexSettings />}
        {activeTab === "display" && <DisplaySettings />}
        {activeTab === "account" && <AccountSettings onBack={onBack} />}
      </div>
    </div>
  );
}

function DisplaySettings() {
  const { state, dispatch } = useApp();
  const { displayPrefs } = state;

  async function setMode(mode: MenuBarMode) {
    if (mode === displayPrefs.menuBarMode) return;
    const next = { ...displayPrefs, menuBarMode: mode };
    dispatch({ type: "SET_DISPLAY_PREFS", payload: next });
    await saveDisplayPrefs(next).catch(() => {});
  }

  const options: { value: MenuBarMode; label: string; hint: string }[] = [
    { value: "off", label: "Off", hint: "Icon only" },
    { value: "compact", label: "Compact", hint: "Icon + time" },
    { value: "full", label: "Full", hint: "Icon + time + task" },
  ];

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="bg-bg-card rounded-xl p-4 border border-border">
        <div className="text-sm font-medium text-text">Menu bar display</div>
        <p className="text-xs text-text-muted mt-1 mb-3">
          How much detail to show next to the menu bar icon while a timer is running.
        </p>
        <div className="flex rounded-full border border-border overflow-hidden">
          {options.map((opt) => {
            const active = displayPrefs.menuBarMode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setMode(opt.value)}
                className={`flex-1 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? "bg-primary text-white"
                    : "bg-transparent text-text-muted hover:text-text"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="flex mt-1.5">
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`flex-1 text-center text-[10px] ${
                displayPrefs.menuBarMode === opt.value ? "text-text" : "text-text-muted"
              }`}
            >
              {opt.hint}
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-text-muted px-1">
        The tray dropdown always shows the project, task, and description while a timer is running —
        regardless of this setting.
      </p>
    </div>
  );
}

function FlexSettings() {
  const { state, dispatch } = useApp();
  const { flexConfig, entries, flexEntries, holidays } = state;

  // Derive month from stored start date (which is last day of month)
  function dateToMonth(dateStr: string): string {
    const d = new Date(dateStr + "T12:00:00");
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  function getDefaultMonth(): string {
    const now = new Date();
    // Default to previous month
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  }
  function monthToLastDay(monthStr: string): string {
    const [year, month] = monthStr.split("-").map(Number);
    const lastDay = new Date(year, month, 0); // day 0 of next month = last day of this month
    return fmtDate(lastDay);
  }

  const [paycheckMonth, setPaycheckMonth] = useState(
    flexConfig?.startDate ? dateToMonth(flexConfig.startDate) : getDefaultMonth()
  );
  const [initialHours, setInitialHours] = useState(flexConfig?.initialHours?.toString() ?? "0");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
    if (!paycheckMonth || isNaN(hours)) return;

    setSaving(true);
    const startDate = monthToLastDay(paycheckMonth);
    const config: FlexConfig = { startDate, initialHours: hours };
    try {
      await saveFlexConfig(config);
      dispatch({ type: "SET_FLEX_CONFIG", payload: config });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      dispatch({ type: "SET_ERROR", payload: "Failed to save flex config" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Current balance */}
      {flex && (
        <div className="bg-bg-card rounded-xl p-4 border border-border text-center">
          <div className="text-xs text-text-muted mb-1">Current flex balance</div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              flex.totalMinutes >= 0 ? "text-emerald-600" : "text-danger"
            }`}
          >
            {formatFlexMinutes(flex.totalMinutes)}
          </div>
          <div className="text-[10px] text-text-muted mt-1">Through yesterday</div>
        </div>
      )}

      {/* Config form */}
      <div className="bg-bg-card rounded-xl p-4 border border-border space-y-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Latest paycheck month</label>
          <input
            type="month"
            value={paycheckMonth}
            onChange={(e) => setPaycheckMonth(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Initial flex balance (hours)</label>
          <p className="text-[10px] text-text-muted mb-1.5">
            Check your latest Fortnox paycheck for the current flex value.
          </p>
          <input
            type="number"
            step="0.5"
            value={initialHours}
            onChange={(e) => setInitialHours(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !paycheckMonth}
          className="w-full py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saved ? "Saved!" : saving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Weekly breakdown */}
      {flex && flex.weeks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Weekly breakdown
          </h3>
          {[...flex.weeks].reverse().map((week) => (
            <div key={week.startDate} className="bg-bg-card rounded-xl p-3 border border-border">
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
                    week.deltaMinutes >= 0 ? "text-emerald-600" : "text-danger"
                  }`}
                >
                  {formatFlexMinutes(week.deltaMinutes)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span>
                  Expected: {Math.floor(week.expectedMinutes / 60)}:
                  {String(week.expectedMinutes % 60).padStart(2, "0")}
                </span>
                <span>
                  Worked: {Math.floor(week.workedMinutes / 60)}:
                  {String(week.workedMinutes % 60).padStart(2, "0")}
                </span>
                <span>{week.workdays}d</span>
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
          ))}
        </div>
      )}
    </div>
  );
}

function AccountSettings({ onBack }: { onBack: () => void }) {
  const { state, logout } = useApp();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <div className="px-4 py-4">
      {state.employee && (
        <p className="text-xs text-text-muted mb-3">
          Signed in as {state.employee.name} ({state.employee.email})
        </p>
      )}
      {showLogoutConfirm ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Are you sure?</span>
          <button
            onClick={() => {
              logout();
              onBack();
            }}
            className="px-3 py-1.5 text-xs font-medium text-white bg-danger rounded-lg hover:bg-danger/90 transition-colors"
          >
            Sign out
          </button>
          <button
            onClick={() => setShowLogoutConfirm(false)}
            className="px-3 py-1.5 text-xs font-medium text-text-muted bg-bg rounded-lg hover:bg-border transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-danger bg-danger/10 rounded-lg hover:bg-danger/20 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Sign out
        </button>
      )}
    </div>
  );
}
