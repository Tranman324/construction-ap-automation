"use client";

import {
  ClipboardList,
  CheckCircle2,
  ClipboardCheck,
  Layers3,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PanelNotice } from "./PanelNotice";

import { CoiCoverageLines } from "@/modules/accounting/modules/invoices/components/documents/coiCoverageLines";
import { getCoiDisplayData, getCoiFormSeeds } from "@/modules/accounting/modules/invoices/components/documents/coiDocumentData";
import {
  CoiComplianceChecks,
  CoiSpectrumFields,
} from "@/modules/accounting/modules/invoices/components/documents/coiDocumentViews";
import type { ApplyCoiOverrideResponse, InvoiceUpdatePayload, RevokeCoiOverrideResponse, UpdateCoiManualValuesPayload, UpdateCoiManualValuesResponse, UploadCoiToSpectrumPayload, UploadCoiToSpectrumResponse } from "@/modules/accounting/modules/invoices/types/api";
import type {
  DocumentAction,
  DocumentFormState,
  DocumentSpecDefinition,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { isApiError } from "@/modules/shared/lib/api";

export interface CoiDocumentFormState extends DocumentFormState {
  vendorCode: string;
  expirationDate: string;
  comment: string;
  synced: boolean;
  uploaded: boolean;
  uploading: boolean;
  queued: boolean;
  expandedCoverage: Record<string, boolean>;
}

export interface CoiDocumentSpecOptions {
  secondaryActions?: readonly DocumentAction[];
  onUploadToSpectrum?: (record: Invoice, payload: UploadCoiToSpectrumPayload) => Promise<UploadCoiToSpectrumResponse | void> | UploadCoiToSpectrumResponse | void;
  uploadToSpectrumPending?: boolean;
  onUpdateDocument?: (record: Invoice, payload: InvoiceUpdatePayload) => Invoice | void | Promise<Invoice | void>;
  onViewDocument?: (record: Invoice) => void;
  canOverride?: boolean;
  onApplyOverride?: (record: Invoice, checkId: string, reason?: string) => Promise<ApplyCoiOverrideResponse> | ApplyCoiOverrideResponse;
  onRevokeOverride?: (record: Invoice, checkId: string) => Promise<RevokeCoiOverrideResponse> | RevokeCoiOverrideResponse;
  onUpdateManualValues?: (record: Invoice, payload: UpdateCoiManualValuesPayload) => Promise<UpdateCoiManualValuesResponse> | UpdateCoiManualValuesResponse;
}

const GENERIC_SPECTRUM_UPLOAD_ERROR =
  "Spectrum upload failed. Retry; if it fails again, ask an admin to check the Toolbox logs.";

// Older documents may still hold raw developer text from the Spectrum library
// (file paths, env var names, HTML, RPC payloads). Never show that to users.
const TECHNICAL_ERROR_PATTERN =
  /\/root\/|\/home\/|\.env\b|SPECTRUM_|JSON-RPC|PROIV|HTML:|<|\bError:|\n\s*at\s|\bat\s+\S+\s+\(\S+:\d+:\d+\)/i;

function toUserFacingSpectrumError(message: string): string {
  const trimmed = message.trim();
  return TECHNICAL_ERROR_PATTERN.test(trimmed) ? GENERIC_SPECTRUM_UPLOAD_ERROR : trimmed;
}

function getUploadError(record: Invoice): string | null {
  if (record.spectrumUploadError?.trim()) return toUserFacingSpectrumError(record.spectrumUploadError);
  if (record.lastSpectrumError?.trim()) return toUserFacingSpectrumError(record.lastSpectrumError);
  if (record.error?.stage.toLowerCase().includes("spectrum") && record.error.message.trim()) {
    return toUserFacingSpectrumError(record.error.message);
  }
  if (record.spectrumUploadStatus === "failed") return "Spectrum upload failed. Review the document and try again.";
  return null;
}

function getUploadState(record: Invoice) {
  const status = record.spectrumUploadStatus;
  const failed = status === "failed" || Boolean(getUploadError(record));
  return {
    queued: !failed && (status === "queued" || status === "processing"),
    uploaded: status === "success" || record.status === "reviewed",
    failed,
  };
}

function getErrorMessage(error: unknown, fallback = "Spectrum rejected the COI upload request."): string {
  if (isApiError(error) && error.message.trim()) return error.message.trim();
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
}

export function createCoiDocumentSpec(
  options: CoiDocumentSpecOptions = {},
): DocumentSpecDefinition<Invoice, CoiDocumentFormState> {
  return {
    id: "coi-document",
    label: "COI",
    classifications: ["coi"],
    initForm: (record) => {
      const seeds = getCoiFormSeeds(record);
      return {
        vendorCode: seeds.vendorCode,
        expirationDate: seeds.expirationDate,
        comment: "",
        synced: false,
        uploaded: getUploadState(record).uploaded,
        uploading: false,
        queued: false,
        expandedCoverage: {},
      };
    },
    flushPendingChanges: async ({ record, form }) => {
      if (!options.onUpdateDocument) return;
      const seeds = getCoiFormSeeds(record);
      const payload: InvoiceUpdatePayload = {};
      if (form.vendorCode !== seeds.vendorCode || form.expirationDate !== seeds.expirationDate) return;
      if (Object.keys(payload).length === 0) return;
      try {
        await options.onUpdateDocument(record, payload);
      } catch (error) {
        toast.error("COI update failed", {
          description: getErrorMessage(error, "The COI change could not be saved."),
        });
      }
    },
    build: ({ record, form, patchForm }) => {
      const compliance = record.compliance;
      if (!compliance) {
        return {
          preferredRenderer: "scroll" as const,
          header: {
            kindLabel: "COI",
            title: record.file,
            subtitle: record.file,
            statusLabel: "Compliance result unavailable",
            statusTone: "bad" as const,
            readyLabel: "Unavailable",
          },
          sections: [
            {
              id: "coi-compliance-unavailable",
              title: "Compliance",
              icon: ShieldCheck,
              children: (
                <PanelNotice id="coi-compliance-unavailable" label="Compliance result unavailable">
                <div role="alert" className="px-1 py-4 text-sm text-muted-foreground">
                  Server compliance result is unavailable. COI compliance cannot be evaluated or uploaded until the detail response supplies it.
                </div>
                </PanelNotice>
              ),
            },
          ],
          secondaryActions: [...(options.secondaryActions ?? [])],
        };
      }

      const data = getCoiDisplayData(record);
      const secondaryActions = [...(options.secondaryActions ?? [])];
      const uploadError = getUploadError(record);
      const uploadState = getUploadState(record);
      const uploaded = form.uploaded || uploadState.uploaded;
      const uploadPending = form.uploading || Boolean(options.uploadToSpectrumPending);
      const failed = uploadState.failed || Boolean(uploadError);
      const queued = (form.queued || uploadState.queued) && !uploaded && !failed;

      async function approveCheck(checkId: string, reason?: string) {
        if (!options.canOverride || !options.onApplyOverride) return;
        try {
          await options.onApplyOverride(record, checkId, reason);
        } catch (error) {
          toast.error(getErrorMessage(error));
        }
      }

      async function revokeCheck(checkId: string) {
        if (!options.canOverride || !options.onRevokeOverride) return;
        try {
          await options.onRevokeOverride(record, checkId);
        } catch (error) {
          toast.error(getErrorMessage(error));
        }
      }

      function toggleCoverage(lineId: string) {
        patchForm({ expandedCoverage: { ...form.expandedCoverage, [lineId]: !form.expandedCoverage[lineId] } });
      }

      async function updateVendorCode(vendorCode: string) {
        if (!options.onUpdateManualValues) return;
        try {
          const response = await options.onUpdateManualValues(record, { vendorCode: vendorCode || null });
          patchForm({ vendorCode: response.compliance.vendorCode.value ?? "" });
        } catch (error) {
          toast.error("COI update failed", {
            description: getErrorMessage(error, "The COI change could not be saved."),
          });
        }
      }

      async function updateExpirationDate(expirationDate: string) {
        if (!options.onUpdateManualValues) return;
        try {
          const response = await options.onUpdateManualValues(record, { expirationDate: expirationDate || null });
          patchForm({ expirationDate: response.compliance.expiration.value.expirationDate ?? "" });
        } catch (error) {
          toast.error("COI update failed", {
            description: getErrorMessage(error, "The COI change could not be saved."),
          });
        }
      }

      async function uploadCoi() {
        if (!options.onUploadToSpectrum) return;
        patchForm({ uploading: true, queued: false });
        try {
          await options.onUploadToSpectrum(record, {
            vendorCode: form.vendorCode.trim(),
            expirationDate: form.expirationDate,
          });
          patchForm({ uploading: false, queued: true });
          toast.success("COI queued for Spectrum", {
            description: `${data.insured} was accepted for Spectrum upload. Status will update after processing finishes.`,
          });
        } catch (error) {
          patchForm({ uploading: false, queued: false });
          toast.error("COI upload failed", {
            description: getErrorMessage(error),
            duration: Infinity,
            action: options.onViewDocument
              ? {
                  label: "View document",
                  onClick: () => options.onViewDocument?.(record),
                }
              : undefined,
          });
        }
      }

      return {
        preferredRenderer: "tabs",
        tabStyle: "invoice-detail",
        tabs: [
          { id: "details", label: "Compliance", icon: ClipboardCheck },
          { id: "coverage", label: "Coverage", icon: Layers3 },
          { id: "activity", label: "Activity", icon: ClipboardList },
        ],
        header: {
          kindLabel: "COI",
          title: data.insured,
          subtitle: record.file,
          statusLabel: failed ? "Upload failed" : uploaded ? "Uploaded to Spectrum" : queued ? "Queued in Spectrum" : compliance.verdict === "compliant" ? "Compliant" : compliance.verdict === "review-required" ? "Review Required" : "Non-Compliant",
          statusTone: uploadError ? "bad" : uploaded || queued ? "ok" : compliance.verdict === "compliant" ? "ok" : compliance.verdict === "review-required" ? "warn" : "bad",
          readyLabel: uploaded ? "Uploaded" : queued ? "Queued" : "Ready",
        },
        alerts: [
          ...(uploadError
            ? [{ id: "coi-upload-failed", tabId: "details", sectionId: "submission-status", tone: "bad" as const, label: "Upload failed", detail: uploadError, icon: XCircle }]
            : []),
        ],
        sections: [
          {
            id: "spectrum",
            tabId: "details",
            title: "Spectrum Submission",
            icon: UploadCloud,
            flagged: !compliance.uploadReady || compliance.blockers.length > 0,
            children: (
              <CoiSpectrumFields
                data={data}
                vendorCode={form.vendorCode}
                expirationDate={form.expirationDate}
                comment={form.comment}
                onVendorCodeChange={(vendorCode) => void updateVendorCode(vendorCode)}
                onExpirationDateChange={(expirationDate) => void updateExpirationDate(expirationDate)}
                onCommentChange={(comment) => patchForm({ comment })}
                canOverride={options.canOverride}
              />
            ),
          },
          {
            id: "checks",
            tabId: "details",
            title: "Compliance Checks",
            icon: ShieldCheck,
            flagged: compliance.verdict === "non-compliant",
            children: (
              <CoiComplianceChecks
                key={record.id}
                compliance={compliance}
                onApprove={approveCheck}
                onRevoke={revokeCheck}
                canOverride={options.canOverride}
              />
            ),
          },
          {
            id: "coverage",
            tabId: "coverage",
            title: "Coverage Lines",
            icon: Layers3,
            flagged: compliance.coverageFailures.length > 0,
            children: <CoiCoverageLines coverageLines={data.coverageLines} coverageFailures={compliance.coverageFailures} coverageExceptions={compliance.coverageExceptions} expandedCoverage={form.expandedCoverage} onToggle={toggleCoverage} />,
          },
          {
            id: "submission-status",
            tabId: "details",
            title: "Submission Status",
            icon: ClipboardList,
            children: (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Upload status: <span className="font-medium text-foreground">{failed ? "Upload failed" : uploaded ? "Uploaded to Spectrum" : queued ? "Queued for Spectrum" : "Not uploaded"}</span></p>
                {record.spectrumUploadTransId && <p>Transaction: <span className="font-mono text-foreground">{record.spectrumUploadTransId}</span></p>}
                {record.spectrumUploadTrackingCode && <p>Tracking code: <span className="font-mono text-foreground">{record.spectrumUploadTrackingCode}</span></p>}
                <p>Comment: <span className="text-foreground">{form.comment.trim() || "No comment added"}</span></p>
              </div>
            ),
          },
        ],
        primaryAction: {
          id: "upload-coi",
          label: uploaded ? "Uploaded to Spectrum" : queued ? "Queued to Spectrum" : failed ? "Retry Upload" : "Upload to Spectrum",
          icon: CheckCircle2,
          disabled: uploaded || queued || uploadPending || !compliance.uploadReady || compliance.blockers.length > 0 || !options.onUploadToSpectrum,
          pending: uploadPending,
          onClick: uploadCoi,
        },
        secondaryActions,
      };
    },
  };
}
