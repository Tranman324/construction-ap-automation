"use client";

import { FilingFilenameField, getFilenameOverride } from "./documentFilenameField";

import { CheckCircle2, FileText, FolderOpen, Pencil, RefreshCw, UploadCloud } from "lucide-react";

import { DestinationPicker } from "@/modules/accounting/modules/invoices/components/documents/DestinationPicker";
import { DocumentKeyValueRows } from "@/modules/accounting/modules/invoices/components/documents/DocumentAtoms";
import { getFilingErrorMessage, showFileToProjectResultToast } from "@/modules/accounting/modules/invoices/components/documents/documentFilingResult";
import { formatDocumentDate } from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import { OtherClassificationField, OtherNoteField } from "@/modules/accounting/modules/invoices/components/documents/otherDocumentViews";
import { getOtherFilingData, getReclassifyOptions } from "@/modules/accounting/modules/invoices/components/documents/simpleFilingDocumentModel";
import { JobDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown";
import { toSharePointDestination } from "@/modules/accounting/modules/invoices/lib/destinationTree";
import { toast } from "@/modules/shared/components/ui/toaster";
import type { ClassificationInfo, DocumentDestinationsConfig, InvoiceUpdatePayload } from "@/modules/accounting/modules/invoices/types/api";
import type { DocumentFilingMeta, DocumentFilingResult, DocumentFormState, DocumentSpecDefinition } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

export interface OtherDocumentFormState extends DocumentFormState {
  destination: string;
  filename: string;
  destinationAbsolute?: string;
  jobNumber: string;
  jobManual: boolean;
  jobSaving: boolean;
  jobSeed: string;
  note: string;
  filed: boolean;
  filing: boolean;
  filingError: string | null;
  reclassifyTarget: string;
}

export interface OtherDocumentSpecOptions {
  classifications?: readonly ClassificationInfo[];
  destinations?: DocumentDestinationsConfig;
  destinationsLoading?: boolean;
  destinationsUnavailable?: boolean;
  filePending?: boolean;
  fileToProjectPending?: boolean;
  reclassifyDisabled?: boolean;
  reclassifyPending?: boolean;
  onFileDocument?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onFileToProject?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onReclassify?: (classification: string) => void;
  onUpdateDocument?: (record: Invoice, payload: InvoiceUpdatePayload) => Invoice | void | Promise<Invoice | void>;
}

function pageCount(record: Invoice): string {
  const count = record.splitSuggestion?.pageCount;
  return typeof count === "number" && count > 0 ? String(Math.floor(count)) : "Unavailable";
}

export function createOtherDocumentSpec(options: OtherDocumentSpecOptions = {}): DocumentSpecDefinition<Invoice, OtherDocumentFormState> {
  return {
    id: "other-document",
    label: "Other Document",
    fallback: true,
    initForm: (record) => {
      const data = getOtherFilingData(record);
      return {
        filename: record.filing?.fileName?.value ?? "",
        destinationAbsolute: undefined,
        destination: record.filedDestination ?? options.destinations?.defaults.other ?? "",
        jobNumber: data.job.id === "Unassigned" ? "" : data.job.id,
        jobManual: false,
        jobSaving: false,
        jobSeed: data.job.id === "Unassigned" ? "" : data.job.id,
        note: record.notes ?? "",
        filed: Boolean(record.filed),
        filing: false,
        filingError: null,
        reclassifyTarget: "",
      };
    },
    build: ({ record, form, patchForm }) => {
      const data = getOtherFilingData(record);
      const reclassifyOptions = getReclassifyOptions(record.classification, options.classifications);
      const selectedClassification = reclassifyOptions.find((item) => item.name === form.reclassifyTarget);
      const jobMatch = record.matching?.job ?? null;
      const serverJobNumber = data.job.id === "Unassigned" ? "" : data.job.id;
      const serverJobChanged = !form.jobManual && form.jobSeed !== serverJobNumber;
      const jobNumber = serverJobChanged ? serverJobNumber : form.jobNumber;
      const defaultDestination = options.destinations?.defaults.other ?? "";
      const destination = serverJobChanged ? defaultDestination : form.destination || defaultDestination;
      const destinationAbsolute = serverJobChanged ? undefined : form.destinationAbsolute;
      const jobName = jobMatch?.jobDescription ?? (form.jobManual ? "Selected project" : data.job.name);
      // `""` is the explicit Projects-root choice. `undefined` alone means the
      // user has not picked a SharePoint destination, so do not collapse those
      // two states into the Documents filing path.
      const isSharePointFiling = destinationAbsolute !== undefined;
      const sharePointDestinationUnavailable = isSharePointFiling
        && (Boolean(options.destinationsLoading) || Boolean(options.destinationsUnavailable) || !options.destinations);

      async function updateJob(nextJobNumber: string | null) {
        const previousJobNumber = jobNumber;
        const previousDestination = destination;
        const previousDestinationAbsolute = destinationAbsolute;
        const previousJobManual = form.jobManual;
        const previousJobSeed = form.jobSeed;
        const requestedJobNumber = nextJobNumber ?? "";
        patchForm({
          destination: defaultDestination,
          destinationAbsolute: undefined,
          filingError: null,
          jobNumber: requestedJobNumber,
          jobManual: true,
          jobSaving: true,
          jobSeed: serverJobNumber,
        });
        try {
          await options.onUpdateDocument?.(record, { jobNumber: requestedJobNumber });
          patchForm({ jobSaving: false });
        } catch (error) {
          const message = getFilingErrorMessage(error);
          patchForm({
            destination: previousDestination,
            destinationAbsolute: previousDestinationAbsolute,
            filingError: message,
            jobManual: previousJobManual,
            jobNumber: previousJobNumber,
            jobSaving: false,
            jobSeed: previousJobSeed,
          });
          toast.error("Document update failed", { description: message });
        }
      }

      function reclassify(classification: string) {
        if (!classification || form.jobSaving || options.reclassifyDisabled || options.reclassifyPending) return;
        options.onReclassify?.(classification);
      }

      async function fileDocument() {
        patchForm({ filing: true, filingError: null });
        try {
          const meta = isSharePointFiling ? {
            destination: toSharePointDestination(destination, options.destinations?.rootLabel),
            destinationAbsolute,
            ...(form.note.trim() ? { note: form.note.trim() } : {}),
            ...getFilenameOverride(form.filename, record),
            uploadToSharePoint: true,
          } : undefined;
          const result = await (isSharePointFiling
            ? options.onFileToProject?.(record, meta)
            : options.onFileDocument?.(record));
          if (isSharePointFiling) {
            const uploaded = showFileToProjectResultToast(result, `${data.fileName} filed to ${destination}.`);
            patchForm({
              filed: uploaded ? true : form.filed,
              filing: false,
              filingError: uploaded ? null : (result && typeof result === "object" ? result.sharePoint?.error ?? "SharePoint upload did not complete." : "SharePoint upload did not complete."),
            });
            return;
          }
          toast.success("Filed in Documents", { description: `${data.fileName} filed in Documents.` });
          patchForm({ filed: true, filing: false });
        } catch (error) {
          const message = getFilingErrorMessage(error);
          patchForm({ filing: false, filingError: message });
          toast.error("File in Documents", { description: message });
        }
      }

      return {
        preferredRenderer: "scroll",
        header: {
          kindLabel: data.classificationLabel,
          title: data.subject || data.source,
          subtitle: data.fileName,
          statusLabel: form.filed ? "Filed" : selectedClassification ? `→ ${selectedClassification.label}` : "Ready",
          statusTone: form.filed ? "ok" : selectedClassification ? "info" : "warn",
          readyLabel: form.filed ? "Filed" : "Ready",
        },
        alerts: [
          ...(record.error ? [{ id: "pipeline-error", sectionId: "captured", tone: "bad" as const, label: "Pipeline error", detail: record.error.message }] : []),
          ...(options.destinationsUnavailable ? [{ id: "destination-unavailable", sectionId: "destination", tone: "bad" as const, label: "SharePoint destination unavailable", detail: "The served destination catalog could not be loaded." }] : []),
          ...(form.filingError ? [{ id: "filing-error", sectionId: "destination", tone: "bad" as const, label: "Filing error", detail: form.filingError }] : []),
        ],
        sections: [
          { id: "captured", title: "Captured", icon: FileText, children: <div className="space-y-3">
            <JobDropdown
              id={`other-job-${record.id}`}
              value={jobNumber || null}
              jobDescription={jobMatch?.jobDescription ?? data.job.name}
              isManual={form.jobManual}
              disabled={form.filing || form.filed || form.jobSaving || !options.onUpdateDocument}
              onChange={(jobNumber) => { void updateJob(jobNumber); }}
            />
            <DocumentKeyValueRows rows={[
              { label: "Source", value: data.source },
              { label: "Received", value: formatDocumentDate(data.received), mono: true },
              { label: "Pages", value: pageCount(record), mono: true },
            ]} />
          </div> },
          { id: "destination", title: "Save to SharePoint", icon: UploadCloud, children: <div className="space-y-3"><DestinationPicker
            value={destination}
            onChange={(nextDestination) => patchForm({ destination: nextDestination, jobNumber, jobSeed: serverJobNumber })}
            onChangePath={(nextDestinationAbsolute) => patchForm({ destinationAbsolute: nextDestinationAbsolute, jobNumber, jobSeed: serverJobNumber })}
            jobId={jobNumber}
            jobName={jobName}
            disabled={form.filing || form.filed || form.jobSaving || !options.destinations || options.destinationsUnavailable || options.destinationsLoading}
            note={options.destinationsLoading
              ? "Loading available SharePoint folders…"
              : "Browse opens at the assigned project. Changing the job resets this destination."}
          /><FilingFilenameField record={record} value={form.filename} onChange={(filename) => patchForm({ filename })}
            filing={form.filing || Boolean(options.filePending) || Boolean(options.fileToProjectPending)} filed={form.filed} /></div> },
          { id: "classify", title: "Classify", icon: RefreshCw, children: <OtherClassificationField
            classifications={reclassifyOptions} value={form.reclassifyTarget}
            disabled={!options.onReclassify || form.jobSaving || options.reclassifyDisabled || options.reclassifyPending}
            onChange={reclassify} /> },
          { id: "note", title: "Note", icon: Pencil, children: <OtherNoteField
            value={form.note} baseline={record.notes ?? ""} onChange={(note) => patchForm({ note })} /> },
        ],
        primaryAction: {
          id: "file-other-document",
          label: form.filed
            ? "Filed in Documents"
            : isSharePointFiling
              ? "File to SharePoint"
              : "File in Documents",
          icon: form.filed ? CheckCircle2 : FolderOpen,
          disabled: form.filed || form.filing || form.jobSaving || sharePointDestinationUnavailable
            || (isSharePointFiling ? Boolean(options.fileToProjectPending) || !options.onFileToProject : Boolean(options.filePending) || !options.onFileDocument),
          pending: form.filing || form.jobSaving
            || (isSharePointFiling ? Boolean(options.fileToProjectPending) : Boolean(options.filePending)),
          onClick: fileDocument,
        },
        secondaryActions: [],
      };
    },
  };
}
