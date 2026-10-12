"use client";

import { ChevronDown } from "lucide-react";
import { useUpdateStatus } from "@/modules/feature-requests/hooks/mutations";
import { STATUS_COLORS, STATUS_TRANSITIONS } from "@/modules/feature-requests/lib/constants";
import type { Status } from "@/modules/feature-requests/types";
import { Badge } from "@/modules/shared/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/modules/shared/components/ui/dropdown-menu";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";
import { cn } from "@/modules/shared/lib/utils";

interface StatusControlProps {
  requestId: string;
  currentStatus: Status;
}

function formatStatus(status: Status): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function StatusControl({ requestId, currentStatus }: StatusControlProps) {
  const { hasPermission } = usePermissions();
  const updateStatus = useUpdateStatus();

  if (!hasPermission("feature_requests.manage")) return null;

  const transitions = STATUS_TRANSITIONS[currentStatus];

  return (
    <div className="space-y-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={updateStatus.isPending}
            aria-label={`Change status from ${formatStatus(currentStatus)}`}
            className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-wait"
          >
            <Badge
              className={cn(
                "cursor-pointer px-2.5 py-1 text-xs font-medium shadow-sm transition-opacity hover:opacity-90",
                STATUS_COLORS[currentStatus],
                updateStatus.isPending && "opacity-60",
              )}
            >
              {formatStatus(currentStatus)}
              <ChevronDown className="h-3 w-3" />
            </Badge>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="min-w-40">
          {transitions.map((targetStatus) => (
            <DropdownMenuItem
              key={targetStatus}
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ id: requestId, status: targetStatus })}
              className="justify-between gap-3"
            >
              <span className="text-sm">{formatStatus(targetStatus)}</span>
              <span
                className={cn(
                  "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  STATUS_COLORS[targetStatus],
                )}
              >
                {formatStatus(targetStatus)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {updateStatus.isError && (
        <p className="text-xs text-destructive mt-1">
          {updateStatus.error?.message ?? "Status update failed"}
        </p>
      )}
    </div>
  );
}
