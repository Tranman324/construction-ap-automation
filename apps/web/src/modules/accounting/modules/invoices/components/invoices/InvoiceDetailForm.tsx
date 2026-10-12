"use client";

import { useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback, useMemo } from "react";
import { ClipboardCheck, FileText } from "lucide-react";
import { PanelNotice } from "../documents/PanelNotice";

import { isApiError } from "@/modules/shared/lib/api";
import { useCascadingDropdowns } from "@/modules/accounting/modules/invoices/hooks/useCascadingDropdowns";
import { useUpdateInvoice } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useSubcontracts, useValidateApproval } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { InvoiceUpdatePayload, InvoiceUpdateResponse, Subcontract } from "@/modules/accounting/modules/invoices/types/api";

import { VendorDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown";
import { JobDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown";
import { SubcontractDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/SubcontractDropdown";
import { Input } from "@/modules/shared/components/ui/input";
import { cn } from "@/modules/shared/lib/utils";
import { Field } from "@/modules/shared/components/patterns/Field";
import { getInvoiceFieldState } from "@/modules/shared/components/patterns/invoiceFieldState";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface LocalFields {
  invoiceNumber: string;
  amount: string;
  invoiceDate: string;
  dueDate: string;
  notes: string; // maps to invoice.extracted.description; submitted as payload.notes
}

type CascadeField = "vendorCode" | "jobNumber" | "subcontractNumber";

function getInvoiceLocalFields(invoice: Invoice): LocalFields {
  return {
    invoiceNumber: invoice.extracted?.invoiceNumber ?? "",
    amount: invoice.extracted?.amount != null
      ? String(invoice.extracted.amount)
      : "",
    invoiceDate: invoice.extracted?.invoiceDate ?? "",
    dueDate: invoice.extracted?.dueDate ?? "",
    notes: invoice.extracted?.description ?? "",
  };
}

// ─── Imperative handle type (exported for parent usage) ──────────────────────

export interface ApprovalPreview {
  invoiceNumber: string;
  amount: number | null;
  invoiceDate: string;
  vendorCode: string;
  jobNumber: string;
  subcontractNumber: string;
}

export interface InvoiceDetailFormHandle {
  hasEdits: boolean;
  isSaving: boolean;
  triggerSave: (onSuccess?: () => void, onError?: (err: Error) => void, options?: { suppressErrorToast?: boolean }) => void;
  getPendingPayload: () => InvoiceUpdatePayload;
  getApprovalPreview: () => ApprovalPreview;
  /** Access notes state for parent-rendered Notes accordion */
  notes: string;
  notesDirty: boolean;
  setNotes: (v: string) => void;
  blurNotes?: () => void;
}

interface InvoiceDetailFormProps {
  invoice: Invoice;
  /** Keeps an inspected soft-deleted record from issuing form mutations. */
  readOnly?: boolean;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onApprovalPreviewChange?: (preview: ApprovalPreview) => void;
  onNotesStateChange?: (state: { notes: string; notesDirty: boolean }) => void;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export const InvoiceDetailForm = forwardRef<InvoiceDetailFormHandle, InvoiceDetailFormProps>(
  function InvoiceDetailForm({
  invoice,
  readOnly = false,
  onSaved,
  onDirtyChange,
  onApprovalPreviewChange,
  onNotesStateChange,
}: InvoiceDetailFormProps, ref) {
  // Share SpectrumSubmitSection's cached server verdict; never derive a path locally.
  const { data: approvalState } = useValidateApproval(invoice);
  const requiredFields = approvalState?.requiredFields ?? [];
  const jobRequired = requiredFields.includes("job_match_number");
  // ── Cascade dropdowns ────────────────────────────────────────────────────────
  const cascade = useCascadingDropdowns({
    initialVendorCode: invoice.matching?.vendor?.vendorCode ?? null,
    initialJobNumber: invoice.matching?.job?.jobNumber ?? null,
  });

  // ── Local fields ─────────────────────────────────────────────────────────────
  const [initialFields, setInitialFields] = useState<LocalFields>(() => getInvoiceLocalFields(invoice));

  const [localFields, setLocalFields] = useState<LocalFields>(() => getInvoiceLocalFields(invoice));
  const [focusedFields, setFocusedFields] = useState<Set<keyof LocalFields>>(() => new Set());
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof LocalFields, string>>>({});
  const [cascadeFieldErrors, setCascadeFieldErrors] = useState<Partial<Record<CascadeField, string>>>({});
  const [subcontractDerivation, setSubcontractDerivation] = useState<InvoiceUpdateResponse["subcontractDerivation"]>();
  const [derivedSubcontractNumber, setDerivedSubcontractNumber] = useState(invoice.matching?.subcontract?.subcontractNumber ?? null);
  const servedSubcontractNumber = invoice.matching?.subcontract?.subcontractNumber ?? null;
  const [observedSubcontract, setObservedSubcontract] = useState({ id: invoice.id, value: servedSubcontractNumber });
  if (observedSubcontract.id !== invoice.id || observedSubcontract.value !== servedSubcontractNumber) {
    setObservedSubcontract({ id: invoice.id, value: servedSubcontractNumber });
    setDerivedSubcontractNumber(servedSubcontractNumber);
    setSubcontractDerivation(undefined);
  }
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const sequenceRef = useRef<Record<keyof LocalFields, number>>({ invoiceNumber: 0, amount: 0, invoiceDate: 0, dueDate: 0, notes: 0 });
  const cascadeSequenceRef = useRef<Record<CascadeField, number>>({ vendorCode: 0, jobNumber: 0, subcontractNumber: 0 });
  const derivationGenerationRef = useRef(0);
  const subcontractByJobRef = useRef(new Map<string, { subcontractNumber: string | null; derivation: InvoiceUpdateResponse["subcontractDerivation"] }>());
  const invoiceIdRef = useRef(invoice.id);

  // Field names the server reported as locked on the most recent 409 (F1c) —
  // drives a destructive ring on the matching editable inputs.
  const [lockedFields, setLockedFields] = useState<string[]>([]);

  // ── Resync when server data changes (e.g. after save + refetch) ────────────
  useEffect(() => {
    const fresh = getInvoiceLocalFields(invoice);
    if (invoiceIdRef.current !== invoice.id) {
      (Object.keys(sequenceRef.current) as Array<keyof LocalFields>).forEach((field) => { sequenceRef.current[field] += 1; });
      (Object.keys(cascadeSequenceRef.current) as CascadeField[]).forEach((field) => { cascadeSequenceRef.current[field] += 1; });
      derivationGenerationRef.current += 1;
      invoiceIdRef.current = invoice.id;
      cascade.reset();
      setInitialFields(fresh);
      setLocalFields(fresh);
      setFocusedFields(new Set());
      setFieldErrors({});
      setCascadeFieldErrors({});
      setSubcontractDerivation(undefined);
      setDerivedSubcontractNumber(invoice.matching?.subcontract?.subcontractNumber ?? null);
      setSaveState("idle");
      return;
    }
    setInitialFields((previous) => {
      const next = { ...previous };
      (Object.keys(fresh) as Array<keyof LocalFields>).forEach((field) => {
        if (!focusedFields.has(field) && localFields[field] === previous[field]) next[field] = fresh[field];
      });
      return next;
    });
    setLocalFields((previous) => {
      const next = { ...previous };
      (Object.keys(fresh) as Array<keyof LocalFields>).forEach((field) => {
        if (!focusedFields.has(field) && previous[field] === initialFields[field]) next[field] = fresh[field];
      });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    invoice.extracted?.invoiceNumber,
    invoice.extracted?.amount,
    invoice.extracted?.invoiceDate,
    invoice.extracted?.dueDate,
    invoice.extracted?.description,
  ]);


  // ── Dirty tracking ───────────────────────────────────────────────────────────
  const localDirty =
    localFields.invoiceNumber !== initialFields.invoiceNumber ||
    localFields.amount !== initialFields.amount ||
    localFields.invoiceDate !== initialFields.invoiceDate ||
    localFields.dueDate !== initialFields.dueDate ||
    localFields.notes !== initialFields.notes;
  const notesDirty = localFields.notes !== initialFields.notes;

  const hasEdits = cascade.hasEdits || localDirty;

  // Notify parent of dirty state changes
  useEffect(() => {
    onDirtyChange?.(hasEdits);
  }, [hasEdits, onDirtyChange]);

  // ── Mutation ─────────────────────────────────────────────────────────────────
  const { mutate: updateInvoice, isPending: isSaving } = useUpdateInvoice();

  const buildUpdatePayload = useCallback(() => {
    const payload: InvoiceUpdatePayload = {
      ...cascade.changedFields,
    };

    if (localFields.invoiceNumber !== initialFields.invoiceNumber) {
      payload.invoiceNumber = localFields.invoiceNumber;
    }
    if (localFields.amount !== initialFields.amount && localFields.amount !== "") {
      payload.amount = parseFloat(localFields.amount);
    }
    if (localFields.invoiceDate !== initialFields.invoiceDate) {
      payload.invoiceDate = localFields.invoiceDate;
    }
    if (localFields.dueDate !== initialFields.dueDate) {
      payload.dueDate = localFields.dueDate;
    }
    if (localFields.notes !== initialFields.notes) {
      payload.notes = localFields.notes;
    }

    return payload;
  }, [cascade.changedFields, initialFields, localFields]);

  // ── Save handler ─────────────────────────────────────────────────────────────
  const handleSave = useCallback(function handleSave(
    externalOnSuccess?: () => void,
    externalOnError?: (err: Error) => void,
    options?: { suppressErrorToast?: boolean },
  ) {
    if (readOnly) {
      externalOnSuccess?.();
      return;
    }
    const payload = buildUpdatePayload();
    if (Object.keys(payload).length === 0) {
      externalOnSuccess?.();
      return;
    }
    const snapshots = { ...sequenceRef.current };
    const cascadeSnapshots = { ...cascadeSequenceRef.current };
    const derivationGeneration = derivationGenerationRef.current;
    const values = { ...localFields };
    updateInvoice(
      { id: invoice.id, payload, suppressErrorToast: options?.suppressErrorToast },
      {
        onSuccess: (response?: InvoiceUpdateResponse) => {
          setInitialFields((previous) => {
            const next = { ...previous };
            (Object.keys(values) as Array<keyof LocalFields>).forEach((field) => {
              if (snapshots[field] === sequenceRef.current[field]) next[field] = values[field];
            });
            return next;
          });
          if (derivationGeneration === derivationGenerationRef.current && response?.subcontractDerivation) {
            setSubcontractDerivation(response.subcontractDerivation);
            setDerivedSubcontractNumber(response.subcontractDerivation.subcontractNumber);
          }
          // Completion callbacks intentionally fire for a pre-switch response;
          // callers identity-guard invoice actions (page onSaved is a no-op and
          // navigate-after-save relies on resolution).
          onSaved?.();
          externalOnSuccess?.();
        },
        onError: (error: Error) => {
          setFieldErrors((previous) => {
            const next = { ...previous };
            (Object.keys(values) as Array<keyof LocalFields>).forEach((field) => {
              if (snapshots[field] === sequenceRef.current[field] && values[field] !== initialFields[field]) {
                next[field] = error.message;
              }
            });
            return next;
          });
          setCascadeFieldErrors((previous) => {
            const next = { ...previous };
            (Object.keys(cascade.changedFields) as CascadeField[]).forEach((field) => {
              if (cascadeSnapshots[field] === cascadeSequenceRef.current[field]) next[field] = error.message;
            });
            return next;
          });
          externalOnError?.(error);
        },
      },
    );
  }, [buildUpdatePayload, cascade.changedFields, initialFields, invoice.id, localFields, onSaved, readOnly, updateInvoice]);

  // ── Imperative handle ────────────────────────────────────────────────────────
  const approvalPreview: ApprovalPreview = useMemo(() => ({
    invoiceNumber: localFields.invoiceNumber,
    amount: localFields.amount !== "" ? parseFloat(localFields.amount) : null,
    invoiceDate: localFields.invoiceDate,
    vendorCode: cascade.vendorCode ?? "",
    jobNumber: cascade.jobNumber ?? "",
    subcontractNumber: derivedSubcontractNumber ?? "",
  }), [
    localFields.invoiceNumber,
    localFields.amount,
    localFields.invoiceDate,
    cascade.vendorCode,
    cascade.jobNumber,
    derivedSubcontractNumber,
  ]);

  useEffect(() => {
    onApprovalPreviewChange?.(approvalPreview);
  }, [onApprovalPreviewChange, approvalPreview]);

  useEffect(() => {
    onNotesStateChange?.({ notes: localFields.notes, notesDirty });
  }, [onNotesStateChange, localFields.notes, notesDirty]);

  function setField<K extends keyof LocalFields>(key: K, value: LocalFields[K]) {
    sequenceRef.current[key] += 1;
    setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
    setLocalFields((prev) => ({ ...prev, [key]: value }));
  }

  const saveFieldOnBlur = useCallback((field: keyof LocalFields) => {
    setFocusedFields((previous) => { const next = new Set(previous); next.delete(field); return next; });
    if (readOnly || invoice.status === "approved" || localFields[field] === initialFields[field]) return;
    const sequence = sequenceRef.current[field];
    const payload: InvoiceUpdatePayload = field === "amount"
      ? (localFields.amount ? { amount: parseFloat(localFields.amount) } : {})
      : { [field]: localFields[field] };
    if (Object.keys(payload).length === 0) return;
    setSaveState("saving");
    updateInvoice({ id: invoice.id, payload }, {
      onSuccess: () => {
        if (sequenceRef.current[field] !== sequence) return;
        setInitialFields((previous) => ({ ...previous, [field]: localFields[field] }));
        setSaveState("saved");
        onSaved?.();
      },
      onError: (error: Error) => {
        if (sequenceRef.current[field] !== sequence) return;
        setSaveState("error");
        setFieldErrors((previous) => ({ ...previous, [field]: error.message }));
        if (isApiError(error) && error.lockedFields) setLockedFields(error.lockedFields);
      },
    });
  }, [initialFields, invoice.id, invoice.status, localFields, onSaved, readOnly, updateInvoice]);

  const saveCascadeSelection = useCallback((field: CascadeField, value: string | null, apply?: (value: string | null) => void) => {
    const previousJobNumber = cascade.jobNumber;
    const previousVendorCode = cascade.vendorCode ?? "";
    const isJobClear = field === "jobNumber" && !value;
    const isDifferentJob = field === "jobNumber" && !!previousJobNumber && !!value && previousJobNumber !== value;
    const restoreKey = field === "jobNumber" && value ? `${previousVendorCode}|${value}` : null;
    const savedSubcontract = restoreKey ? subcontractByJobRef.current.get(restoreKey) : undefined;
    if (isJobClear && previousJobNumber) {
      subcontractByJobRef.current.set(`${previousVendorCode}|${previousJobNumber}`, {
        subcontractNumber: derivedSubcontractNumber,
        derivation: subcontractDerivation,
      });
    }
    if (isDifferentJob) {
      setSubcontractDerivation(undefined);
      setDerivedSubcontractNumber(null);
    }
    cascadeSequenceRef.current[field] += 1;
    const sequence = cascadeSequenceRef.current[field];
    const derivationGeneration = field === "vendorCode" || field === "jobNumber"
      ? ++derivationGenerationRef.current
      : derivationGenerationRef.current;
    setCascadeFieldErrors((previous) => ({ ...previous, [field]: undefined }));
    apply?.(value);
    if (readOnly || invoice.status === "approved" || invoice.status === "modified") return;

    setSaveState("saving");
    updateInvoice({ id: invoice.id, payload: { [field]: value ?? "" } }, {
      onSuccess: (response?: InvoiceUpdateResponse) => {
        if (cascadeSequenceRef.current[field] !== sequence) return;
        if (field === "vendorCode" || field === "jobNumber") {
          cascade.acknowledgeSaved(field, value);
          if (derivationGeneration !== derivationGenerationRef.current) return;
          const derivation = response?.subcontractDerivation;
          if (isJobClear) {
            // A temporary no-job state hides dependent controls but must not
            // erase the user's prior job-specific selection.
          } else if (savedSubcontract) {
            setSubcontractDerivation(savedSubcontract.derivation);
            setDerivedSubcontractNumber(savedSubcontract.subcontractNumber);
          } else if (derivation) {
            setSubcontractDerivation(derivation);
            setDerivedSubcontractNumber(derivation.subcontractNumber);
          }
        } else {
          setSubcontractDerivation(undefined);
          setDerivedSubcontractNumber(response?.invoice?.matching?.subcontract?.subcontractNumber ?? value);
        }
        setSaveState("saved");
        onSaved?.();
      },
      onError: (error: Error) => {
        if (cascadeSequenceRef.current[field] !== sequence) return;
        setSaveState("error");
        setCascadeFieldErrors((previous) => ({ ...previous, [field]: error.message }));
        if (isApiError(error) && error.lockedFields) setLockedFields(error.lockedFields);
      },
    });
  }, [cascade, derivedSubcontractNumber, invoice.id, invoice.status, onSaved, readOnly, subcontractDerivation, updateInvoice]);

  const handleVendorChange = useCallback(
    (value: string | null) => saveCascadeSelection("vendorCode", value, cascade.setVendor),
    [cascade.setVendor, saveCascadeSelection],
  );
  const handleJobChange = useCallback(
    (value: string | null) => saveCascadeSelection("jobNumber", value, cascade.setJob),
    [cascade.setJob, saveCascadeSelection],
  );
  const handleSubcontractChange = useCallback(
    (value: string | null) => saveCascadeSelection("subcontractNumber", value),
    [saveCascadeSelection],
  );

  useImperativeHandle(ref, () => ({
    hasEdits,
    isSaving,
    triggerSave: handleSave,
    getPendingPayload: buildUpdatePayload,
    getApprovalPreview: () => approvalPreview,
    notes: localFields.notes,
    notesDirty: localFields.notes !== initialFields.notes,
    setNotes: (v: string) => setField("notes", v),
    blurNotes: () => saveFieldOnBlur("notes"),
  }), [
    hasEdits,
    isSaving,
    initialFields.notes,
    handleSave,
    buildUpdatePayload,
    approvalPreview,
    localFields.notes,
    saveFieldOnBlur,
  ]);

  // ── Subcontract amount info ────────────────────────────────────────────────
  const { data: subcontracts } = useSubcontracts(
    cascade.vendorCode ?? undefined,
    cascade.jobNumber ?? undefined
  );
  const { data: jobSubcontracts } = useSubcontracts(undefined, cascade.jobNumber ?? undefined);
  const selectedSub: Subcontract | null =
    (subcontracts ?? []).find(
      (s: Subcontract) => s.subcontractNumber === derivedSubcontractNumber
    ) ?? null;
  const unbilledAmount = selectedSub
    ? selectedSub.revContract - selectedSub.totalBilled
    : null;
  const invoiceAmount =
    localFields.amount !== "" ? parseFloat(localFields.amount) : null;
  const exceedsUnbilled =
    unbilledAmount !== null && invoiceAmount !== null && invoiceAmount > unbilledAmount;

  function formatCur(v: number) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
  }

  // Approved AND modified invoices lock their identity/matching fields — edits
  // require unapproving first. Owner decision: both statuses lock.
  const isLocked = invoice.status === "approved" || invoice.status === "modified";
  const hasJob = !!cascade.jobNumber;
  const hasVendorSubcontractForJob = (subcontracts ?? []).length > 0;
  const showOtherVendorSubcontractHint = hasJob
    && (jobSubcontracts ?? []).length > 0
    && !hasVendorSubcontractForJob;

  const invoiceNumberDirty =
    localFields.invoiceNumber !== initialFields.invoiceNumber;
  const amountDirty =
    localFields.amount !== initialFields.amount;
  const invoiceDateDirty =
    localFields.invoiceDate !== initialFields.invoiceDate;
  const dueDateDirty =
    localFields.dueDate !== initialFields.dueDate;

  const vendorFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.vendorCode?.origin === "manual",
    value: cascade.vendorCode,
    baseline: invoice.matching?.vendor?.vendorCode ?? null,
    required: true,
  });
  const jobFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.jobNumber?.origin === "manual",
    value: cascade.jobNumber,
    baseline: invoice.matching?.job?.jobNumber ?? null,
    required: jobRequired,
  });
  const subcontractFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.subcontractNumber?.origin === "manual",
    value: derivedSubcontractNumber,
    baseline: invoice.matching?.subcontract?.subcontractNumber ?? null,
    optional: true,
  });
  const invoiceNumberFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.invoiceNumber?.origin === "manual",
    value: localFields.invoiceNumber,
    baseline: initialFields.invoiceNumber,
    required: true,
  });
  const amountFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.amount?.origin === "manual",
    value: localFields.amount === "" ? null : Number(localFields.amount),
    baseline: initialFields.amount === "" ? null : Number(initialFields.amount),
    required: true,
  });
  const invoiceDateFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.invoiceDate?.origin === "manual",
    value: localFields.invoiceDate,
    baseline: initialFields.invoiceDate,
    required: true,
  });
  const dueDateFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.dueDate?.origin === "manual",
    value: localFields.dueDate,
    baseline: initialFields.dueDate,
    optional: true,
  });

  // ─── Render ──────────────────────────────────────────────────────────────────

  const saveStatus = (
    <p className={cn("text-xs", saveState === "error" ? "text-destructive" : "text-muted-foreground")} role="status">
      {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save failed — blur again or use Save to retry."}
    </p>
  );

  return (
    <div className="space-y-4">
      {saveState !== "idle" && (
        saveState === "saving" ? saveStatus : (
          <PanelNotice id="invoice-form-save-status" label="Invoice save status" resolved={saveState === "saved"}>
            {saveStatus}
          </PanelNotice>
        )
      )}
      {/* ── Spectrum Matching ──────────────────────────────────────────── */}
      <div className="rounded-b-lg border-b border-border pb-4">
        <div className="mb-2 flex items-center">
          <p className="flex items-center gap-1 text-2xs font-semibold text-muted-foreground uppercase tracking-widest">
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Spectrum Matching
          </p>
        </div>
        <div className="space-y-3.5">
          <div>
            <Field label="Vendor" htmlFor="invoice-vendor" required invoiceState={vendorFieldState}>
              <VendorDropdown
                id="invoice-vendor"
                aria-invalid={vendorFieldState.ariaInvalid}
                value={cascade.vendorCode}
                vendorName={invoice.matching?.vendor?.vendorName}
                isManual={cascade.isManualVendor}
                onChange={handleVendorChange}
                disabled={isLocked}
                className={cn(lockedFields.includes("vendorCode") && "ring-2 ring-destructive")}
              />
            </Field>
            {cascadeFieldErrors.vendorCode && <p className="mt-0.5 text-2xs text-destructive" role="alert">{cascadeFieldErrors.vendorCode}</p>}
            {isLocked && <p className="mt-0.5 text-2xs text-muted-foreground">Unapprove to edit</p>}
          </div>

          <div>
            <Field label="Job" htmlFor="invoice-job" required={jobRequired} invoiceState={jobFieldState}>
              <JobDropdown
                id="invoice-job"
                aria-invalid={jobFieldState.ariaInvalid}
                value={cascade.jobNumber}
                jobDescription={invoice.matching?.job?.jobDescription}
                isManual={cascade.isManualJob}
                onChange={handleJobChange}
                disabled={isLocked}
                className={cn(lockedFields.includes("jobNumber") && "ring-2 ring-destructive")}
              />
            </Field>
            {cascadeFieldErrors.jobNumber && <p className="mt-0.5 text-2xs text-destructive" role="alert">{cascadeFieldErrors.jobNumber}</p>}
            {isLocked && <p className="mt-0.5 text-2xs text-muted-foreground">Unapprove to edit</p>}
          </div>

          <div>
            <Field label="Subcontract" htmlFor="invoice-subcontract" optional invoiceState={subcontractFieldState}>
              <SubcontractDropdown
                id="invoice-subcontract"
                aria-invalid={subcontractFieldState.ariaInvalid}
                value={derivedSubcontractNumber}
                vendorCode={cascade.vendorCode ?? undefined}
                jobNumber={cascade.jobNumber ?? undefined}
                onChange={handleSubcontractChange}
                placeholder={hasJob ? "Select…" : "Select a job first"}
                disabled={isLocked || !hasJob}
                className={cn(lockedFields.includes("subcontractNumber") && "ring-2 ring-destructive")}
              />
            </Field>
            {cascadeFieldErrors.subcontractNumber && <p className="mt-0.5 text-2xs text-destructive" role="alert">{cascadeFieldErrors.subcontractNumber}</p>}
            {isLocked && <p className="mt-0.5 text-2xs text-muted-foreground">Unapprove to edit</p>}
            {showOtherVendorSubcontractHint && (
              <p className="mt-0.5 text-2xs text-muted-foreground">This job has subcontracts, but none for this vendor.</p>
            )}
            {selectedSub && (
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md bg-muted/25 px-3 py-2 text-xs tabular-nums">
                <span className="text-muted-foreground">
                  Contract:{" "}
                  <strong className="text-foreground font-semibold">{formatCur(selectedSub.revContract)}</strong>
                </span>
                <span className="text-muted-foreground">
                  Unbilled:{" "}
                  <strong className={cn("font-semibold", exceedsUnbilled ? "text-destructive" : "text-foreground")}>
                    {formatCur(unbilledAmount!)}
                  </strong>
                </span>
              </div>
            )}
            {exceedsUnbilled && invoiceAmount !== null && unbilledAmount !== null && (
              <PanelNotice id="invoice-form-unbilled-warning" label="Invoice amount exceeds unbilled balance" dismissible revision={`${invoiceAmount}:${unbilledAmount}`}>
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <span aria-hidden>⚠</span>
                Invoice amount ({formatCur(invoiceAmount)}) exceeds the unbilled balance ({formatCur(unbilledAmount)})
              </p>
              </PanelNotice>
            )}
          </div>
        </div>
      </div>

      {/* ── Extracted Data ─────────────────────────────────────────────── */}
      <div className="rounded-b-lg border-b border-border pb-4">
        <p className="flex items-center gap-1 text-2xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          Extracted Data
        </p>
        <div className="grid grid-cols-2 gap-3.5">
          {/* Invoice Number */}
          <div>
            <Field label="Invoice #" htmlFor="invoice-number" required invoiceState={invoiceNumberFieldState}>
              <Input
                id="invoice-number"
                value={localFields.invoiceNumber}
                onChange={(e) => setField("invoiceNumber", e.target.value)}
                onFocus={() => setFocusedFields((previous) => new Set(previous).add("invoiceNumber"))}
                onBlur={() => saveFieldOnBlur("invoiceNumber")}
                placeholder="Invoice number"
                maxLength={20}
                disabled={isLocked}
                title={isLocked ? "Unapprove to edit" : undefined}
                className={cn(
                  "h-8 text-sm",
                  lockedFields.includes("invoiceNumber")
                    ? "ring-2 ring-destructive"
                    : invoiceNumberDirty && "ring-2 ring-primary",
                )}
              />
            </Field>
            {isLocked && <p className="mt-0.5 text-2xs text-muted-foreground">Unapprove to edit</p>}
            {invoiceNumberDirty && (
              <p className="mt-0.5 text-2xs text-muted-foreground">
                was: {initialFields.invoiceNumber || "—"}
              </p>
            )}
            {fieldErrors.invoiceNumber && <p className="mt-0.5 text-2xs text-destructive" role="alert">{fieldErrors.invoiceNumber}</p>}
          </div>

          {/* Amount */}
          <div>
            <div className="relative">
            <Field label="Amount" htmlFor="invoice-amount" required invoiceState={amountFieldState}>
                <Input
                  id="invoice-amount"
                  type="number"
                  aria-invalid={amountFieldState.ariaInvalid}
                  value={localFields.amount}
                  onChange={(e) => setField("amount", e.target.value)}
                  onFocus={() => setFocusedFields((previous) => new Set(previous).add("amount"))}
                  onBlur={() => saveFieldOnBlur("amount")}
                  placeholder="0.00"
                  disabled={isLocked}
                  title={isLocked ? "Unapprove to edit" : undefined}
                  className={cn(
                    "h-8 text-sm pl-6",
                    lockedFields.includes("amount")
                      ? "ring-2 ring-destructive"
                      : amountDirty && "ring-2 ring-primary",
                  )}
                />
            </Field>
              <span aria-hidden="true" className="absolute bottom-1.5 left-2.5 text-muted-foreground text-sm pointer-events-none">$</span>
            </div>
            {isLocked && <p className="mt-0.5 text-2xs text-muted-foreground">Unapprove to edit</p>}
            {amountDirty && initialFields.amount && (
              <p className="mt-0.5 text-2xs text-muted-foreground">
                was: ${parseFloat(initialFields.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            )}
            {fieldErrors.amount && <p className="mt-0.5 text-2xs text-destructive" role="alert">{fieldErrors.amount}</p>}
          </div>

          {/* Invoice Date */}
          <div>
            <Field label="Invoice Date" htmlFor="invoice-date" required invoiceState={invoiceDateFieldState}>
              <Input
                id="invoice-date"
                type="date"
                value={localFields.invoiceDate}
                onChange={(e) => setField("invoiceDate", e.target.value)}
                onFocus={() => setFocusedFields((previous) => new Set(previous).add("invoiceDate"))}
                onBlur={() => saveFieldOnBlur("invoiceDate")}
                className={cn("h-8 text-sm", invoiceDateDirty && "ring-2 ring-primary")}
              />
            </Field>
            {fieldErrors.invoiceDate && <p className="mt-0.5 text-2xs text-destructive" role="alert">{fieldErrors.invoiceDate}</p>}
          </div>

          {/* Due Date */}
          <div>
            <Field label="Due Date" htmlFor="invoice-due-date" invoiceState={dueDateFieldState}>
              <Input
                id="invoice-due-date"
                type="date"
                value={localFields.dueDate}
                onChange={(e) => setField("dueDate", e.target.value)}
                onFocus={() => setFocusedFields((previous) => new Set(previous).add("dueDate"))}
                onBlur={() => saveFieldOnBlur("dueDate")}
                className={cn("h-8 text-sm", dueDateDirty && "ring-2 ring-primary")}
              />
            </Field>
            {fieldErrors.dueDate && <p className="mt-0.5 text-2xs text-destructive" role="alert">{fieldErrors.dueDate}</p>}
          </div>
        </div>
      </div>
    </div>
  );
});

InvoiceDetailForm.displayName = "InvoiceDetailForm";
