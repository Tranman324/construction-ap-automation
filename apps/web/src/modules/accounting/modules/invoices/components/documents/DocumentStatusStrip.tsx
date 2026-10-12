"use client";

import type { ReactNode } from "react";

import {
  DocumentAlertCountPill,
  DocumentStatPill,
} from "@/modules/accounting/modules/invoices/components/documents/DocumentAtoms";
import type { DocumentPanelHeader } from "@/modules/accounting/modules/invoices/types/documentSpec";

interface DocumentStatusStripProps {
  header: DocumentPanelHeader;
  alertCount: number;
  /** Every remaining alert is a notice: the pill reads "to review" in the notice style. */
  alertsNoticeOnly?: boolean;
  actions?: ReactNode;
  leadingContent?: ReactNode;
  onResolveClick?: () => void;
}

export function DocumentStatusStrip({
  header,
  alertCount,
  alertsNoticeOnly = false,
  actions,
  leadingContent,
  onResolveClick,
}: DocumentStatusStripProps) {
  return (
    <div className="flex min-h-10 items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
      {leadingContent ?? (
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-2xs font-semibold uppercase tracking-widest text-primary">
          {header.kindLabel}
        </span>
      )}
      {header.statusLabel && (
        <DocumentStatPill
          tone={header.statusTone ?? "neutral"}
          label={header.statusLabel}
          pulse={header.statusPulse}
        />
      )}
      {header.externalStatusLabel && (
        <DocumentStatPill
          tone={header.externalStatusTone ?? "ok"}
          label={header.externalStatusLabel}
          pulse={header.externalStatusPulse}
        />
      )}
      <div className="flex-1" />
      {alertCount > 0 && <DocumentAlertCountPill count={alertCount} noticeOnly={alertsNoticeOnly} onClick={onResolveClick} />}
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
