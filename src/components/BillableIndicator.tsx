import type { ProjectType } from "../api/types";

export function isBillableProjectType(type: ProjectType | undefined): boolean {
  return type === "EXTERNAL";
}

interface BillableIndicatorProps {
  projectType: ProjectType | undefined;
  className?: string;
}

export function BillableIndicator({ projectType, className = "" }: BillableIndicatorProps) {
  if (!projectType) return null;
  const billable = isBillableProjectType(projectType);
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
