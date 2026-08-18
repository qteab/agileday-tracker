import { useLiveFlex } from "../hooks/useLiveFlex";
import { formatFlexMinutes } from "../utils/flex";

interface FlexBadgeProps {
  onClick: () => void;
}

export function FlexBadge({ onClick }: FlexBadgeProps) {
  const { flex } = useLiveFlex();

  if (!flex) return null;

  const isPositive = flex.totalMinutes >= 0;

  return (
    <button
      onClick={onClick}
      className={`h-8 flex items-center text-sm font-medium tabular-nums transition-colors ${
        isPositive ? "text-emerald-600" : "text-danger"
      } hover:opacity-70`}
      title="Flex balance (live, includes today)"
    >
      {formatFlexMinutes(flex.totalMinutes)}
    </button>
  );
}
