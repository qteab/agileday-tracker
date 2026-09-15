import type { LoadingProgress } from "../store/reducer";

/**
 * Full-panel loading indicator.
 *
 * The MCP backend reads one week per request, so a wide window takes long
 * enough that a bare "Loading..." leaves the user unable to tell slow from
 * stuck. When the caller knows how much work is left the ring fills to match;
 * otherwise it sweeps.
 */

export const SIZE = 96;
const STROKE = 6;
const RADIUS = (SIZE - STROKE) / 2;
export const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Arc length shown while sweeping: a quarter circle reads clearly as motion. */
const INDETERMINATE_ARC = 0.75;

export interface RingGeometry {
  /** True when the caller supplied a usable total and the ring can fill. */
  determinate: boolean;
  /** Whole-percent complete, 0 when indeterminate. */
  percent: number;
  /** SVG `stroke-dashoffset` for the progress arc. */
  dashOffset: number;
}

/**
 * Ring geometry for a progress value.
 *
 * Kept pure and separate from the markup so the edge cases — a zero total, a
 * step count that overshoots, a negative — are checkable without a DOM.
 */
export function ringGeometry(progress?: LoadingProgress | null): RingGeometry {
  const total = progress?.total ?? 0;
  const current = progress?.current ?? 0;
  // A non-finite or non-positive total can't describe progress; sweep instead
  // of dividing by it.
  const determinate = Number.isFinite(total) && total > 0 && Number.isFinite(current);

  if (!determinate) {
    return {
      determinate: false,
      percent: 0,
      dashOffset: CIRCUMFERENCE * INDETERMINATE_ARC,
    };
  }

  // Clamp: a miscounted step must never render a ring that overshoots.
  const fraction = Math.min(1, Math.max(0, current / total));
  return {
    determinate: true,
    percent: Math.round(fraction * 100),
    dashOffset: CIRCUMFERENCE * (1 - fraction),
  };
}

export function LoadingState({ progress }: { progress?: LoadingProgress | null }) {
  const { determinate, percent, dashOffset } = ringGeometry(progress);
  const current = progress?.current ?? 0;
  const total = progress?.total ?? 0;

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className={determinate ? "-rotate-90" : "animate-spin"}
          aria-hidden="true"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            // Determinate: the arc length is the progress. Indeterminate: a
            // fixed quarter-circle, spun by the wrapper's animation.
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            style={determinate ? { transition: "stroke-dashoffset 300ms ease-out" } : undefined}
          />
        </svg>

        {determinate && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-semibold text-text tabular-nums">{percent}%</span>
          </div>
        )}
      </div>

      <div className="space-y-1 max-w-[260px]">
        <p className="text-sm font-medium text-text">{progress?.message ?? "Loading"}</p>
        {determinate && (
          <p className="text-xs text-text-muted tabular-nums">
            {current} of {total}
          </p>
        )}
      </div>
    </div>
  );
}
