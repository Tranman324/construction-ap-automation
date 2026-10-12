"use client";

import { Archive, BriefcaseBusiness, CheckCircle2, Clock, FileText, FolderOpen, UploadCloud } from "lucide-react";

import { DestinationPicker } from "@/modules/accounting/modules/invoices/components/documents/DestinationPicker";
import { DocumentFileToProjectButton } from "@/modules/accounting/modules/invoices/components/documents/DocumentFileToProjectButton";
import { DocumentKeyValueRows } from "@/modules/accounting/modules/invoices/components/documents/DocumentAtoms";
import { showFileToProjectResultToast } from "@/modules/accounting/modules/invoices/components/documents/documentFilingResult";
import {
  getFilingErrorMessage,
} from "@/modules/accounting/modules/invoices/components/documents/documentFilingResult";
import { JobDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown";
import {
  classificationLabel,
  getOtherFilingData,
  stripFilenameExtension,
  withOriginalFileExtension,
} from "@/modules/accounting/modules/invoices/components/documents/simpleFilingDocumentModel";
import type {
  DocumentAction,
  DocumentFilingMeta,
  DocumentFilingResult,
  DocumentFormState,
  DocumentSpecDefinition,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { AuditEntry, DocumentDestinationsConfig, InvoiceUpdatePayload } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { toSharePointDestination } from "@/modules/accounting/modules/invoices/lib/destinationTree";
import { Input } from "@/modules/shared/components/ui/input";
import { Button } from "@/modules/shared/components/ui/button";
import { toast } from "@/modules/shared/components/ui/toaster";

export interface FallbackDocumentFormState extends DocumentFormState {
  destination: string;
  destinationAbsolute?: string;
  filename: string;
  jobNumber: string;
  jobManual: boolean;
  jobSaving: boolean;
  filed: boolean;
  filing: boolean;
  filingError?: string | null;
}

export interface FallbackDocumentSpecOptions {
  onDiscard?: (invoice: Invoice) => void;
  onFileDocument?: (invoice: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onFileToProject?: (invoice: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onUpdateDocument?: (invoice: Invoice, payload: InvoiceUpdatePayload) => Invoice | void | Promise<Invoice | void>;
  auditEntries?: readonly AuditEntry[];
  secondaryActions?: readonly DocumentAction[];
  fileToProjectPending?: boolean;
  destinations?: DocumentDestinationsConfig;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const formatAuditAction = (value: string): string => value.replace(/[-_]/g, " ");

function projectFilename(form: FallbackDocumentFormState, record: Invoice): string | undefined {
  const candidate = record.filing?.fileName?.value;
  const candidateStem = stripFilenameExtension(candidate);
  if (!form.filename || form.filename === candidateStem || form.filename === candidate) return candidate;
  return withOriginalFileExtension(form.filename, record.file);
}

function projectFileMeta(
  form: FallbackDocumentFormState,
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

function getInitialFallbackJobNumber(record: Invoice): string {
  const data = getOtherFilingData(record);
  return data.job.id === "Unassigned" ? "" : data.job.id;
}

export function createFallbackDocumentSpec(
  options: FallbackDocumentSpecOptions = {},
): DocumentSpecDefinition<Invoice, FallbackDocumentFormState> {
  return {
    id: "simple-filing-document",
    label: "Simple Filing Document",
    fallback: true,
    initForm: (record) => {
      return {
        destination: record.filedDestination ?? options.destinations?.defaults.other ?? "",
        // Historical SharePoint names are display-only. Confirmation uses only
        // the current server-resolved candidate.
        filename: record.filing?.fileName?.value ?? "",
        jobNumber: getInitialFallbackJobNumber(record),
        jobManual: false,
        jobSaving: false,
        filed: Boolean(record.filed),
        filing: false,
        filingError: null,
      };
    },
    flushPendingChanges: async ({ record, form }) => {
      if (!options.onUpdateDocument) return;
      if (form.jobNumber === getInitialFallbackJobNumber(record)) return;
      try {
        await options.onUpdateDocument(record, { jobNumber: form.jobNumber });
      } catch (error) {
        toast.error("Document update failed", {
          description: error instanceof Error ? error.message : "Document changes could not be saved.",
        });
      }
    },
    build: ({ record, form, patchForm }) => {
      const data = getOtherFilingData(record);
      const projectFiled = Boolean(record.spFileUrl);
      const settled = form.filed || form.filing;
      const jobNumber = form.jobNumber || data.job.id;
      const jobMatch = record.matching?.job ?? null;
      const jobName = jobMatch?.jobDescription ?? (jobNumber !== "Unassigned" && data.job.name === "Unassigned job" ? "Selected project" : data.job.name);
      const isBuildingPermit = record.classification === "building-permit";
      const suggestedFilename = record.filing?.fileName?.value ?? "";
      const canEditFilename = Boolean(record.filing?.fileName?.permittedActions.includes("edit"));
      const canResetFilename = canEditFilename && form.filename !== suggestedFilename;

      async function updateJob(nextJobNumber: string | null) {
        if (form.jobSaving) return;
        const value = nextJobNumber ?? "";
        const previousJobNumber = form.jobNumber;
        const previousDestination = form.destination;
        const previousDestinationAbsolute = form.destinationAbsolute;
        const previousJobManual = form.jobManual;
        patchForm({
          destination: options.destinations?.defaults.other ?? "",
          destinationAbsolute: undefined,
          jobNumber: value,
          jobManual: true,
          jobSaving: true,
        });
        try {
          await Promise.resolve().then(() => options.onUpdateDocument?.(record, { jobNumber: value }));
          patchForm({ jobSaving: false });
        } catch (error) {
          patchForm({
            destination: previousDestination,
            destinationAbsolute: previousDestinationAbsolute,
            jobNumber: previousJobNumber,
            jobManual: previousJobManual,
            jobSaving: false,
          });
          toast.error("Document update failed", {
            description: error instanceof Error ? error.message : "Document changes could not be saved.",
          });
        }
      }

      async function shelveDocument() {
        patchForm({ filing: true, filingError: null });
        try {
          // If the user browsed to a SharePoint folder, honor it — shelving
          // must not silently discard a picked destination (2026-07-05 bug:
          // docs marked filed with destination dropped, no SP upload).
          const shelveMeta = form.destinationAbsolute !== undefined && !projectFiled ? projectFileMeta(form, record, options.destinations?.rootLabel) : null;
          const result = await (shelveMeta ? options.onFileDocument?.(record, shelveMeta) : options.onFileDocument?.(record));
          if (shelveMeta) {
            const uploaded = showFileToProjectResultToast(result, `${data.fileName} filed to ${form.destination}.`);
            patchForm({
              filed: uploaded ? true : form.filed,
              filing: false,
              filingError: uploaded ? null : (result && typeof result === "object" ? result.sharePoint?.error ?? "SharePoint upload did not complete." : "SharePoint upload did not complete."),
            });
            return;
          }
          toast.success("Shelve", {
            description: `${data.fileName} filed to the document shelf.`,
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

      async function fileDocumentToProject() {
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

      const activitySection =
        options.auditEntries
          ? [{
              id: "activity",
              title: "Activity",
              icon: Clock,
              children: options.auditEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity recorded.</p>
              ) : (
                <div className="space-y-2">
                  {options.auditEntries.map((entry) => (
                    <div key={entry.id} className="flex gap-2.5 text-sm">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="capitalize text-foreground">{formatAuditAction(entry.action)}</span>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDate(entry.createdAt)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{entry.actor}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ),
            }]
          : [];

      return {
        isFallback: true,
        preferredRenderer: "scroll",
        header: {
          kindLabel: classificationLabel(record.classification),
          title: data.subject || data.source,
          subtitle: data.fileName,
          statusLabel: isBuildingPermit && projectFiled ? "Filed to Project" : form.filed ? "Shelved" : "Ready",
          statusTone: (isBuildingPermit && projectFiled) || form.filed ? "ok" : "warn",
          externalStatusLabel: !isBuildingPermit && projectFiled ? "Filed to SP" : undefined,
          externalStatusTone: "ok",
          readyLabel: projectFiled ? "Filed" : form.filed ? "Shelved" : "Ready",
        },
        alerts: record.error
          ? [
              {
                id: "pipeline-error",
                sectionId: "captured",
                tone: "bad",
                label: "Pipeline error",
                detail: record.error.message,
              },
              ...(form.filingError ? [{ id: "filing-error", sectionId: "destination", tone: "bad" as const, label: "Filing error", detail: form.filingError }] : []),
            ]
          : form.filingError
            ? [{ id: "filing-error", sectionId: "destination", tone: "bad" as const, label: "Filing error", detail: form.filingError }]
            : [],
        sections: [
          {
            id: "captured",
            title: "Captured Job Match",
            icon: BriefcaseBusiness,
            flagged: !form.jobNumber,
            children: (
              <div className="space-y-3">
                <JobDropdown
                  value={form.jobNumber || null}
                  jobDescription={jobMatch?.jobDescription ?? data.job.name}
                  isManual={form.jobManual}
                  disabled={form.jobSaving}
                  onChange={(nextJobNumber) => {
                    void updateJob(nextJobNumber);
                  }}
                />
                <DocumentKeyValueRows
                  rows={[
                    { label: "Matched from", value: jobMatch?.method ?? "Document context" },
                    { label: "Project address", value: record.extracted?.projectAddress ?? "-" },
                  ]}
                />
              </div>
            ),
          },
          {
            id: "destination",
            title: "Save to SharePoint",
            icon: UploadCloud,
            action: isBuildingPermit ? undefined : (
              <DocumentFileToProjectButton
                filed={projectFiled}
                disabled={projectFiled || form.filing || Boolean(options.fileToProjectPending) || !options.onFileToProject || !options.destinations}
                pending={options.fileToProjectPending}
                onClick={fileDocumentToProject}
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
                    placeholder="Document name"
                  />
                </div>
              </div>
            ),
          },
          {
            id: "source",
            title: "Source",
            icon: FileText,
            children: (
              <DocumentKeyValueRows
                rows={[
                  { label: "Source", value: data.source },
                  { label: "Scope", value: data.scope },
                ]}
              />
            ),
          },
          ...activitySection,
        ],
        primaryAction: isBuildingPermit ? {
          id: "file-to-project",
          label: projectFiled ? "Filed to Project" : "File to SharePoint",
          icon: projectFiled ? CheckCircle2 : FolderOpen,
          disabled: projectFiled || form.filing || Boolean(options.fileToProjectPending) || !options.onFileToProject || !options.destinations,
          pending: form.filing || Boolean(options.fileToProjectPending),
          onClick: fileDocumentToProject,
        } : {
          id: "shelve-document",
          label: form.filed
            ? "Shelved"
            : form.destinationAbsolute !== undefined
              ? "File to SharePoint"
              : "Shelve",
          icon: form.filed ? CheckCircle2 : Archive,
          disabled: settled || form.jobSaving || !options.onFileDocument,
          pending: form.filing || form.jobSaving,
          onClick: shelveDocument,
        },
        secondaryActions: [...(options.secondaryActions ?? [])],
      };
    },
  };
}
