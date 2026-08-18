import { formatFlexMinutes, type MonthStats } from "../utils/flex";

function formatHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Worked vs expected hours for the current month, with a circular progress diagram. */
export function MonthProgressCard({ month, now }: { month: MonthStats; now: Date }) {
  const monthLabel = now.toLocaleDateString("en-US", { month: "long" });
  const percent =
    month.expectedMinutes > 0 ? (month.workedMinutes / month.expectedMinutes) * 100 : 0;
  const paceDelta = month.workedMinutes - month.expectedToDateMinutes;
  const onPace = paceDelta >= 0;

  return (
    <div className="bg-bg-card rounded-xl p-4 border border-border">
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
