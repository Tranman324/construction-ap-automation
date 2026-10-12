"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Archive, CheckCircle2, Receipt, UploadCloud } from "lucide-react";

import { DestinationPicker } from "@/modules/accounting/modules/invoices/components/documents/DestinationPicker";
import { DocumentFileToProjectButton } from "@/modules/accounting/modules/invoices/components/documents/DocumentFileToProjectButton";
import { showFileToProjectResultToast } from "@/modules/accounting/modules/invoices/components/documents/documentFilingResult";
import {
  getFilingErrorMessage,
} from "@/modules/accounting/modules/invoices/components/documents/documentFilingResult";
import { JobDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown";
import {
  stripFilenameExtension,
  withOriginalFileExtension,
} from "@/modules/accounting/modules/invoices/components/documents/simpleFilingDocumentModel";
import {
  getDocumentAmount,
  getDocumentVendor,
} from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import type { DocumentDestinationsConfig, InvoiceUpdatePayload } from "@/modules/accounting/modules/invoices/types/api";
import type {
  DocumentAction,
  DocumentFilingMeta,
  DocumentFilingResult,
  DocumentFormState,
  DocumentSpecDefinition,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { toSharePointDestination } from "@/modules/accounting/modules/invoices/lib/destinationTree";
import { Input } from "@/modules/shared/components/ui/input";
import { Button } from "@/modules/shared/components/ui/button";
import { Field } from "@/modules/shared/components/patterns/Field";
import { getInvoiceFieldState, type InvoiceFieldState } from "@/modules/shared/components/patterns/invoiceFieldState";
import { toast } from "@/modules/shared/components/ui/toaster";

export interface ReceiptDocumentFormState extends DocumentFormState {
  merchant: string;
  purchaseDate: string;
  total: string;
  jobNumber: string;
  jobManual: boolean;
  categoryCode: string;
  phaseCode: string;
  costType: string;
  destination: string;
  destinationAbsolute?: string;
  filename: string;
  filed: boolean;
  filing: boolean;
  filingError?: string | null;
}

export interface ReceiptCodingOption {
  value: string;
  label: string;
}

export interface ReceiptCodingOptions {
  expenseCategories: ReceiptCodingOption[];
  phaseOptions: ReceiptCodingOption[];
  costTypes: ReceiptCodingOption[];
}

export interface ReceiptDocumentSpecOptions {
  secondaryActions?: readonly DocumentAction[];
  onFileDocument?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onFileToProject?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onUpdateDocument?: (record: Invoice, payload: InvoiceUpdatePayload) => Invoice | void | Promise<Invoice | void>;
  fileToProjectPending?: boolean;
  destinations?: DocumentDestinationsConfig;
  codingOptions?: ReceiptCodingOptions;
}

type AutosaveStatus = "idle" | "saving" | "saved" | "error";
type ReceiptAutosaveField = "merchant" | "purchaseDate" | "total" | "jobNumber" | "categoryCode" | "phaseCode" | "costType";

const selectClassName =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none dark:bg-input/30";
const moneyInputPattern = /^\s*(?:(?:-\s*)?\$?\s*|\$?\s*-\s*)(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?\s*$/;

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function numberToInputValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Number(value.toFixed(2)));
}

function parseInputNumber(value: string): { valid: boolean; value: number | null } {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) return { valid: true, value: null };
  if (!moneyInputPattern.test(value)) return { valid: false, value: null };
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? { valid: true, value: parsed } : { valid: false, value: null };
}

function projectFilename(form: ReceiptDocumentFormState, record: Invoice): string | undefined {
  const candidate = record.filing?.fileName?.value;
  const candidateStem = stripFilenameExtension(candidate);
  if (!form.filename || form.filename === candidateStem || form.filename === candidate) return candidate;
  return withOriginalFileExtension(form.filename, record.file);
}

