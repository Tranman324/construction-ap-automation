"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Send } from "lucide-react";

import {
  buildGlobalApprovedQueueSubmitMode,
  buildSelectedSpectrumSubmitMode,
} from "@/modules/accounting/modules/invoices/components/dashboard/invoiceQueueSubmitModel";
import { SpectrumSubmitModal } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModal";
import type { SpectrumSubmitFailureOpenRequest, SpectrumSubmitMode } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import {
  clearSpectrumSubmitFailureWorkflowSnapshot,
  createSpectrumSubmitFailureDetailHref,
  createSpectrumSubmitFailureWorkflowSnapshot,
  createSpectrumSubmitReturnHref,
  isSpectrumSubmitReturnVisit,
  readSpectrumSubmitFailureWorkflowSnapshot,
  refreshSpectrumSubmitFailureWorkflow,
  writeSpectrumSubmitFailureWorkflowSnapshot,
  type SpectrumSubmitFailureWorkflowSnapshot,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitFailureWorkflowModel";
import type { DashboardStats } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { fetchInvoice } from "@/modules/accounting/modules/invoices/hooks/queries";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";
import { toast } from "@/modules/shared/components/ui/toaster";

interface InvoiceQueueSubmitControlProps {
  stats: DashboardStats | undefined;
  statsLoading: boolean;
  selectedIds: string[];
  selectedInvoices: Invoice[];
}

interface RestoredSpectrumSubmitWorkflow {
  key: string;
  snapshot: SpectrumSubmitFailureWorkflowSnapshot;
}

export function InvoiceQueueSubmitControl({
  stats,
  statsLoading,
  selectedIds,
  selectedInvoices,
}: InvoiceQueueSubmitControlProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [submitMode, setSubmitMode] = useState<SpectrumSubmitMode | null>(null);
  const [restoredWorkflow, setRestoredWorkflow] = useState<RestoredSpectrumSubmitWorkflow | null>(null);
  const openingFailureRef = useRef(false);
  const restoreKeyRef = useRef<string | null>(null);
  const globalMode = useMemo(() => buildGlobalApprovedQueueSubmitMode(stats), [stats]);
  const hasSelection = selectedIds.length > 0;
  const disabled = !hasSelection && (statsLoading || globalMode.invoiceCount === 0);
  const approvedPendingCountLabel = statsLoading ? "--" : String(globalMode.invoiceCount);
  const searchKey = searchParams.toString();
  const restoredMode: SpectrumSubmitMode | null = restoredWorkflow
    ? { kind: "selected", invoices: restoredWorkflow.snapshot.results.candidates }
    : null;
  const modalMode = submitMode ?? restoredMode ?? globalMode;

  useEffect(() => {
    const stored = readSpectrumSubmitFailureWorkflowSnapshot();
    if (!stored) return;
    const isReturnVisit = isSpectrumSubmitReturnVisit(new URLSearchParams(searchKey));

    const restoreKey = `${stored.activeInvoiceId ?? "none"}:${stored.results.rows
      .map((row) => `${row.invoiceId}:${row.submitted}:${row.resolved}:${row.discarded}`)
      .join("|")}`;
    if (restoreKeyRef.current === restoreKey) return;

    let cancelled = false;
    void refreshSpectrumSubmitFailureWorkflow(stored, fetchInvoice).then((snapshot) => {
      if (cancelled) return;
      restoreKeyRef.current = restoreKey;
      writeSpectrumSubmitFailureWorkflowSnapshot(snapshot);
      const workflowKeyPrefix = isReturnVisit ? "return" : "mount";
      setRestoredWorkflow({ key: `${workflowKeyPrefix}:${Date.now()}:${snapshot.activeInvoiceId ?? "none"}`, snapshot });
      setSubmitMode(null);
      setModalOpen(true);
    });

    return () => {
      cancelled = true;
    };
  }, [searchKey]);

  function handleSubmitClick() {
    clearSpectrumSubmitFailureWorkflowSnapshot();
    setRestoredWorkflow(null);

    if (hasSelection) {
      const result = buildSelectedSpectrumSubmitMode(selectedInvoices, selectedIds.length);

      if (result.mode === null) {
        toast.warning("No selected invoices can be submitted", {
          description: "Select approved invoice documents before submitting to Spectrum.",
        });
        return;
      }

      if (result.skippedCount > 0) {
        toast.warning("Submitting eligible selected invoices", {
          description: `${result.mode.invoices.length} eligible, ${result.skippedCount} skipped.`,
        });
      }

      setSubmitMode(result.mode);
      setModalOpen(true);
      return;
    }

    if (globalMode.invoiceCount === 0) return;
    setSubmitMode(globalMode);
    setModalOpen(true);
  }

  function handleOpenChange(open: boolean) {
    setModalOpen(open);
    if (open) return;

    setSubmitMode(null);
    if (openingFailureRef.current) {
      openingFailureRef.current = false;
      return;
    }

    setRestoredWorkflow(null);
    clearSpectrumSubmitFailureWorkflowSnapshot();
  }

  function handleFailureOpenRequest(request: SpectrumSubmitFailureOpenRequest) {
    const returnHref = createSpectrumSubmitReturnHref(pathname, searchKey);
    const snapshot = createSpectrumSubmitFailureWorkflowSnapshot(
      request.results,
      request.invoiceId,
    );

    openingFailureRef.current = true;
    writeSpectrumSubmitFailureWorkflowSnapshot(snapshot);
    router.push(createSpectrumSubmitFailureDetailHref(request.invoiceId, returnHref));
    return true;
  }

  return (
    <PermissionGate requires="accounting.invoices.submit_spectrum">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex" tabIndex={disabled ? 0 : undefined}>
              <Button
                className="gap-1.5"
                disabled={disabled}
                onClick={handleSubmitClick}
                size="sm"
                type="button"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Submit to Spectrum
                <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-xs font-semibold leading-none">
                  {approvedPendingCountLabel}
                </span>
              </Button>
            </span>
          </TooltipTrigger>
          {disabled && !statsLoading && (
            <TooltipContent side="bottom">
              No approved invoices to submit
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      <SpectrumSubmitModal
        open={modalOpen}
        onOpenChange={handleOpenChange}
        mode={modalMode}
        restoredActiveFailureInvoiceId={restoredWorkflow?.snapshot.activeInvoiceId ?? null}
        restoredResults={restoredWorkflow?.snapshot.results ?? null}
        restoredWorkflowKey={restoredWorkflow?.key ?? null}
        onFailureOpenRequest={handleFailureOpenRequest}
      />
    </PermissionGate>
  );
}
