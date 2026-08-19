import { useState } from "react";
import { useApp } from "../store/context";
import { saveFlexConfig, type FlexConfig } from "../store/flex-store";
import {
  saveDisplayPrefs,
  clampInactivityMinutes,
  INACTIVITY_MIN_MINUTES,
  INACTIVITY_MAX_MINUTES,
  type MenuBarMode,
  type ThemeMode,
  type ListAutoCollapse,
  type DisplayPrefs,
} from "../store/display-store";
import { fmtDate } from "../utils/week";
import bearIcon from "../assets/bear.png";

export type SettingsPage = "flex" | "menubar" | "appearance" | "timer" | "list";

interface SettingsViewProps {
  onBack: () => void;
  /** Open straight into a sub page. Omit (or null) to land on the page list. */
  initialPage?: SettingsPage | null;
}

const PAGE_TITLES: Record<SettingsPage, string> = {
  flex: "Flex",
  menubar: "Menu bar",
  appearance: "Appearance",
  timer: "Timer",
  list: "Entry list",
};

export function SettingsView({ onBack, initialPage = null }: SettingsViewProps) {
  const [page, setPage] = useState<SettingsPage | null>(initialPage);

  // Back steps out of a sub page first, then out of settings entirely
  const goBack = page ? () => setPage(null) : onBack;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header with back button */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-3 border-b border-border">
        <button
          onClick={goBack}
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
        <span className="text-sm font-semibold text-text">
          {page ? PAGE_TITLES[page] : "Settings"}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {page === null && <SettingsMenu onOpen={setPage} onSignedOut={onBack} />}
        {page === "flex" && <FlexSettings />}
        {page === "menubar" && <MenuBarSettings />}
        {page === "appearance" && <AppearanceSettings />}
        {page === "timer" && <TimerSettings />}
        {page === "list" && <ListSettings />}
      </div>
    </div>
  );
}

/** Keep hints general — they describe the page, not the settings on it. */
const MENU_ITEMS: { page: SettingsPage; label: string; hint: string; icon: string }[] = [
  {
    page: "flex",
    label: "Flex",
    hint: "Set up how your flex balance is tracked",
    icon: "M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3",
  },
  {
    page: "menubar",
    label: "Menu bar",
    hint: "Change how the app appears in the menu bar",
    icon: "M4 6h16M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z",
  },
  {
    page: "appearance",
    label: "Appearance",
    hint: "Change how the app looks",
    icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  },
  {
    page: "timer",
    label: "Timer",
    hint: "Change how the timer behaves",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    page: "list",
    label: "Entry list",
    hint: "Change how the day list is grouped and collapsed",
    icon: "M4 6h16M4 12h16M4 18h7",
  },
];