function projectFileMeta(
  form: ReceiptDocumentFormState,
  record: Invoice,
  rootLabel: string | null | undefined,
): DocumentFilingMeta {
  const filename = projectFilename(form, record);
  const suggested = record.filing?.fileName?.value;
  const isOverride = Boolean(form.filename
    && form.filename !== suggested
    && form.filename !== stripFilenameExtension(suggested));
  return {
    destination: toSharePointDestination(form.destination, rootLabel),
    ...(form.destinationAbsolute !== undefined ? { destinationAbsolute: form.destinationAbsolute } : {}),
    ...(isOverride && filename ? { filename } : {}),
    uploadToSharePoint: true,
  };
}

function getInitialReceiptJobNumber(record: Invoice): string {
  return record.extracted?.jobNumber ?? record.extracted?.jobRef ?? record.matching?.job?.jobNumber ?? "";
}

/**
 * Persisted coding lives on the row under snake_case (with camelCase aliases),
 * outside the typed `Invoice` surface — same access pattern SpectrumSubmitSection
 * uses for its saved-value preference.
 */
function getSavedCoding(record: Invoice): { glAccount: string; phaseCode: string; costType: string } {
  const row = record as unknown as Record<string, unknown>;
  const read = (snake: string, camel: string) => (row[snake] ?? row[camel] ?? "") as string;
  return {
    glAccount: read("gl_account", "glAccount"),
    phaseCode: read("phase_code", "phaseCode"),
    costType: read("cost_type", "costType"),
  };
}

function getInitialReceiptCostType(record: Invoice): string {
  return getSavedCoding(record).costType || record.phaseAllocations?.[0]?.cost_type || "M";
}

function buildReceiptUpdatePayload(record: Invoice, form: ReceiptDocumentFormState): InvoiceUpdatePayload | null {
  const payload: InvoiceUpdatePayload = {};
  if (form.merchant !== getDocumentVendor(record)) payload.vendorName = form.merchant;
  const initialDate = toDateInputValue(record.extracted?.invoiceDate);
  if (form.purchaseDate !== initialDate) payload.invoiceDate = form.purchaseDate;
  const parsedAmount = parseInputNumber(form.total);
  const initialAmount = getDocumentAmount(record);
  if (parsedAmount.valid && parsedAmount.value !== null && parsedAmount.value !== initialAmount) {
    payload.amount = parsedAmount.value;
  }
  if (form.jobNumber !== getInitialReceiptJobNumber(record)) payload.jobNumber = form.jobNumber;
  const savedCoding = getSavedCoding(record);
  if (form.categoryCode !== savedCoding.glAccount) payload.glAccount = form.categoryCode;
  if (form.phaseCode !== savedCoding.phaseCode) payload.phaseCode = form.phaseCode;
  if (form.costType !== getInitialReceiptCostType(record)) payload.costType = form.costType;
  return Object.keys(payload).length > 0 ? payload : null;
}

function getCanonicalReceiptPatch(
  record: Invoice,
  fields: readonly ReceiptAutosaveField[],
): Partial<ReceiptDocumentFormState> {
  const coding = getSavedCoding(record);
  const patch: Partial<ReceiptDocumentFormState> = {};
  fields.forEach((field) => {
    if (field === "merchant") patch.merchant = getDocumentVendor(record);
    if (field === "purchaseDate") patch.purchaseDate = toDateInputValue(record.extracted?.invoiceDate);
    if (field === "total") patch.total = numberToInputValue(getDocumentAmount(record));
    if (field === "jobNumber") patch.jobNumber = getInitialReceiptJobNumber(record);
    if (field === "categoryCode") patch.categoryCode = coding.glAccount;
    if (field === "phaseCode") patch.phaseCode = coding.phaseCode;
    if (field === "costType") patch.costType = getInitialReceiptCostType(record);
  });
  return patch;
}

function CodingSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  required,
  invoiceState,
  hint,
  error,
  success,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (next: string) => void;
  disabled?: boolean;
  required?: boolean;
  invoiceState: InvoiceFieldState;
  hint?: string;
  error?: string;
  success?: string;
}) {
  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      invoiceState={invoiceState}
      hint={hint}
      error={error}
      success={success}
    >
      <select
        id={id}
        aria-label={label}
        className={selectClassName}
        value={value}
        disabled={disabled}
        aria-invalid={invoiceState.ariaInvalid}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select {label.toLowerCase()}...</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </Field>
  );
}

