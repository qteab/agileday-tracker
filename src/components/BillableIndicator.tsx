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
      className={`relative group inline-flex items-center justify-center w-[22px] h-[22px] rounded-[4px] font-bold text-sm shrink-0 cursor-default ${
        billable ? "text-primary" : "text-billable-off"
      } ${className}`}
    >
      $
      <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-xs font-medium text-bg-card bg-bg-dark rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        {label}
      </span>
    </span>
  );
}
