"use client";

import { useEffect, useRef, useState } from "react";

import { LienWaiverPairingList } from "@/modules/accounting/modules/invoices/components/documents/LienWaiverPairingList";
import { useLinkWaiver, useUnlinkWaiver } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useLienWaiverOrphanInvoices } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useOrphanCandidateFilters } from "@/modules/accounting/modules/invoices/hooks/useOrphanCandidateFilters";
import {
  APPROVED_INVOICE_LINKAGE_REASON,
  isWaiverParentStatusProtectedError,
  mutationErrorMessage,
} from "@/modules/accounting/modules/invoices/lib/mutationErrorMessage";
import { toast } from "@/modules/shared/components/ui/toaster";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface LienWaiverPairingPanelProps {
  record: Invoice;
  linkedInvoiceId: string | null;
  onLinkedInvoiceChange: (invoiceId: string | null) => void;
  onLinkComplete?: () => void;
  candidatesEmpty?: boolean;
  onCandidatesEmptyChange?: (empty: boolean) => void;
}

function openInvoice(invoiceId: string) {
  window.open(`/accounting/invoices/${invoiceId}`, "_blank");
}

export function LienWaiverPairingPanel({
  record,
  linkedInvoiceId,
  onLinkedInvoiceChange,
  onLinkComplete,
  candidatesEmpty = false,
  onCandidatesEmptyChange,
}: LienWaiverPairingPanelProps) {
  const activeWaiverIdRef = useRef(record.id);
  const mountedRef = useRef(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    activeWaiverIdRef.current = record.id;
  }, [record.id]);
  const linkingAvailable = record.status !== "approved" && record.status !== "discarded";
  const candidateFilters = useOrphanCandidateFilters();
  const pairingQuery = useLienWaiverOrphanInvoices(
    record.id,
    candidateFilters.params,
    linkingAvailable || linkedInvoiceId !== null,
  );
  const linkWaiver = useLinkWaiver();
  const unlinkWaiver = useUnlinkWaiver();
  const paired = pairingQuery.data?.paired ?? null;
  const hasNoCandidates = linkingAvailable && !paired && !pairingQuery.isLoading
    && !pairingQuery.isFetching && !pairingQuery.isError
    && pairingQuery.data?.invoices.length === 0;
  useEffect(() => {
    if (candidatesEmpty !== hasNoCandidates) onCandidatesEmptyChange?.(hasNoCandidates);
  }, [candidatesEmpty, hasNoCandidates, onCandidatesEmptyChange]);

  function linkInvoice(invoiceId: string) {
    const waiverId = record.id;
    setLinkError(null);
    setLinkingId(invoiceId);
    linkWaiver.mutate(
      { invoiceId, waiverId },
      {
        onSuccess: () => {
          if (!mountedRef.current || activeWaiverIdRef.current !== waiverId) return;
          setLinkingId(null);
          onLinkedInvoiceChange(invoiceId);
          onLinkComplete?.();
        },
        onError: (error) => {
          if (!mountedRef.current || activeWaiverIdRef.current !== waiverId) return;
          if (isWaiverParentStatusProtectedError(error)) {
            toast.error(error.message);
            setLinkingId(null);
            return;
          }
          setLinkError(mutationErrorMessage(error, "Unable to link this invoice right now."));
          setLinkingId(null);
        },
      },
    );
  }

  function unlinkInvoice() {
    if (!paired) return;
    unlinkWaiver.mutate(
      { invoiceId: paired.id, waiverId: record.id },
      {
        onSuccess: () => onLinkedInvoiceChange(null),
        onError: (error) => {
          if (isWaiverParentStatusProtectedError(error)) toast.error(error.message);
        },
      },
    );
  }

  return (
    <LienWaiverPairingList
      suppressEmptyNotice={Boolean(onCandidatesEmptyChange)}
      candidates={pairingQuery.data?.invoices ?? []}
      paired={paired}
      loading={pairingQuery.isLoading}
      error={pairingQuery.isError ? mutationErrorMessage(pairingQuery.error, "Unable to load invoices.") : linkError}
      query={candidateFilters.query}
      page={pairingQuery.data?.page ?? candidateFilters.page}
      total={pairingQuery.data?.total ?? 0}
      limit={pairingQuery.data?.limit ?? 10}
      onQueryChange={candidateFilters.setQuery}
      onPageChange={candidateFilters.setPage}
      canUnlink={record.status !== "submitted"}
      linkPendingId={linkingId}
      unlinkPending={unlinkWaiver.isPending}
      onLink={linkInvoice}
      onUnlink={unlinkInvoice}
      onViewCandidate={openInvoice}
      onViewPaired={openInvoice}
      linkDisabledReason={(candidate) => candidate.status === "approved" ? APPROVED_INVOICE_LINKAGE_REASON : undefined}
      unlinkDisabledReason={paired?.status === "approved" ? APPROVED_INVOICE_LINKAGE_REASON : undefined}
      linkingAvailable={linkingAvailable}
    />
  );
}
