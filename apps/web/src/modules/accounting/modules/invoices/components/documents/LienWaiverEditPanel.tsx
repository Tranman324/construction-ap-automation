"use client";

import { useState, useEffect } from "react";
import { X, CheckCircle, FileText } from "lucide-react";
import { format } from "date-fns";

import { useInvoice } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useUpdateInvoice, useFileDocument } from "@/modules/accounting/modules/invoices/hooks/mutations";
import type { InvoiceUpdatePayload } from "@/modules/accounting/modules/invoices/types/api";
import { VendorDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown";
import { JobDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { Separator } from "@/modules/shared/components/ui/separator";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/modules/shared/components/ui/sheet";

// ─── Props ────────────────────────────────────────────────────────────────────

interface LienWaiverEditPanelProps {
  id: string | null;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LienWaiverEditPanel({ id, onClose }: LienWaiverEditPanelProps) {
  const { data: invoice, isLoading } = useInvoice(id ?? "");
  const update = useUpdateInvoice();
  const fileDocument = useFileDocument();

  const [vendorCode, setVendorCode] = useState<string | null>(null);
  const [jobNumber, setJobNumber] = useState<string | null>(null);
  const [amountWaived, setAmountWaived] = useState<string>("");

  // Initialize form when the selected document changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!invoice) return;
    setVendorCode(invoice.matching?.vendor?.vendorCode ?? null);
    setJobNumber(invoice.matching?.job?.jobNumber ?? null);
    setAmountWaived(
      invoice.extracted?.amount != null ? String(invoice.extracted.amount) : ""
    );
  }, [invoice?.id]);

  const isTerminal =
    invoice?.status === "reviewed" || invoice?.status === "discarded";

  function buildPayload(): InvoiceUpdatePayload {
    const payload: InvoiceUpdatePayload = {
      vendorCode: vendorCode ?? "",
      jobNumber: jobNumber ?? "",
    };
    const amt = parseFloat(amountWaived);
    if (!isNaN(amt)) payload.amount = amt;
    return payload;
  }

  function handleSave() {
    if (!id) return;
    update.mutate({ id, payload: buildPayload() });
  }

  function handleSaveAndShelve() {
    if (!id) return;
    update.mutate(
      { id, payload: buildPayload() },
      {
        onSuccess: () =>
          fileDocument.mutate({ id }, { onSuccess: onClose }),
      }
    );
  }

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full sm:max-w-md p-0 flex flex-col"
        showCloseButton={false}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <SheetHeader className="flex flex-row items-center gap-2 border-b pb-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
          <SheetTitle className="text-base font-semibold">
            Lien Waiver
          </SheetTitle>
        </SheetHeader>

        {/* ── Loading skeleton ─────────────────────────────────────────────── */}
        {(isLoading || !invoice) && (
          <div className="space-y-4 p-4">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-px w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}

        {/* ── Body ────────────────────────────────────────────────────────── */}
        {!isLoading && invoice && (
          <div className="flex flex-col flex-1 overflow-y-auto">
            <div className="space-y-4 p-4">

              {/* File / sender info */}
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-mono truncate">
                    {invoice.file ?? invoice.email?.subject ?? "No filename"}
                  </p>
                  {invoice.email?.from && (
                    <p className="text-xs text-muted-foreground truncate">
                      From: {invoice.email.from}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Received{" "}
                    {invoice.email?.receivedAt
                      ? format(new Date(invoice.email.receivedAt), "MMM d, yyyy")
                      : format(new Date(invoice.queuedAt), "MMM d, yyyy")}
                  </p>
                </div>
              </div>

              {/* Form fields */}
              <div className="grid grid-cols-2 gap-3">
                {/* Vendor — full width */}
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Vendor
                  </label>
                  <VendorDropdown
                    value={vendorCode}
                    vendorName={invoice.matching?.vendor?.vendorName}
                    onChange={setVendorCode}
                  />
                </div>

                {/* Job — full width */}
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Job
                  </label>
                  <JobDropdown
                    value={jobNumber}
                    jobDescription={invoice.matching?.job?.jobDescription}
                    onChange={setJobNumber}
                  />
                </div>

                {/* Amount waived — full width */}
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Amount Waived
                  </label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={amountWaived}
                      onChange={(e) => setAmountWaived(e.target.value)}
                      className="pl-6"
                      disabled={isTerminal}
                    />
                  </div>
                </div>
              </div>

            </div>

            {/* Actions — pinned to bottom */}
            <div className="mt-auto border-t p-4 flex flex-col gap-2">
              <Button
                className="w-full gap-2 bg-teal-600 hover:bg-teal-700 text-white"
                disabled={update.isPending || fileDocument.isPending || isTerminal}
                onClick={handleSaveAndShelve}
              >
                <CheckCircle className="h-4 w-4" />
                {update.isPending || fileDocument.isPending
                  ? "Saving…"
                  : "Save & Shelve"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                disabled={update.isPending || isTerminal}
                onClick={handleSave}
              >
                {update.isPending ? "Saving…" : "Save"}
              </Button>
            </div>

          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
