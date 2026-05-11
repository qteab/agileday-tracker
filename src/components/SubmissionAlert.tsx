import { useState, useEffect, useMemo } from "react";
import { getUnsubmittedWeeks, getAlertLevel, type AlertLevel } from "../utils/week";
import type { TimeEntry } from "../api/types";

interface SubmissionAlertProps {
  entries: TimeEntry[];
  onOpenFinalize: () => void;
}

const ALERT_CONFIG: Record<AlertLevel, { bg: string; text: string; border: string }> = {
  info: { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20" },
  warning: { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-200" },
  overdue: { bg: "bg-danger/10", text: "text-danger", border: "border-danger/20" },
};

function buildMessage(weekCount: number, level: AlertLevel): string {
  const subject =
    weekCount === 1
      ? "Last week's timesheet hasn't been submitted."
      : `${weekCount} weeks have unsubmitted timesheets.`;

  const suffix = {
    info: " Deadline: Monday 12:00.",
    warning: " Less than 1 hour until deadline.",
    overdue: " Deadline passed — submit ASAP.",
  }[level];

  return subject + suffix;
}

export function SubmissionAlert({ entries, onOpenFinalize }: SubmissionAlertProps) {
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Re-check every minute to catch 11:00 and 12:00 transitions
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const unsubmittedWeeks = useMemo(() => getUnsubmittedWeeks(entries, now), [entries, now]);
  const alertLevel = useMemo(() => getAlertLevel(now), [now]);

  if (dismissed || unsubmittedWeeks.length === 0) return null;

  const config = ALERT_CONFIG[alertLevel];
  const message = buildMessage(unsubmittedWeeks.length, alertLevel);

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 text-xs border-b ${config.bg} ${config.text} ${config.border}`}
    >
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        {alertLevel === "info" ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        )}
      </svg>
      <span className="flex-1">{message}</span>
      <button
        onClick={onOpenFinalize}
        className="px-3 py-1 text-[10px] font-semibold rounded-lg bg-white text-text shadow-sm hover:bg-bg transition-colors"
      >
        Finalize
      </button>
      <button onClick={() => setDismissed(true)} className="hover:opacity-70 transition-opacity">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