function ReceiptEditFields({
  record,
  form,
  patchForm,
  onUpdateDocument,
  codingOptions,
  defaultDestination,
}: {
  record: Invoice;
  form: ReceiptDocumentFormState;
  patchForm: (patch: Partial<ReceiptDocumentFormState>) => void;
  onUpdateDocument?: (record: Invoice, payload: InvoiceUpdatePayload) => Invoice | void | Promise<Invoice | void>;
  codingOptions?: ReceiptCodingOptions;
  defaultDestination: string;
}) {
  const [fieldStatus, setFieldStatus] = useState<Partial<Record<ReceiptAutosaveField, AutosaveStatus>>>({});
  const [fieldErrors, setFieldErrors] = useState<{ total?: string }>({});
  const pendingPayloadRef = useRef<InvoiceUpdatePayload>({});
  const pendingFieldsRef = useRef<Set<ReceiptAutosaveField>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldVersionRef = useRef<Partial<Record<ReceiptAutosaveField, number>>>({});
  const jobUpdateVersionRef = useRef(0);
  const jobMatch = record.matching?.job ?? null;
  const coding = getSavedCoding(record);
  const financialFieldsLocked = record.status === "approved" || record.status === "modified";
  const controlsUnavailable = !onUpdateDocument || form.filing;
  const requiresJobCostCoding = form.destinationAbsolute === undefined;

  const fieldStates = {
    merchant: getInvoiceFieldState({
      value: form.merchant,
      baseline: getDocumentVendor(record),
      manuallyEdited: record.fieldOrigins?.vendorName?.origin === "manual",
      required: true,
    }),
    purchaseDate: getInvoiceFieldState({
      value: form.purchaseDate,
      baseline: toDateInputValue(record.extracted?.invoiceDate),
      manuallyEdited: record.fieldOrigins?.invoiceDate?.origin === "manual",
      required: true,
    }),
    total: getInvoiceFieldState({
      value: parseInputNumber(form.total).value,
      baseline: getDocumentAmount(record),
      manuallyEdited: record.fieldOrigins?.amount?.origin === "manual",
      required: true,
    }),
    jobNumber: getInvoiceFieldState({
      value: form.jobNumber,
      baseline: getInitialReceiptJobNumber(record),
      manuallyEdited: record.fieldOrigins?.jobNumber?.origin === "manual",
      required: requiresJobCostCoding,
    }),
    categoryCode: getInvoiceFieldState({
      value: form.categoryCode,
      baseline: coding.glAccount,
      manuallyEdited: record.fieldOrigins?.glAccount?.origin === "manual",
      required: requiresJobCostCoding,
    }),
    phaseCode: getInvoiceFieldState({
      value: form.phaseCode,
      baseline: coding.phaseCode,
      manuallyEdited: record.fieldOrigins?.phaseCode?.origin === "manual",
      optional: true,
    }),
    costType: getInvoiceFieldState({
      value: form.costType,
      baseline: getInitialReceiptCostType(record),
      manuallyEdited: record.fieldOrigins?.costType?.origin === "manual",
      optional: true,
    }),
  };

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  function scheduleAutosave(payload: InvoiceUpdatePayload, fields: readonly ReceiptAutosaveField[]) {
    if (!onUpdateDocument) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    pendingPayloadRef.current = { ...pendingPayloadRef.current, ...payload };
    fields.forEach((field) => {
      pendingFieldsRef.current.add(field);
      fieldVersionRef.current[field] = (fieldVersionRef.current[field] ?? 0) + 1;
    });
    setFieldStatus((current) => ({
      ...current,
      ...Object.fromEntries(fields.map((field) => [field, "saving" as AutosaveStatus])),
    }));
    saveTimerRef.current = setTimeout(() => {
      const payloadToSave = pendingPayloadRef.current;
      const fieldsToSave = Array.from(pendingFieldsRef.current);
      const requestVersions = Object.fromEntries(
        fieldsToSave.map((field) => [field, fieldVersionRef.current[field] ?? 0]),
      ) as Partial<Record<ReceiptAutosaveField, number>>;
      pendingPayloadRef.current = {};
      pendingFieldsRef.current = new Set();
      void Promise.resolve()
        .then(() => onUpdateDocument(record, payloadToSave))
        .then((canonicalRecord) => {
          const currentFields = fieldsToSave.filter(
            (field) => requestVersions[field] === fieldVersionRef.current[field],
          );
          if (canonicalRecord && currentFields.length > 0) {
            patchForm(getCanonicalReceiptPatch(canonicalRecord, currentFields));
          }
          setFieldStatus((current) => ({
            ...current,
            ...Object.fromEntries(currentFields.map((field) => [field, "saved" as AutosaveStatus])),
          }));
        })
        .catch(() => {
          const currentFields = fieldsToSave.filter(
            (field) => requestVersions[field] === fieldVersionRef.current[field],
          );
          setFieldStatus((current) => ({
            ...current,
            ...Object.fromEntries(currentFields.map((field) => [field, "error" as AutosaveStatus])),
          }));
        });
    }, 500);
  }

  function updateJob(nextJobNumber: string | null) {
    if (fieldStatus.jobNumber === "saving") return;
    const updateVersion = ++jobUpdateVersionRef.current;
    const jobNumber = nextJobNumber ?? "";
    const previousJobNumber = form.jobNumber;
    const previousDestination = form.destination;
    const previousDestinationAbsolute = form.destinationAbsolute;
    const previousJobManual = form.jobManual;
    patchForm({
      destination: defaultDestination,
      destinationAbsolute: undefined,
      jobNumber,
      jobManual: true,
    });
    if (!onUpdateDocument) return;
    setFieldStatus((current) => ({ ...current, jobNumber: "saving" }));
    void Promise.resolve()
      .then(() => onUpdateDocument(record, { jobNumber }))
      .then(() => {
        if (updateVersion !== jobUpdateVersionRef.current) return;
        setFieldStatus((current) => ({ ...current, jobNumber: "saved" }));
      })
      .catch((error) => {
        if (updateVersion !== jobUpdateVersionRef.current) return;
        patchForm({
          destination: previousDestination,
          destinationAbsolute: previousDestinationAbsolute,
          jobNumber: previousJobNumber,
          jobManual: previousJobManual,
        });
        setFieldStatus((current) => ({ ...current, jobNumber: "error" }));
        toast.error("Receipt update failed", {
          description: getFilingErrorMessage(error),
        });
      });
  }

  function updateTotal(value: string) {
    patchForm({ total: value });
    const parsed = parseInputNumber(value);
    setFieldErrors((current) => ({
      ...current,
      total: parsed.valid ? undefined : "Use a valid dollar amount.",
    }));
    if (!parsed.valid || parsed.value === null) {
      fieldVersionRef.current.total = (fieldVersionRef.current.total ?? 0) + 1;
      delete pendingPayloadRef.current.amount;
      pendingFieldsRef.current.delete("total");
      if (pendingFieldsRef.current.size === 0 && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setFieldStatus((current) => ({ ...current, total: "idle" }));
      return;
    }
    scheduleAutosave({ amount: parsed.value }, ["total"]);
  }

  function updateCategoryCode(value: string) {
    patchForm({ categoryCode: value });
    scheduleAutosave({ glAccount: value }, ["categoryCode"]);
  }

  function updatePhaseCode(value: string) {
    patchForm({ phaseCode: value });
    scheduleAutosave({ phaseCode: value }, ["phaseCode"]);
  }

  function updateCostType(value: string) {
    patchForm({ costType: value });
    scheduleAutosave({ costType: value }, ["costType"]);
  }

  function saveMessage(field: ReceiptAutosaveField) {
    return {
      error: fieldStatus[field] === "error" ? "Save failed. Change the field to retry." : undefined,
      success: fieldStatus[field] === "saved" ? "Saved" : undefined,
    };
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Field label="Merchant" htmlFor={`receipt-merchant-${record.id}`} required invoiceState={fieldStates.merchant} {...saveMessage("merchant")}>
          <Input
            id={`receipt-merchant-${record.id}`}
            aria-label="Merchant"
            value={form.merchant}
            disabled={controlsUnavailable || financialFieldsLocked}
            title={financialFieldsLocked ? "Unapprove to edit" : undefined}
            onChange={(event) => {
              const vendorName = event.target.value;
              patchForm({ merchant: vendorName });
              scheduleAutosave({ vendorName }, ["merchant"]);
            }}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Purchase date" htmlFor={`receipt-date-${record.id}`} required invoiceState={fieldStates.purchaseDate} {...saveMessage("purchaseDate")}>
            <Input
              id={`receipt-date-${record.id}`}
              aria-label="Purchase date"
              type="date"
              value={form.purchaseDate}
              disabled={controlsUnavailable}
              onChange={(event) => {
                const invoiceDate = event.target.value;
                patchForm({ purchaseDate: invoiceDate });
                scheduleAutosave({ invoiceDate }, ["purchaseDate"]);
              }}
            />
          </Field>
          <Field label="Total" htmlFor={`receipt-total-${record.id}`} required invoiceState={fieldStates.total} error={fieldErrors.total ?? saveMessage("total").error} success={saveMessage("total").success}>
            <Input
              id={`receipt-total-${record.id}`}
              aria-label="Total"
              inputMode="decimal"
              value={form.total}
              disabled={controlsUnavailable || financialFieldsLocked}
              title={financialFieldsLocked ? "Unapprove to edit" : undefined}
              aria-invalid={Boolean(fieldErrors.total) || fieldStates.total.ariaInvalid}
              onChange={(event) => updateTotal(event.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <p className="mb-3 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">Job &amp; Cost Coding</p>
        <div className="space-y-3">
          <Field label="Job" htmlFor={`receipt-job-${record.id}`} required={requiresJobCostCoding} invoiceState={fieldStates.jobNumber} {...saveMessage("jobNumber")}>
            <JobDropdown
              id={`receipt-job-${record.id}`}
              value={form.jobNumber || null}
              jobDescription={jobMatch?.jobDescription}
              isManual={form.jobManual}
              disabled={controlsUnavailable || financialFieldsLocked || fieldStatus.jobNumber === "saving"}
              onChange={updateJob}
            />
          </Field>
          <CodingSelect
            id={`receipt-category-${record.id}`}
            label="Expense category"
            value={form.categoryCode}
            options={codingOptions?.expenseCategories ?? []}
            onChange={updateCategoryCode}
            disabled={controlsUnavailable}
            required={requiresJobCostCoding}
            invoiceState={fieldStates.categoryCode}
            hint="Posts to the job-cost ledger."
            {...saveMessage("categoryCode")}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <CodingSelect
              id={`receipt-phase-${record.id}`}
              label="Phase code"
              value={form.phaseCode}
              options={codingOptions?.phaseOptions ?? []}
              onChange={updatePhaseCode}
              disabled={controlsUnavailable}
              invoiceState={fieldStates.phaseCode}
              {...saveMessage("phaseCode")}
            />
            <CodingSelect
              id={`receipt-cost-type-${record.id}`}
              label="Cost type"
              value={form.costType}
              options={codingOptions?.costTypes ?? []}
              onChange={updateCostType}
              disabled={controlsUnavailable}
              invoiceState={fieldStates.costType}
              {...saveMessage("costType")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function createReceiptDocumentSpec(
  options: ReceiptDocumentSpecOptions = {},
): DocumentSpecDefinition<Invoice, ReceiptDocumentFormState> {
  return {
    id: "receipt-document",
    label: "Receipt",
    classifications: ["receipt"],
    initForm: (record) => {
      const amount = getDocumentAmount(record);
      return {
        merchant: getDocumentVendor(record),
        purchaseDate: toDateInputValue(record.extracted?.invoiceDate),
        total: numberToInputValue(amount),
        jobNumber: getInitialReceiptJobNumber(record),
        jobManual: false,
        categoryCode: getSavedCoding(record).glAccount,
        phaseCode: getSavedCoding(record).phaseCode,
        costType: getInitialReceiptCostType(record),
        destination: record.filedDestination ?? options.destinations?.defaults.other ?? "",
        // Historical SharePoint names are display-only. Confirmation uses only
        // the current server-resolved candidate.
        filename: record.filing?.fileName?.value ?? "",
        filed: Boolean(record.filed),
        filing: false,
        filingError: null,
      };
    },
    flushPendingChanges: async ({ record, form }) => {
      const payload = buildReceiptUpdatePayload(record, form);
      if (!payload || !options.onUpdateDocument) return;
      try {
        await options.onUpdateDocument(record, payload);
      } catch (error) {
        toast.error("Receipt update failed", {
          description: error instanceof Error ? error.message : "Receipt changes could not be saved.",
        });
      }
    },
    build: ({ record, form, patchForm }) => {
      const projectFiled = Boolean(record.spFileUrl);
      const jobMatch = record.matching?.job ?? null;
      const jobName = jobMatch?.jobDescription ?? record.extracted?.projectName ?? "Matched project";
      const jobNumber = form.jobNumber || jobMatch?.jobNumber || "Unassigned";
      const suggestedFilename = record.filing?.fileName?.value ?? "";
      const canEditFilename = Boolean(record.filing?.fileName?.permittedActions.includes("edit"));
      const canResetFilename = canEditFilename && form.filename !== suggestedFilename;
      const hasExplicitSharePointDestination = form.destinationAbsolute !== undefined;
      const defaultDestination = options.destinations?.defaults.other ?? "";

      async function shelveReceipt() {
        patchForm({ filing: true, filingError: null });
        try {
          // Honor a browsed SharePoint destination — shelving must not silently
          // discard a picked folder (2026-07-05 filing regression).
          const shelveMeta = form.destinationAbsolute !== undefined && !projectFiled ? projectFileMeta(form, record, options.destinations?.rootLabel) : null;
          const result = await (shelveMeta ? options.onFileDocument?.(record, shelveMeta) : options.onFileDocument?.(record));
          if (shelveMeta) {
            const uploaded = showFileToProjectResultToast(result, `${record.file} filed to ${form.destination}.`);
            patchForm({
              filed: uploaded ? true : form.filed,
              filing: false,
              filingError: uploaded ? null : (result && typeof result === "object" ? result.sharePoint?.error ?? "SharePoint upload did not complete." : "SharePoint upload did not complete."),
            });
            return;
          }
          toast.success("Shelve", {
            description: `${record.file} filed to the document shelf.`,
          });
          patchForm({ filed: true, filing: false });
        } catch (error) {
          const message = getFilingErrorMessage(error);
          patchForm({
            filing: false,
            filingError: message,
          });
          toast.error("Shelve", {
            description: message,
          });
        }
      }

      async function fileReceiptToProject() {
        patchForm({ filing: true, filingError: null });
        try {
          const filename = projectFilename(form, record) ?? record.file;
          const result = await options.onFileToProject?.(record, projectFileMeta(form, record, options.destinations?.rootLabel));
          const uploaded = showFileToProjectResultToast(result, `${filename} filed to ${form.destination}.`);
          patchForm({
            filed: uploaded ? true : form.filed,
            filing: false,
            filingError: uploaded ? null : (result && typeof result === "object" ? result.sharePoint?.error ?? "SharePoint upload did not complete." : "SharePoint upload did not complete."),
          });
        } catch (error) {
          const message = getFilingErrorMessage(error);
          patchForm({
            filing: false,
            filingError: message,
          });
          toast.error("File to Project", {
            description: message,
          });
        }
      }

      return {
        preferredRenderer: "scroll",
        header: {
          kindLabel: "Receipt",
          title: form.merchant,
          subtitle: record.file,
          statusLabel: form.filed ? "Shelved" : "Unfiled",
          statusTone: form.filed ? "ok" : "warn",
          externalStatusLabel: projectFiled ? "Filed to SP" : undefined,
          externalStatusTone: "ok",
          readyLabel: projectFiled ? "Filed" : form.filed ? "Shelved" : "Unfiled",
        },
        alerts: [
          ...(form.filingError
            ? [{ id: "filing-error", sectionId: "destination", tone: "bad" as const, label: "Filing error", detail: form.filingError }]
            : []),
          {
            id: "receipt-card-match",
            tone: "warn" as const,
            label: "No card match",
            detail: "Match this receipt to a purchasing-card transaction.",
            icon: AlertTriangle,
            action: {
              id: "match-receipt-card",
              label: "Match card",
              tone: "primary" as const,
              disabled: true,
              disabledReason: "Card matching is not available from this panel yet.",
              onClick: () => undefined,
            },
          },
        ],
        sections: [
          {
            id: "receipt-captured-data",
            title: "Edit Captured Data",
            icon: Receipt,
            children: (
              <ReceiptEditFields
                record={record}
                form={form}
                patchForm={patchForm}
                onUpdateDocument={options.onUpdateDocument}
                codingOptions={options.codingOptions}
                defaultDestination={defaultDestination}
              />
            ),
          },
          {
            id: "destination",
            title: "Save to SharePoint",
            icon: UploadCloud,
            action: (
              <DocumentFileToProjectButton
                filed={projectFiled}
                disabled={projectFiled || form.filing || Boolean(options.fileToProjectPending) || !options.onFileToProject || !options.destinations}
                pending={options.fileToProjectPending}
                onClick={fileReceiptToProject}
              />
            ),
            children: (
              <div className="space-y-3">
                <DestinationPicker
                  value={form.destination}
                  onChange={(destination) => patchForm({ destination })}
                  onChangePath={(destinationAbsolute) => patchForm({ destinationAbsolute })}
                  jobId={jobNumber}
                  jobName={jobName}
                  disabled={form.filing || projectFiled}
                  note="Browse opens at the matched project when available. Use Projects root to choose another project."
                />
                {hasExplicitSharePointDestination ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={form.filing || projectFiled}
                    onClick={() => patchForm({
                      destination: defaultDestination,
                      destinationAbsolute: undefined,
                    })}
                  >
                    Clear SharePoint destination
                  </Button>
                ) : null}
                <div className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center justify-between gap-2">
                    <label htmlFor={`filing-filename-${record.id}`}>File name</label>
                    {canResetFilename ? (
                      <Button type="button" variant="ghost" size="xs" onClick={() => patchForm({ filename: suggestedFilename })}>
                        Reset
                      </Button>
                    ) : null}
                  </span>
                  <Input
                    id={`filing-filename-${record.id}`}
                    value={form.filename}
                    onChange={(event) => patchForm({ filename: event.target.value })}
                    maxLength={128}
                    readOnly={!canEditFilename}
                    disabled={form.filing || projectFiled || !canEditFilename}
                    placeholder="Receipt name"
                  />
                </div>
              </div>
            ),
          },
        ],
        primaryAction: {
          id: "shelve-receipt",
          label: form.filed
            ? "Filed to Job Cost"
            : hasExplicitSharePointDestination
              ? "File to SharePoint"
              : "File to Job Cost",
          icon: form.filed ? CheckCircle2 : Archive,
          disabled: form.filed
            || form.filing
            || !options.onFileDocument
            || (hasExplicitSharePointDestination
              ? !options.destinations
              : !form.jobNumber || !form.categoryCode),
          pending: form.filing,
          onClick: shelveReceipt,
        },
        secondaryActions: [...(options.secondaryActions ?? [])],
      };
    },
  };
}
