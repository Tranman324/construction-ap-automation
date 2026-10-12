"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useDiscardInvoice, useSubmitToSpectrum } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useInvoices } from "@/modules/accounting/modules/invoices/hooks/queries";
import { SpectrumSubmitModalFooter } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModalFooter";
import { SpectrumSubmitModalHeader } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModalHeader";
import { SpectrumSubmitModalPhaseContent } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModalPhaseContent";
import { fireSpectrumSubmitConfetti } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitConfetti";
import {
  summarizeSpectrumSubmitMode,
  toSpectrumSubmitCandidate,
  type SpectrumSubmitCandidate,
  type SpectrumSubmitFailureOpenRequest,
  type SpectrumSubmitMode,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import { deriveSpectrumSubmitPrechecks } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitPrecheckModel";
import { mergeSpectrumSubmitResults, type SpectrumSubmitPhaseModel, type SpectrumSubmitResultRow, type SpectrumSubmitResultsPhase } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import { canCompleteSpectrumSubmitResults, createSpectrumSubmitDiscardReason, getSpectrumSubmitFailureNavigation, getSpectrumSubmitRetryCandidates, markSpectrumSubmitResultDiscarded } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitResultsModel";
import { runSpectrumSubmitSubmission } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitSubmissionRunner";
import { Dialog, DialogContent } from "@/modules/shared/components/ui/dialog";
import { toast } from "@/modules/shared/components/ui/toaster";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";

export interface SpectrumSubmitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SpectrumSubmitMode;
  onConfirm?: (mode: SpectrumSubmitMode) => void;
  onFailureOpenRequest?: (request: SpectrumSubmitFailureOpenRequest) => boolean | void;
  restoredActiveFailureInvoiceId?: string | null;
  restoredResults?: SpectrumSubmitResultsPhase | null;
  restoredWorkflowKey?: string | null;
}