function SettingsMenu({
  onOpen,
  onSignedOut,
}: {
  onOpen: (page: SettingsPage) => void;
  onSignedOut: () => void;
}) {
  const { state, logout } = useApp();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
        {MENU_ITEMS.map((item, i) => (
          <button
            key={item.page}
            onClick={() => onOpen(item.page)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg transition-colors ${
              i > 0 ? "border-t border-border" : ""
            }`}
          >
            <svg
              className="w-5 h-5 shrink-0 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text">{item.label}</div>
              <div className="text-xs text-text-muted mt-0.5">{item.hint}</div>
            </div>
            <svg
              className="w-4 h-4 shrink-0 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>

      {/* Sign out */}
      <div className="px-1">
        {state.employee && (
          <p className="text-xs text-text-muted mb-2">
            Signed in as {state.employee.name} ({state.employee.email})
          </p>
        )}
        {showLogoutConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Are you sure?</span>
            <button
              onClick={() => {
                logout();
                onSignedOut();
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
    </div>
  );
}

function MenuBarSettings() {
  const { state, dispatch } = useApp();
  const { displayPrefs } = state;

  async function persist(next: DisplayPrefs) {
    dispatch({ type: "SET_DISPLAY_PREFS", payload: next });
    await saveDisplayPrefs(next).catch(() => {});
  }

  async function setMode(mode: MenuBarMode) {
    if (mode === displayPrefs.menuBarMode) return;
    await persist({ ...displayPrefs, menuBarMode: mode });
  }

  async function toggleTrayIcon() {
    await persist({ ...displayPrefs, showTrayIcon: !displayPrefs.showTrayIcon });
  }

  const withIcon = displayPrefs.showTrayIcon;
  const options: { value: MenuBarMode; label: string; hint: string }[] = [
    { value: "off", label: "Off", hint: withIcon ? "Icon only" : "Play/pause only" },
    { value: "compact", label: "Compact", hint: withIcon ? "Icon + time" : "Time only" },
    { value: "full", label: "Full", hint: withIcon ? "Icon + time + task" : "Time + task" },
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

      <div className="bg-bg-card rounded-xl p-4 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src={bearIcon}
              alt=""
              className={`w-5 h-5 shrink-0 transition-opacity ${
                displayPrefs.showTrayIcon ? "opacity-100" : "opacity-30"
              }`}
            />
            <div className="text-sm font-medium text-text">Bear icon</div>
          </div>
          <button
            role="switch"
            aria-checked={displayPrefs.showTrayIcon}
            aria-label="Show the bear icon in the menu bar"
            onClick={toggleTrayIcon}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
              displayPrefs.showTrayIcon ? "bg-primary" : "bg-border"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                displayPrefs.showTrayIcon ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-text-muted mt-1">
          Show the bear icon in the menu bar. Turn it off for a text-only tray — the play/pause
          control and the dropdown keep working.
        </p>
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const { state, dispatch } = useApp();
  const { displayPrefs } = state;

  async function setTheme(theme: ThemeMode) {
    if (theme === displayPrefs.theme) return;
    const next = { ...displayPrefs, theme };
    dispatch({ type: "SET_DISPLAY_PREFS", payload: next });
    await saveDisplayPrefs(next).catch(() => {});
  }

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="bg-bg-card rounded-xl p-4 border border-border">
        <div className="text-sm font-medium text-text">Theme</div>
        <p className="text-xs text-text-muted mt-1 mb-3">
          Pick a theme, or follow your macOS system setting.
        </p>
        <div className="flex rounded-full border border-border overflow-hidden">
          {themeOptions.map((opt) => {
            const active = displayPrefs.theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
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
      </div>
    </div>
  );
}

function TimerSettings() {
  const { state, dispatch } = useApp();
  const { displayPrefs } = state;
  const [minutesInput, setMinutesInput] = useState(String(displayPrefs.inactivityMinutes));

  async function persist(next: DisplayPrefs) {
    dispatch({ type: "SET_DISPLAY_PREFS", payload: next });
    await saveDisplayPrefs(next).catch(() => {});
  }

  async function toggleInactivity() {
    await persist({ ...displayPrefs, inactivityEnabled: !displayPrefs.inactivityEnabled });
  }

  async function commitMinutes() {
    const clamped = clampInactivityMinutes(parseInt(minutesInput, 10));
    setMinutesInput(String(clamped));
    await persist({ ...displayPrefs, inactivityMinutes: clamped });
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="bg-bg-card rounded-xl p-4 border border-border">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-text">Inactivity</div>
          <button
            role="switch"
            aria-checked={displayPrefs.inactivityEnabled}
            onClick={toggleInactivity}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
              displayPrefs.inactivityEnabled ? "bg-primary" : "bg-border"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                displayPrefs.inactivityEnabled ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-text-muted mt-1">
          Warn me when a timer keeps running while I'm away from the computer.
        </p>
        {displayPrefs.inactivityEnabled && (
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-text-muted">Warn after</span>
            <input
              type="number"
              min={INACTIVITY_MIN_MINUTES}
              max={INACTIVITY_MAX_MINUTES}
              value={minutesInput}
              onChange={(e) => setMinutesInput(e.target.value)}
              onBlur={commitMinutes}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-16 px-2 py-1 text-sm bg-bg border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <span className="text-xs text-text-muted">minutes of inactivity</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ListSettings() {
  const { state, dispatch } = useApp();
  const { displayPrefs } = state;

  async function persist(next: DisplayPrefs) {
    dispatch({ type: "SET_DISPLAY_PREFS", payload: next });
    await saveDisplayPrefs(next).catch(() => {});
  }

  async function setAutoCollapse(mode: ListAutoCollapse) {
    if (mode === displayPrefs.listAutoCollapse) return;
    await persist({ ...displayPrefs, listAutoCollapse: mode });
  }

  async function toggleGroupByWeek() {
    await persist({ ...displayPrefs, listGroupByWeek: !displayPrefs.listGroupByWeek });
  }

  const collapseOptions: { value: ListAutoCollapse; label: string; hint: string }[] = [
    { value: "off", label: "Never", hint: "All expanded" },
    { value: "days", label: "Past days", hint: "Today expanded" },
    { value: "weeks", label: "Past weeks", hint: "This week expanded" },
  ];

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="bg-bg-card rounded-xl p-4 border border-border">
        <div className="text-sm font-medium text-text">Collapse entries</div>
        <p className="text-xs text-text-muted mt-1 mb-3">
          Which entries start collapsed to a single line. You can still expand or collapse any card
          by hand.
        </p>
        <div className="flex rounded-full border border-border overflow-hidden">
          {collapseOptions.map((opt) => {
            const active = displayPrefs.listAutoCollapse === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setAutoCollapse(opt.value)}
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
          {collapseOptions.map((opt) => (
            <div
              key={opt.value}
              className={`flex-1 text-center text-[10px] ${
                displayPrefs.listAutoCollapse === opt.value ? "text-text" : "text-text-muted"
              }`}
            >
              {opt.hint}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-bg-card rounded-xl p-4 border border-border">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-text">Group by week</div>
          <button
            role="switch"
            aria-checked={displayPrefs.listGroupByWeek}
            aria-label="Group the day list by week"
            onClick={toggleGroupByWeek}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
              displayPrefs.listGroupByWeek ? "bg-primary" : "bg-border"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                displayPrefs.listGroupByWeek ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-text-muted mt-1">
          Add a heading with the week's total whenever a new week starts in the list.
        </p>
      </div>
    </div>
  );
}

function FlexSettings() {
  const { state, dispatch, resync } = useApp();
  const { flexConfig } = state;

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
  const [resetMonths, setResetMonths] = useState<string[]>(flexConfig?.resetMonths ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Selectable reset months: first counted month (after the paycheck month)
  // through the current month
  function resetMonthOptions(): string[] {
    if (!paycheckMonth) return [];
    const [y, m] = paycheckMonth.split("-").map(Number);
    const cursor = new Date(y, m, 1); // month after paycheck month
    const current = new Date();
    const currentKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;
    const options: string[] = [];
    for (let i = 0; i < 48; i++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      if (key > currentKey) break;
      options.push(key);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return options;
  }

  function toggleResetMonth(key: string) {
    setResetMonths((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
  }

  async function handleSave() {
    const hours = parseFloat(initialHours);
    if (!paycheckMonth || isNaN(hours)) return;

    setSaving(true);
    const startDate = monthToLastDay(paycheckMonth);
    const config: FlexConfig = {
      startDate,
      initialHours: hours,
      resetMonths: [...resetMonths].sort(),
    };
    try {
      await saveFlexConfig(config);
      dispatch({ type: "SET_FLEX_CONFIG", payload: config });
      // The pre-window entries (flexEntries) were fetched for the old start
      // date — reload so an earlier start date gets its entries
      resync();
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
      {/* Balance config */}
      <div className="bg-bg-card rounded-xl p-4 border border-border space-y-3">
        <h3 className="text-sm font-semibold text-text">Flex balance</h3>
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
      </div>

      {/* Reset config */}
      <div className="bg-bg-card rounded-xl p-4 border border-border space-y-3">
        <h3 className="text-sm font-semibold text-text">Flex resets</h3>
        <div>
          <p className="text-[10px] text-text-muted mb-1.5">
            At the end of a reset month, flex above 50h is paid out and the balance is floored to
            50h. Usually quarterly (Mar, Jun, Sep, Dec).
          </p>
          <div className="flex flex-wrap gap-1.5">
            {resetMonthOptions().map((key) => {
              const active = resetMonths.includes(key);
              const label = new Date(key + "-15T12:00:00").toLocaleDateString("en-US", {
                month: "short",
                year: "2-digit",
              });
              return (
                <button
                  key={key}
                  onClick={() => toggleResetMonth(key)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    active
                      ? "bg-primary text-white border-primary"
                      : "bg-transparent text-text-muted border-border hover:text-text"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving || !paycheckMonth}
        className="w-full py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {saved ? "Saved!" : saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
