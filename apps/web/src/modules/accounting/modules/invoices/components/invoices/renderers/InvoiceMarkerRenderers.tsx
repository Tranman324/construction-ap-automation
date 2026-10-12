import { AlertTriangle, CheckCircle, CornerUpLeft, FlagTriangleRight, Info, MessageSquare, type LucideIcon } from "lucide-react";
import * as React from "react";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { Badge } from "@/modules/shared/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";
import { cn } from "@/modules/shared/lib/utils";

export type InvoiceMarkerTone = "amber" | "blue" | "green" | "gray" | "red" | "violet" | "cyan";

const toneClasses: Record<InvoiceMarkerTone, string> = {
  amber: "border-tone-amber/40 bg-tone-amber/10 text-tone-amber",
  blue: "border-tone-blue/30 bg-tone-blue/10 text-tone-blue",
  green: "border-tone-emerald/40 bg-tone-emerald/10 text-tone-emerald",
  gray: "border-border bg-muted/50 text-muted-foreground",
  red: "border-tone-red/40 bg-tone-red/10 text-tone-red",
  violet: "border-tone-violet/40 bg-tone-violet/10 text-tone-violet",
  cyan: "border-tone-cyan/40 bg-tone-cyan/10 text-tone-cyan",
};

export interface InvoiceAttributeChipProps {
  label: string;
  tone: InvoiceMarkerTone;
  Icon?: LucideIcon;
  title?: string;
  className?: string;
}

export function ReplyPriorityMarker({ unreadReplies = 0, unreadComments = 0 }: { unreadReplies?: number; unreadComments?: number }) {
  if (unreadReplies <= 0 && unreadComments <= 0) return null;
  const replyLabel = `${unreadReplies} unread repl${unreadReplies === 1 ? "y" : "ies"}`;
  const commentLabel = `${unreadComments} unread comment${unreadComments === 1 ? "" : "s"}`;
  const label = unreadReplies > 0 && unreadComments > 0 ? `${replyLabel}; ${commentLabel}` : unreadReplies > 0 ? replyLabel : commentLabel;
  const shownCount = unreadReplies > 0 ? unreadReplies : unreadComments;
  return (
    <span
      aria-label={label}
      title={label}
      className={cn("relative inline-flex size-6 items-center justify-center", unreadReplies > 0 ? "text-tone-amber" : "text-tone-blue")}
    >
      {unreadReplies > 0 ? <CornerUpLeft className="size-[17px]" aria-hidden="true" /> : <MessageSquare className="size-[17px]" aria-hidden="true" />}
      {shownCount > 1 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 rounded-full bg-background px-0.5 text-4xs font-semibold leading-3">{shownCount}</span>}
    </span>
  );
}

export function InvoiceAttributeChip({ label, tone, Icon, title, className }: InvoiceAttributeChipProps) {
  return (
    <Badge variant="outline" className={cn(toneClasses[tone], className)} title={title ?? label}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {label}
    </Badge>
  );
}

export interface InvoiceWaiverChipProps {
  status: Invoice["waiverStatus"];
  waiverBypassed?: boolean;
  waiverBypassedAt?: string | null;
  waiverBypassedBy?: string | null;
}

function bypassAttribution(by: string | null | undefined, at: string | null | undefined): string {
  const date = at ? new Date(at) : null;
  const formatted = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : at;
  return `Bypassed by ${by || "unknown"}${formatted ? ` · ${formatted}` : ""}`;
}

/** Five-state waiver marker driven only by the canonical served waiver status. */
export function InvoiceWaiverChip({
  status,
  waiverBypassed,
  waiverBypassedAt,
  waiverBypassedBy,
}: InvoiceWaiverChipProps) {
  if (status == null) return null;

  if (status === "attached") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
        title="Lien waiver attached"
      >
        <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Attached
      </Badge>
    );
  }

  if (status === "required") {
    return (
      <Badge
        variant="outline"
        className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
        title="Lien waiver required"
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Required
      </Badge>
    );
  }

  if (status === "requested") {
    return (
      <Badge
        variant="outline"
        className="border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
        title="Lien waiver requested"
      >
        Requested
      </Badge>
    );
  }

  if (status === "bypassed") {
    const attribution = waiverBypassed
      ? bypassAttribution(waiverBypassedBy, waiverBypassedAt)
      : "Lien waiver bypassed";
    return (
      <Badge
        variant="outline"
        className="border-border bg-muted/50 text-muted-foreground"
        title={attribution}
        aria-label={attribution}
      >
        Bypassed
      </Badge>
    );
  }

  if (status === "not-required") {
    return (
      <Badge variant="outline" className="border-border bg-muted/50 text-muted-foreground" title="Lien waiver not required">
        Not required
      </Badge>
    );
  }

  return null;
}

export interface InvoiceExceptionMarkerProps {
  label: string;
  description: string;
  tone?: Extract<InvoiceMarkerTone, "amber" | "red" | "gray">;
  Icon?: LucideIcon;
  className?: string;
}

export function InvoiceExceptionMarker({
  label,
  description,
  tone = "amber",
  Icon = Info,
  className,
}: InvoiceExceptionMarkerProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("inline-flex size-5 items-center justify-center rounded-full", toneClasses[tone], className)}
            aria-label={label}
            title={description}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface ReviewPennantProps {
  flaggedAt?: string | null;
  flagReason?: string | null;
  flaggedBy?: string | null;
  pending?: boolean;
  error?: string | null;
  onToggle?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  title?: string;
}

/** Presentational review pennant. Callers supply the timestamp-backed state and mutation. */
export function ReviewPennant({
  flaggedAt,
  flagReason,
  flaggedBy,
  pending = false,
  error,
  onToggle,
  className,
  title,
}: ReviewPennantProps) {
  const isFlagged = flaggedAt != null;
  const detail = [flagReason, flaggedBy].filter(Boolean).join(" — ");
  const tooltip = title ?? (isFlagged ? detail || "Flagged for review" : "Flag for review");

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-pressed={isFlagged}
        aria-label={isFlagged ? "Remove review flag" : "Flag for review"}
        title={tooltip}
        disabled={pending}
        onClick={onToggle}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded p-0.5 transition-colors disabled:opacity-50",
          isFlagged ? "text-red-600 hover:text-red-700 dark:text-red-500" : "text-muted-foreground/50 hover:text-muted-foreground",
          className,
        )}
      >
        <FlagTriangleRight
          className="h-[19.2px] w-[19.2px]"
          fill={isFlagged ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
