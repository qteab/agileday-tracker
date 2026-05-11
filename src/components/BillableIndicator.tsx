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
      className={`relative group inline-flex items-center justify-center text-xs font-medium shrink-0 ${
        billable ? "text-primary/70" : "text-text-muted/15"
      } ${className}`}
    >
      $
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 rounded bg-text text-white text-[10px] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity">
        {label}
      </span>
    </span>
  );
}
