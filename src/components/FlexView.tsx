import { useApp } from "../store/context";
import {
  formatFlexMinutes,
  RESET_CAP_MINUTES,
  type FlexWeek,
  type MonthSummary,
} from "../utils/flex";
import { formatVacationDays, type VacationResult } from "../utils/vacation";
import { useLiveFlex } from "../hooks/useLiveFlex";
import { useVacation } from "../hooks/useVacation";
import { MonthProgressCard } from "./MonthProgressCard";
import type { SettingsPage } from "./SettingsView";

function formatHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** First counted day (day after the stored start date), e.g. "Sep 1" */
function flexStartLabel(startDate: string): string {
  const d = new Date(startDate + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface FlexViewProps {
  onBack: () => void;
  onOpenSettings: (page: SettingsPage) => void;
}

/** Dedicated flex view: live balance, vacation days, month progress, and weekly breakdown. */
export function FlexView({ onBack, onOpenSettings }: FlexViewProps) {
  const { state } = useApp();
  const { flexConfig, vacationConfig } = state;
  const { flex, month, lastMonth, now } = useLiveFlex();
  const vacation = useVacation();

  // In a reset month, flex above the cap is paid out at month end
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const payoutMinutes =
    flex && flexConfig?.resetMonths?.includes(monthKey)
      ? Math.max(0, flex.totalMinutes - RESET_CAP_MINUTES)
      : 0;

  const vacationSection =
    vacationConfig && vacation ? (
      <VacationCard vacation={vacation} onConfigure={() => onOpenSettings("vacation")} />
    ) : (
      <button
        onClick={() => onOpenSettings("vacation")}
        className="w-full text-left bg-bg-card rounded-xl p-4 border border-dashed border-border hover:bg-bg transition-colors"
      >
        <span className="text-sm font-medium text-text">Track vacation days</span>
        <p className="text-xs text-text-muted mt-1">
          Enter the balance from your latest payslip and pick the vacation project to count down
          your remaining days.
        </p>
      </button>
    );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header with back button and settings link */}
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
        <span className="flex-1 text-sm font-semibold text-text">Flex</span>
        <button
          onClick={() => onOpenSettings("flex")}
          className="px-2.5 py-1 text-xs font-medium text-text-muted border border-border rounded-lg hover:text-text hover:bg-bg transition-colors"
        >
          Configure flex settings
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {!flexConfig && (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-text-muted">
              Set your paycheck month and initial balance to start tracking flex.
            </p>
            <button
              onClick={() => onOpenSettings("flex")}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              Open flex settings
            </button>
            <div className="text-left pt-4">{vacationSection}</div>
          </div>
        )}
        {flexConfig && (
          <>
            {/* Live balance: big number left, today/yesterday detail right */}
            {flex && (
              <div className="bg-bg-card rounded-xl p-4 border border-border">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-muted">Flex balance</div>
                    <div
                      className={`text-3xl font-bold tabular-nums mt-1 ${
                        flex.totalMinutes >= 0 ? "text-emerald-600" : "text-danger"
                      }`}
                    >
                      {formatFlexMinutes(flex.totalMinutes)}
                    </div>
                  </div>
                  <div className="flex-1 space-y-1 text-sm border-l border-border pl-4">
                    {flex.countsToday ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Today</span>
                          <span className="font-semibold tabular-nums text-text">
                            {formatHM(flex.todayWorkedMinutes)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Expected</span>
                          <span className="tabular-nums text-text">
                            {formatHM(flex.todayExpectedMinutes)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">If you stop now</span>
                          <span
                            className={`tabular-nums ${
                              flex.endOfDayMinutes >= 0 ? "text-emerald-600" : "text-danger"
                            }`}
                          >
                            {formatFlexMinutes(flex.endOfDayMinutes)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-text-muted">
                        Counting starts {flexStartLabel(flexConfig.startDate)} — hours until then
                        are covered by your paycheck balance.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Vacation day balance */}
            {vacationSection}

            {/* This month: worked vs target */}
            <MonthProgressCard month={month} now={now} payoutMinutes={payoutMinutes} />

            {/* Last month: closed summary */}
            {lastMonth && <LastMonthCard summary={lastMonth} />}

            {/* Weekly breakdown */}
            {flex && flex.weeks.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  Weekly breakdown
                </h3>
                {[...flex.weeks].reverse().map((week) => (
                  <WeekRow key={week.startDate} week={week} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function VacationCard({
  vacation,
  onConfigure,
}: {
  vacation: VacationResult;
  onConfigure: () => void;
}) {
  return (
    <div className="bg-bg-card rounded-xl p-4 border border-border">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Vacation days</span>
            <button
              onClick={onConfigure}
              className="text-[10px] text-text-muted underline hover:text-text transition-colors"
            >
              configure
            </button>
          </div>
          <div
            className={`text-3xl font-bold tabular-nums mt-1 ${
              vacation.remainingDays >= 0 ? "text-emerald-600" : "text-danger"
            }`}
          >
            {formatVacationDays(vacation.remainingDays)}
          </div>
        </div>
        <div className="flex-1 space-y-1 text-sm border-l border-border pl-4">
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Used</span>
            <span className="tabular-nums text-text">{formatVacationDays(vacation.usedDays)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Planned</span>
            <span className="tabular-nums text-text">
              {formatVacationDays(vacation.plannedDays)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">After planned</span>
            <span
              className={`font-semibold tabular-nums ${
                vacation.remainingAfterPlanned >= 0 ? "text-emerald-600" : "text-danger"
              }`}
            >
              {formatVacationDays(vacation.remainingAfterPlanned)}
            </span>
          </div>
        </div>
      </div>
      {vacation.plannedEntries.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">
            Upcoming
          </div>
          <div className="flex flex-wrap gap-1">
            {vacation.plannedEntries.map((u) => (
              <span
                key={u.date}
                className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary tabular-nums"
              >
                {new Date(u.date + "T12:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
                {u.days !== 1 && ` · ${formatVacationDays(u.days)}d`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LastMonthCard({ summary }: { summary: MonthSummary }) {
  const monthLabel = new Date(summary.monthStart + "T12:00:00").toLocaleDateString("en-US", {
    month: "long",
  });
  const hasReset = summary.resetPayoutMinutes > 0;
  // What the month itself added, before any payout
  const monthMinutes = summary.deltaMinutes + summary.resetPayoutMinutes;
  const beforeResetMinutes = summary.flexInMinutes + monthMinutes;
  const signColor = (m: number) => (m >= 0 ? "text-emerald-600" : "text-danger");

  return (
    <div className="bg-bg-card rounded-xl p-4 border border-border">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">Last month — {monthLabel}</h3>
        <span className="text-xs tabular-nums text-text-muted">
          {formatHM(summary.workedMinutes)} / {formatHM(summary.expectedMinutes)} ·{" "}
          {summary.workdays} days
        </span>
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Opening balance</span>
          <span className="tabular-nums text-text">{formatFlexMinutes(summary.flexInMinutes)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Worked vs target</span>
          <span className={`tabular-nums ${signColor(monthMinutes)}`}>
            {formatFlexMinutes(monthMinutes)}
          </span>
        </div>
        {hasReset && (
          <>
            <div className="flex items-center justify-between border-t border-border pt-1">
              <span className="text-text-muted">Before reset</span>
              <span className="tabular-nums text-text">
                {formatFlexMinutes(beforeResetMinutes)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Reset payout</span>
              <span className="font-semibold tabular-nums text-amber-500">
                {formatFlexMinutes(summary.resetPayoutMinutes)}
              </span>
            </div>
          </>
        )}
        <div className="flex items-center justify-between border-t border-border pt-1">
          <span className="font-medium text-text">Closing balance</span>
          <span className={`font-semibold tabular-nums ${signColor(summary.flexOutMinutes)}`}>
            {formatFlexMinutes(summary.flexOutMinutes)}
          </span>
        </div>
      </div>
    </div>
  );
}

function WeekRow({ week }: { week: FlexWeek }) {
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
          {week.isOngoing && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              open
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
        <span>Expected: {formatHM(week.expectedMinutes)}</span>
        <span>Worked: {formatHM(week.workedMinutes)}</span>
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
  );
}
