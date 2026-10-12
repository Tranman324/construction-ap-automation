"use client";

import { CheckCircle2, FileText } from "lucide-react";

import {
  canEditClassificationStatus,
  canEditOpensAs,
  deriveDocumentTypeStatus,
  getAssociation,
  getAssociationLabel,
  getSurfaceTone,
} from "@/modules/accounting/modules/invoices/components/settings/documentTypesModel";
import type {
  ClassificationAssociation,
  ClassificationInfo,
} from "@/modules/accounting/modules/invoices/types/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";
import { cn } from "@/modules/shared/lib/utils";

const STATUS_LABELS = {
  active: "Active",
  disabled: "Disabled",
  "needs-input": "Needs Input",
};
const INVOICE_LOCK_REASON = "Invoice must use Invoice Workflow for Spectrum submission.";

export function DestinationCell({
  row,
  associations,
  pending,
  onChange,
}: {
  row: ClassificationInfo;
  associations: readonly ClassificationAssociation[];
  pending: boolean;
  onChange: (opensAs: string) => void;
}) {
  if (!canEditOpensAs(row)) {
    return (
      <button
        type="button"
        aria-label={`${row.label} opens as`}
        disabled
        title={row.name === "invoice" ? INVOICE_LOCK_REASON : undefined}
        className={cn("inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold", toneClasses(row.opensAs))}
      >
        <DestinationIcon opensAs={row.opensAs} />
        <span className="truncate">{getAssociationLabel(associations, row.opensAs)}</span>
      </button>
    );
  }

  const selected = getAssociation(associations, row.opensAs);
  return (
    <Select value={row.opensAs ?? ""} disabled={pending} onValueChange={onChange}>
      <SelectTrigger
        aria-label={`${row.label} opens as`}
        className={cn("h-8 w-full", row.opensAs === null && "border-amber-500/70 bg-amber-500/10")}
      >
        <SelectValue placeholder="Choose destination...">{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {associations.map((association) => (
          <SelectItem key={association.key} value={association.key}>
            <span className="flex flex-col items-start">
              <span className="font-medium">{association.label}</span>
              <span className="text-xs text-muted-foreground">{association.description}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StatusControl({
  row,
  pending,
  onToggle,
}: {
  row: ClassificationInfo;
  pending: boolean;
  onToggle: () => void;
}) {
  const status = deriveDocumentTypeStatus(row);
  const interactive = canEditClassificationStatus(row) && status !== "needs-input";
  const className = cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold", statusClasses(status));

  if (!interactive) return <span className={className}>{STATUS_LABELS[status]}</span>;
  return (
    <button type="button" className={className} disabled={pending} aria-label={`${row.label} status`} onClick={onToggle}>
      {STATUS_LABELS[status]}
    </button>
  );
}

function DestinationIcon({ opensAs }: { opensAs: string | null }) {
  return getSurfaceTone(opensAs) === "invoice" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />;
}

function toneClasses(opensAs: string | null): string {
  const tone = getSurfaceTone(opensAs);
  if (tone === "invoice") return "border-primary/25 bg-primary/10 text-primary";
  if (tone === "document") return "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "border-border bg-muted text-muted-foreground";
}

function statusClasses(status: ReturnType<typeof deriveDocumentTypeStatus>): string {
  if (status === "active") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "disabled") return "bg-muted text-muted-foreground";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
}
