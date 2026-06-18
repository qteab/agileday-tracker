import { useEffect } from "react";
import { useApp } from "../store/context";
import { formatAway, computeDiscardStartTime } from "../utils/inactivity";

const WARN_ICON = (
  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

/**
 * Shown below the project/task dropdowns. While the user is away it reports the
 * idle duration; on return it becomes a persistent Discard/Keep prompt for the
 * away time. Detection is driven by Rust (see `useInactivitySync`).
 */
export function InactivityBanner() {
  const { state, dispatch } = useApp();
  const { inactivity, timer, displayPrefs } = state;
  const pending = inactivity.pendingReturn;

  // Turning the feature off clears any unresolved prompt (treated as Keep).
  useEffect(() => {
    if (!displayPrefs.inactivityEnabled && pending) {
      dispatch({ type: "RESOLVE_RETURN" });
    }
  }, [displayPrefs.inactivityEnabled, pending, dispatch]);

  if (pending) {
    const discard = () => {
      if (timer.startTime) {
        dispatch({
          type: "SET_TIMER",
          payload: { startTime: computeDiscardStartTime(timer.startTime, pending.awaySeconds) },
        });
      }
      dispatch({ type: "RESOLVE_RETURN" });
    };
    const keep = () => dispatch({ type: "RESOLVE_RETURN" });

    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-t border-amber-200">
        <span className="text-xs text-amber-800 flex-1">
          You were away {formatAway(pending.awaySeconds)}
        </span>
        <button
          onClick={discard}
          className="px-3 py-1 text-xs font-medium text-white bg-danger rounded-lg hover:bg-danger/90 transition-colors"
        >
          Discard
        </button>
        <button
          onClick={keep}
          className="px-3 py-1 text-xs font-medium text-amber-800 bg-amber-100 rounded-lg hover:bg-amber-200 transition-colors"
        >
          Keep
        </button>
      </div>
    );
  }

  if (inactivity.isAway) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-amber-700 bg-amber-50">
        {WARN_ICON}
        <span>Inactive for {formatAway(inactivity.idleSeconds)}</span>
      </div>
    );
  }

  return null;
}
