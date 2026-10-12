"use client";

import { useState, useEffect, forwardRef, useImperativeHandle, useCallback, useMemo } from "react";

import { useUpdateInvoice } from "@/modules/accounting/modules/invoices/hooks/mutations";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { InvoiceUpdatePayload } from "@/modules/accounting/modules/invoices/types/api";
import type { ApprovalPreview, InvoiceDetailFormHandle } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailForm";

import { VendorDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown";
import { JobDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown";
import { Input } from "@/modules/shared/components/ui/input";

// ─── Props ─────────────────────────────────────────────────────────────────────

interface LienWaiverDetailFormProps {
  invoice: Invoice;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onApprovalPreviewChange?: (preview: ApprovalPreview) => void;
  onNotesStateChange?: (state: { notes: string; notesDirty: boolean }) => void;
}

function buildInitialValues(invoice: Invoice) {
  return {
    vendorCode: invoice.matching?.vendor?.vendorCode ?? null,
    jobNumber: invoice.matching?.job?.jobNumber ?? null,
    amount: invoice.extracted?.amount != null ? String(invoice.extracted.amount) : "",
  };
}

// ─── Component ─────────────────────────────────────────────────────────────────

export const LienWaiverDetailForm = forwardRef<InvoiceDetailFormHandle, LienWaiverDetailFormProps>(
  function LienWaiverDetailForm({ invoice, onSaved, onDirtyChange, onApprovalPreviewChange, onNotesStateChange }, ref) {
    const initialValues = buildInitialValues(invoice);

    const [vendorCode, setVendorCode] = useState<string | null>(() => initialValues.vendorCode);
    const [jobNumber, setJobNumber] = useState<string | null>(() => initialValues.jobNumber);
    const [amount, setAmount] = useState(() => initialValues.amount);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const { mutate: updateInvoice, isPending: isSaving } = useUpdateInvoice();

    const hasEdits =
      vendorCode !== initialValues.vendorCode ||
      jobNumber !== initialValues.jobNumber ||
      amount !== initialValues.amount;

    useEffect(() => { onDirtyChange?.(hasEdits); }, [hasEdits, onDirtyChange]);

    const approvalPreview = useMemo<ApprovalPreview>(() => ({
      invoiceNumber: invoice.extracted?.invoiceNumber ?? "",
      amount: amount !== "" ? parseFloat(amount) : null,
      invoiceDate: invoice.extracted?.invoiceDate ?? "",
      vendorCode: vendorCode ?? "",
      jobNumber: jobNumber ?? "",
      subcontractNumber: invoice.matching?.subcontract?.subcontractNumber ?? "",
    }), [
      invoice.extracted?.invoiceNumber,
      invoice.extracted?.invoiceDate,
      invoice.matching?.subcontract?.subcontractNumber,
      amount,
      vendorCode,
      jobNumber,
    ]);

    useEffect(() => {
      onApprovalPreviewChange?.(approvalPreview);
    }, [onApprovalPreviewChange, approvalPreview]);

    useEffect(() => {
      onNotesStateChange?.({ notes: "", notesDirty: false });
    }, [onNotesStateChange]);

    const buildPendingPayload = useCallback(() => {
        const payload: InvoiceUpdatePayload = {};
        if (vendorCode !== initialValues.vendorCode) payload.vendorCode = vendorCode ?? "";
        if (jobNumber !== initialValues.jobNumber) payload.jobNumber = jobNumber ?? "";
        const amt = parseFloat(amount);
        if (!isNaN(amt) && amount !== initialValues.amount) payload.amount = amt;
        return payload;
      },
      [vendorCode, jobNumber, amount, initialValues],
    );

    const handleSave = useCallback(
      (externalOnSuccess?: () => void, externalOnError?: (err: Error) => void) => {
        const payload = buildPendingPayload();
        updateInvoice(
          { id: invoice.id, payload },
          {
            onSuccess: () => {
              setSaveSuccess(true);
              setTimeout(() => setSaveSuccess(false), 3000);
              onSaved?.();
              externalOnSuccess?.();
            },
            onError: (err: Error) => { externalOnError?.(err); },
          },
        );
      },
      [buildPendingPayload, invoice.id, updateInvoice, onSaved],
    );

    useImperativeHandle(ref, () => ({
      hasEdits,
      isSaving,
      triggerSave: handleSave,
      getPendingPayload: buildPendingPayload,
      getApprovalPreview: () => approvalPreview,
      // Lien waiver form has no notes field — provide stubs
      notes: "",
      notesDirty: false,
      setNotes: () => {},
    }), [
      hasEdits,
      isSaving,
      handleSave,
      buildPendingPayload,
      approvalPreview,
    ]);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {/* Vendor — full width */}
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Vendor
            </label>
            <VendorDropdown value={vendorCode} vendorName={invoice.matching?.vendor?.vendorName} onChange={setVendorCode} />
          </div>

          {/* Job — full width */}
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Job
            </label>
            <JobDropdown value={jobNumber} jobDescription={invoice.matching?.job?.jobDescription} onChange={setJobNumber} />
          </div>

          {/* Amount Waived — full width */}
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
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-6"
              />
            </div>
          </div>
        </div>
      </div>
    );
  },
);

LienWaiverDetailForm.displayName = "LienWaiverDetailForm";
