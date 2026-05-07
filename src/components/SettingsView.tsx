import { useState } from "react";
import { useApp } from "../store/context";

interface SettingsViewProps {
  onBack: () => void;
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const { state, updateSettings, logout } = useApp();
  const { groupDescriptions } = state.settings;
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      {/* Header with back button */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
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

      <div className="px-4 py-4 space-y-6">
        {/* Group descriptions toggle */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
              <h3 className="text-sm font-medium text-text">Group descriptions</h3>
              <p className="text-xs text-text-muted mt-1">
                When enabled, all time entries for the same project, task, and date are merged into
                a single AgileDay entry with descriptions listed as bullet points.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={groupDescriptions}
              aria-label="Group descriptions"
              onClick={() =>
                updateSettings({ ...state.settings, groupDescriptions: !groupDescriptions })
              }
              className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${
                groupDescriptions ? "bg-primary" : "bg-border"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  groupDescriptions ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Visual comparison */}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <IllustrationCard
              label="Separate (default)"
              active={!groupDescriptions}
              lines={[
                { desc: "Code review", time: "01:01" },
                { desc: "Bug fix", time: "00:45" },
                { desc: "Meetings", time: "01:10" },
              ]}
            />
            <IllustrationCard
              label="Grouped"
              active={groupDescriptions}
              lines={[{ desc: "- Code review\n- Bug fix\n- Meetings", time: "02:56" }]}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Account / Sign out */}
        <div>
          <h3 className="text-sm font-medium text-text mb-1">Account</h3>
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
      </div>
    </div>
  );
}

function IllustrationCard({
  label,
  active,
  lines,
}: {
  label: string;
  active: boolean;
  lines: Array<{ desc: string; time: string }>;
}) {
  return (
    <div
      className={`rounded-lg border p-3 text-xs transition-colors ${
        active ? "border-primary bg-primary/5" : "border-border bg-bg"
      }`}
    >
      <div className={`font-medium mb-2 ${active ? "text-primary" : "text-text-muted"}`}>
        {label}
      </div>
      <div className="space-y-1.5">
        {lines.map((line, i) => (
          <div key={i} className="flex justify-between items-start gap-2">
            <span className="text-text-muted whitespace-pre-line leading-tight">{line.desc}</span>
            <span className="text-text shrink-0 tabular-nums">{line.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
