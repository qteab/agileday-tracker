interface BillableIndicatorProps {
  billable: boolean | undefined;
  className?: string;
}

export function BillableIndicator({ billable, className = "" }: BillableIndicatorProps) {
  if (billable === undefined) return null;
  const label = billable ? "Billable" : "Non-billable";

  return (
    <span
      aria-label={label}
      className={`group relative inline-flex h-[22px] w-[22px] shrink-0 cursor-default items-center justify-center rounded-[4px] text-sm font-bold ${
        billable ? "text-primary" : "text-billable-off"
      } ${className}`}
    >
      $
      <span className="pointer-events-none absolute top-full left-1/2 z-50 mt-1.5 -translate-x-1/2 rounded bg-bg-dark px-2 py-1 text-xs font-medium whitespace-nowrap text-bg-card opacity-0 transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </span>
  );
}