export function SpectrumSubmitModal({
  open,
  onOpenChange,
  mode,
  onConfirm,
  onFailureOpenRequest,
  restoredActiveFailureInvoiceId = null,
  restoredResults = null,
  restoredWorkflowKey = null,
}: SpectrumSubmitModalProps) {
  const router = useRouter();
  const [phaseModel, setPhaseModel] = useState<SpectrumSubmitPhaseModel>({ phase: "confirm", source: mode });
  const [activeFailureInvoiceId, setActiveFailureInvoiceId] = useState<string | null>(null);
  const [discardingInvoiceId, setDiscardingInvoiceId] = useState<string | null>(null);
  const submissionStartedRef = useRef(false);
  const confettiFiredRef = useRef(false);
  const restoredWorkflowKeyRef = useRef<string | null>(null);
  const submit = useSubmitToSpectrum();
  const discard = useDiscardInvoice();
  const globalInvoicesQuery = useInvoices({ status: "approved", limit: 100, filed: false }, { enabled: open && mode.kind === "global-approved-queue" });
  const globalCandidates = useMemo(() => globalInvoicesQuery.data?.invoices.map(toSpectrumSubmitCandidate), [globalInvoicesQuery.data?.invoices]);
  const confirmCandidates = mode.kind === "selected" ? mode.invoices : globalCandidates;
  const activeCandidates = phaseModel.phase === "confirm" ? confirmCandidates : phaseModel.candidates;
  const summary = useMemo(() => summarizeSpectrumSubmitMode(mode, activeCandidates), [activeCandidates, mode]);
  const precheck = useMemo(() => deriveSpectrumSubmitPrechecks(confirmCandidates ?? []), [confirmCandidates]);
  const canSubmit = phaseModel.phase === "confirm"
    && Boolean(confirmCandidates?.length)
    && precheck.blockingWaiverCount === 0
    && !submit.isPending;
  const failureNavigation = phaseModel.phase === "results" ? getSpectrumSubmitFailureNavigation(phaseModel, activeFailureInvoiceId) : null;
  const canCompleteResults = phaseModel.phase === "results" && canCompleteSpectrumSubmitResults(phaseModel);

  useEffect(() => {
    if (!open || !restoredResults || !restoredWorkflowKey) return;
    if (restoredWorkflowKeyRef.current === restoredWorkflowKey) return;

    restoredWorkflowKeyRef.current = restoredWorkflowKey;
    confettiFiredRef.current = true;
    setPhaseModel(restoredResults);
    setActiveFailureInvoiceId(getSpectrumSubmitFailureNavigation(restoredResults, restoredActiveFailureInvoiceId).activeInvoiceId);
  }, [open, restoredActiveFailureInvoiceId, restoredResults, restoredWorkflowKey]);

  useEffect(() => {
    if (phaseModel.phase !== "results") {
      if (activeFailureInvoiceId !== null) setActiveFailureInvoiceId(null);
      return;
    }

    const nextActiveInvoiceId = getSpectrumSubmitFailureNavigation(phaseModel, activeFailureInvoiceId).activeInvoiceId;
    if (nextActiveInvoiceId !== activeFailureInvoiceId) {
      setActiveFailureInvoiceId(nextActiveInvoiceId);
    }
  }, [activeFailureInvoiceId, phaseModel]);

  useEffect(() => {
    if (phaseModel.phase !== "results" || confettiFiredRef.current) return;
    if (phaseModel.rows.length === 0 || phaseModel.rows.some((row) => !row.submitted)) return;

    confettiFiredRef.current = true;
    fireSpectrumSubmitConfetti();
  }, [phaseModel]);

  function handleOpenChange(nextOpen: boolean) {
    if (phaseModel.phase === "submitting" && !nextOpen) return;
    if (!nextOpen) setPhaseModel({ phase: "confirm", source: mode });
    onOpenChange(nextOpen);
  }

  async function runSubmission(candidatesToSubmit: SpectrumSubmitCandidate[], previousResults?: SpectrumSubmitResultsPhase) {
    try {
      const results = await runSpectrumSubmitSubmission(candidatesToSubmit, submit, setPhaseModel);
      const nextResults = previousResults
        ? mergeSpectrumSubmitResults(previousResults, results)
        : results;
      setPhaseModel(nextResults);
      setActiveFailureInvoiceId(getSpectrumSubmitFailureNavigation(nextResults, null).activeInvoiceId);
    } finally {
      submissionStartedRef.current = false;
    }
  }

  function handleConfirm() {
    if (!canSubmit || !confirmCandidates?.length || submissionStartedRef.current) return;
    submissionStartedRef.current = true;
    confettiFiredRef.current = false;
    onConfirm?.(mode);
    void runSubmission(confirmCandidates);
  }

  function handleResubmitFailures() {
    if (phaseModel.phase !== "results" || submissionStartedRef.current) return;

    const candidatesToSubmit = getSpectrumSubmitRetryCandidates(phaseModel);
    if (candidatesToSubmit.length === 0) return;

    submissionStartedRef.current = true;
    confettiFiredRef.current = false;
    void runSubmission(candidatesToSubmit, phaseModel);
  }

  function handleOpenInvoice(invoiceId: string) {
    if (phaseModel.phase !== "results") return;

    const handled = onFailureOpenRequest?.({ invoiceId, results: phaseModel }) === true;
    onOpenChange(false);
    if (!handled) {
      router.push(`/accounting/invoices/${encodeURIComponent(invoiceId)}`);
    }
  }

  async function handleDiscardInvoice(row: SpectrumSubmitResultRow) {
    if (phaseModel.phase !== "results" || row.submitted || row.discarded) return;

    setDiscardingInvoiceId(row.invoiceId);
    try {
      await discard.mutateAsync({
        id: row.discardInvoiceId ?? row.invoiceId,
        reason: createSpectrumSubmitDiscardReason(row),
      });
      setPhaseModel((current) =>
        current.phase === "results" ? markSpectrumSubmitResultDiscarded(current, row.invoiceId) : current,
      );
    } catch (error) {
      toast.error("Failed to discard invoice", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setDiscardingInvoiceId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`${motionStyles.spinnerScope} w-[calc(100vw-2rem)] max-w-[620px] gap-0 overflow-hidden p-0 sm:max-w-[620px]`}>
        <SpectrumSubmitModalHeader phaseModel={phaseModel} summary={summary} />

        <SpectrumSubmitModalPhaseContent
          activeFailureInvoiceId={failureNavigation?.activeInvoiceId ?? null}
          confirmCandidates={confirmCandidates}
          discardingInvoiceId={discardingInvoiceId}
          failureNavigation={failureNavigation}
          phaseModel={phaseModel}
          precheck={precheck}
          summary={summary}
          onDiscardInvoice={(row) => { void handleDiscardInvoice(row); }}
          onFailureNavigationChange={setActiveFailureInvoiceId}
          onOpenInvoice={handleOpenInvoice}
        />

        <SpectrumSubmitModalFooter
          canCompleteResults={canCompleteResults}
          canSubmit={canSubmit}
          phaseModel={phaseModel}
          summary={summary}
          unresolvedFailureCount={failureNavigation?.total ?? 0}
          onCancel={() => handleOpenChange(false)}
          onConfirm={handleConfirm}
          onDone={() => handleOpenChange(false)}
          onResubmitFailures={handleResubmitFailures}
        />
      </DialogContent>
    </Dialog>
  );
}
