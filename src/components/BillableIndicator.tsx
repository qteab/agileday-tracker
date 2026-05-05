interface BillableIndicatorProps {
  billable: boolean | undefined;
  className?: string;
}

export function BillableIndicator({ billable, className = "" }: BillableIndicatorProps) {
  if (billable === undefined) return null;
  const label = billable ? "Billable" : "Non-billable";

  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] shrink-0 ${
        billable ? "bg-primary text-white" : "bg-bg text-text-muted/60"
      } ${className}`}
    >
      $
    </span>
  );
}
