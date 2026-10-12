import { Badge } from "@/modules/shared/components/ui/badge";
import { cn } from "@/modules/shared/lib/utils";

interface StatusConfig {
  label: string;
  tone: string;
  pulse?: boolean;
}

const statusConfig: Record<string, StatusConfig> = {
  pending: { label: "Pending", tone: "pending" },
  approved: { label: "Approved", tone: "active" },
  submitted: { label: "Submitted", tone: "complete" },
  "needs-split": { label: "Needs Split", tone: "draft" },
  modified: { label: "Modified", tone: "info" },
  rejected: { label: "Rejected", tone: "overdue" },
  discarded: { label: "Discarded", tone: "muted" },
  "retry-pending": { label: "Retry Pending", tone: "pending" },
  duplicate: { label: "Duplicate", tone: "muted" },
  reviewed: { label: "Reviewed", tone: "complete" },
  "split-processing": { label: "Processing", tone: "info", pulse: true },
  split: { label: "Split", tone: "muted" },
};

interface StatusBadgeProps {
  status: string;
  wasModified?: boolean;
}

function humanizeStatus(status: string): string {
  return status
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StatusBadge({ status, wasModified }: StatusBadgeProps) {
  const config = statusConfig[status] ?? {
    label: humanizeStatus(status),
    tone: "muted",
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge
        variant="outline"
        className={cn("tbx-status-pill", `tbx-status-pill--${config.tone}`)}
        title={config.label}
      >
        <span
          aria-hidden="true"
          className={cn("tbx-status-pill__dot", config.pulse && "is-pulsing")}
        />
        {config.label}
      </Badge>
      {wasModified && (
        <span className="text-3xs font-medium text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5 leading-none">
          edited
        </span>
      )}
    </span>
  );
}
