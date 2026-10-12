"use client";

import { useState } from "react";
import { Eye, Unlink } from "lucide-react";
import { PanelNotice } from "../documents/PanelNotice";

import { CommentPopoverHost } from "@/modules/accounting/modules/invoices/components/activity/CommentPopoverHost";
import type { CollaborationRouteFamily } from "@/modules/accounting/modules/invoices/hooks/collaborationRoutes";
import { ManualWaiverPairingList } from "@/modules/accounting/modules/invoices/components/invoices/ManualWaiverPairingList";
import { useLinkWaiver, useUnlinkWaiver } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useInvoiceOrphanWaivers, DEFAULT_MAPPINGS } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useOrphanCandidateFilters } from "@/modules/accounting/modules/invoices/hooks/useOrphanCandidateFilters";
import {
  APPROVED_INVOICE_LINKAGE_REASON,
  isWaiverParentStatusProtectedError,
  mutationErrorMessage,
} from "@/modules/accounting/modules/invoices/lib/mutationErrorMessage";
import { toast } from "@/modules/shared/components/ui/toaster";
import { usesInvoiceWorkflow } from "@/modules/accounting/modules/invoices/lib/documentRouting";
import { isManualWaiverLinkingAvailable } from "@/modules/accounting/modules/invoices/lib/waiverGate";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";
import type { DocumentAction } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface WaiverPairingSectionProps {
  invoice: Invoice;
  compact?: boolean;
  compactActions?: readonly DocumentAction[];
  classificationMappings?: readonly ClassificationInfo[];
  canComment?: boolean;
  readOnly?: boolean;
  routeFamily?: CollaborationRouteFamily;
}

function openWaiver(waiverId: string) {
  window.open(`/accounting/documents/${waiverId}`, "_blank");
}

export function WaiverPairingSection({
  invoice,
  compact = false,
  compactActions = [],
  classificationMappings = DEFAULT_MAPPINGS,
  canComment = false,
  readOnly = false,
  routeFamily = "invoice",
}: WaiverPairingSectionProps) {
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const isInvoice = usesInvoiceWorkflow(invoice.classification, classificationMappings);
  const linkingAvailable = isManualWaiverLinkingAvailable(invoice);
  const candidateFilters = useOrphanCandidateFilters();
  const pairingQuery = useInvoiceOrphanWaivers(
    invoice.id,
    candidateFilters.params,
    isInvoice && (linkingAvailable || Boolean(invoice.linkedLienWaiverId)),
  );
  const linkWaiver = useLinkWaiver();
  const unlinkWaiver = useUnlinkWaiver();
  const paired = pairingQuery.data?.paired ?? null;

  if (!isInvoice) return null;

  function linkWaiverToInvoice(waiverId: string) {
    setLinkError(null);
    setLinkingId(waiverId);
    linkWaiver.mutate(
      { invoiceId: invoice.id, waiverId },
      {
        onSuccess: () => setLinkingId(null),
        onError: (error) => {
          if (isWaiverParentStatusProtectedError(error)) {
            toast.error(error.message);
            setLinkingId(null);
            return;
          }
          setLinkError(mutationErrorMessage(error, "Unable to link this waiver right now."));
          setLinkingId(null);
        },
      },
    );
  }

  function unlinkWaiverFromInvoice() {
    if (!paired) return;
    unlinkWaiver.mutate(
      { invoiceId: invoice.id, waiverId: paired.id },
      { onError: (error) => {
        if (isWaiverParentStatusProtectedError(error)) toast.error(error.message);
      } },
    );
  }

  if (compact) {
    const actions: DocumentAction[] = paired
      ? [
          ...compactActions,
          { id: "view-linked-waiver", label: "View Waiver", icon: Eye, onClick: () => openWaiver(paired.id) },
          {
            id: "unlink-waiver",
            label: "Unlink Waiver",
            icon: Unlink,
            tone: "destructive",
            disabled: invoice.status === "submitted" || invoice.status === "approved",
            disabledReason: invoice.status === "approved" ? APPROVED_INVOICE_LINKAGE_REASON : undefined,
            pending: unlinkWaiver.isPending,
            onClick: unlinkWaiverFromInvoice,
          },
        ]
      : [...compactActions];
    return <CommentPopoverHost documentId={invoice.id} routeFamily={routeFamily} actions={actions} canComment={canComment && !readOnly} />;
  }

  const pairingError = pairingQuery.isError ? mutationErrorMessage(pairingQuery.error, "Unable to load lien waivers.") : linkError;
  const pairingList = (
      <ManualWaiverPairingList
        candidates={pairingQuery.data?.waivers ?? []}
        paired={paired}
        loading={pairingQuery.isLoading}
        error={pairingError}
        candidateLabel="Lien Waivers"
        pairedLabel="Lien Waiver"
        query={candidateFilters.query}
        page={pairingQuery.data?.page ?? candidateFilters.page}
        total={pairingQuery.data?.total ?? 0}
        limit={pairingQuery.data?.limit ?? 10}
        onQueryChange={candidateFilters.setQuery}
        onPageChange={candidateFilters.setPage}
        canUnlink={invoice.status !== "submitted"}
        linkPendingId={linkingId}
        unlinkPending={unlinkWaiver.isPending}
        onLink={linkWaiverToInvoice}
        onUnlink={unlinkWaiverFromInvoice}
        onViewCandidate={openWaiver}
        onViewPaired={openWaiver}
        linkDisabledReason={invoice.status === "approved" ? () => APPROVED_INVOICE_LINKAGE_REASON : undefined}
        unlinkDisabledReason={invoice.status === "approved" ? APPROVED_INVOICE_LINKAGE_REASON : undefined}
        linkingAvailable={linkingAvailable}
        unavailableMessage="Lien waiver linking is not needed for this invoice."
      />
  );

  return (
    <section className="space-y-3 px-4 py-3" aria-label="Lien waiver pairing">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Lien Waiver</h2>
        <p className="mt-1 text-xs text-muted-foreground">Choose a waiver explicitly; the server prioritizes candidates and owns pairing policy.</p>
      </div>
      {/* Match the list's existing paired/unavailable/loading/error precedence. */}
      {!paired && linkingAvailable && !pairingQuery.isLoading && pairingError ? (
        <PanelNotice id="waiver-pairing-error" label="Lien waiver pairing failed" tabId="waiver">
          {pairingList}
        </PanelNotice>
      ) : pairingList}
      {paired && invoice.waiverLinkSource && (
        <p className="text-xs text-muted-foreground">
          {invoice.waiverLinkSource === "request-thread"
            ? "Auto-linked from waiver request thread."
            : invoice.waiverLinkSource === "email-thread"
              ? "Auto-linked from email thread."
              : "Manually linked."}
        </p>
      )}
    </section>
  );
}
