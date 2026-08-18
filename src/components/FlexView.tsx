import { useApp } from "../store/context";
import { formatFlexMinutes, type FlexWeek, type MonthSummary } from "../utils/flex";
import { useLiveFlex } from "../hooks/useLiveFlex";
import { MonthProgressCard } from "./MonthProgressCard";

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
  onOpenSettings: () => void;
}

/** Dedicated flex view: live balance, month progress, and weekly breakdown. */
export function FlexView({ onBack, onOpenSettings }: FlexViewProps) {
  const { state } = useApp();
  const { flexConfig } = state;
  const { flex, month, lastMonth, now } = useLiveFlex();

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
        <span className="text-sm font-semibold text-text">Flex</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {!flexConfig ? (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-text-muted">
              Set your paycheck month and initial balance to start tracking flex.
            </p>
            <button
              onClick={onOpenSettings}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              Open flex settings
            </button>
          </div>
        ) : (
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
                          <span className="text-text-muted">Before today</span>
                          <span
                            className={`tabular-nums ${
                              flex.baseMinutes >= 0 ? "text-emerald-600" : "text-danger"
                            }`}
                          >
                            {formatFlexMinutes(flex.baseMinutes)}
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

            {/* This month: worked vs target */}
            <MonthProgressCard month={month} now={now} />

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

function LastMonthCard({ summary }: { summary: MonthSummary }) {
  const monthLabel = new Date(summary.monthStart + "T12:00:00").toLocaleDateString("en-US", {
    month: "long",
  });
  const deltaPositive = summary.deltaMinutes >= 0;

  return (
    <div className="bg-bg-card rounded-xl p-4 border border-border">
      <h3 className="text-sm font-semibold text-text mb-3">Last month — {monthLabel}</h3>
      <div className="space-y-1 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Worked</span>
          <span className="font-semibold tabular-nums text-text">
            {formatHM(summary.workedMinutes)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Target</span>
          <span className="tabular-nums text-text">
            {formatHM(summary.expectedMinutes)}
            <span className="text-text-muted"> · {summary.workdays} days</span>
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Flex in</span>
          <span className="tabular-nums text-text">{formatFlexMinutes(summary.flexInMinutes)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Flex out</span>
          <span className="tabular-nums text-text">
            {formatFlexMinutes(summary.flexOutMinutes)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Change</span>
          <span
            className={`font-semibold tabular-nums ${
              deltaPositive ? "text-emerald-600" : "text-danger"
            }`}
          >
            {formatFlexMinutes(summary.deltaMinutes)}
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
