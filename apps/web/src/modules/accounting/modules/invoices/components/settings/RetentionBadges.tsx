"use client";

import { Asterisk } from "lucide-react";

import {
  classificationLabel,
  isWildcardClassification,
  statusLabel,
  STATUS_TONES,
} from "@/modules/accounting/modules/invoices/components/settings/retentionPolicyModel";
import { Badge } from "@/modules/shared/components/ui/badge";
import { cn } from "@/modules/shared/lib/utils";

const STATUS_CLASSES: Record<NonNullable<(typeof STATUS_TONES)[string]>, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  primary: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
  info: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
};

export function RetentionClassificationBadge({
  classification,
  wildcardLabel,
  labels = {},
}: {
  classification: string;
  wildcardLabel?: string;
  labels?: Record<string, string>;
}) {
  const wildcard = isWildcardClassification(classification);
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold",
        wildcard && "border-primary/30 bg-primary/10 text-primary",
      )}
    >
      {wildcard ? <Asterisk className="h-3 w-3" aria-hidden="true" /> : null}
      {classificationLabel(classification, labels, wildcardLabel)}
    </Badge>
  );
}

export function RetentionStatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  const tone = STATUS_TONES[status] ?? "muted";
  return (
    <Badge variant="outline" className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_CLASSES[tone])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {statusLabel(status, labels)}
    </Badge>
  );
}
