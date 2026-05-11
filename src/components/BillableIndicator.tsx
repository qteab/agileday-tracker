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
      className={`inline-flex items-center justify-center text-xs font-medium shrink-0 ${
        billable ? "text-primary/70" : "text-text-muted/15"
      } ${className}`}
      title={label}
    >
      $
    </span>
  );
}
