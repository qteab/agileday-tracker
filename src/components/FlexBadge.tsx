import { useMemo } from "react";
import { useApp } from "../store/context";
import { calculateFlex, formatFlexMinutes } from "../utils/flex";

interface FlexBadgeProps {
  onClick: () => void;
}

export function FlexBadge({ onClick }: FlexBadgeProps) {
  const { state } = useApp();
  const { flexConfig, entries, flexEntries, holidays } = state;

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

  if (!flexConfig || !flex) return null;

  const isPositive = flex.totalMinutes >= 0;

  return (
    <button
      onClick={onClick}
      className={`text-xs font-medium tabular-nums transition-colors ${
        isPositive ? "text-emerald-600" : "text-danger"
      } hover:opacity-70`}
      title="Flex balance (through yesterday)"
    >
      {formatFlexMinutes(flex.totalMinutes)}
    </button>
  );
}
