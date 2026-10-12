"use client";

import { getFilenameOverride } from "./documentFilenameField";

import { CheckCircle2, FolderOpen, Link2, PauseCircle } from "lucide-react";

import {
  getLienWaiverDocumentSections,
} from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentSections";
import { showFileToProjectResultToast } from "@/modules/accounting/modules/invoices/components/documents/documentFilingResult";
import {
  buildLienWaiverSavePayload,
  getLienWaiverAmountError,
  getLienWaiverAlerts,
  getLienWaiverDocumentData,
  getLienWaiverInitialSnapshot,
  getLienWaiverPanelHeader,
} from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentModel";
import {
  getLienWaiverInitialForm,
  getLienWaiverWorkflowSummary,
  type LienWaiverDocumentFormState as BaseLienWaiverDocumentFormState,
} from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentState";

import type {
  DocumentAction,
  DocumentFilingMeta,
  DocumentFilingResult,
  DocumentSpecDefinition,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { DocumentDestinationsConfig, InvoiceUpdatePayload, InvoiceUpdateResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { toSharePointDestination } from "@/modules/accounting/modules/invoices/lib/destinationTree";
import { toast } from "@/modules/shared/components/ui/toaster";

export interface LienWaiverDocumentSpecOptions {
  secondaryActions?: readonly DocumentAction[];
  splitDocumentAction?: DocumentAction;
  onFileDocument?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onFileToProject?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onUpdateDocument?: (record: Invoice, payload: InvoiceUpdatePayload) => InvoiceUpdateResponse | Invoice | void | Promise<InvoiceUpdateResponse | Invoice | void>;
  fileToProjectPending?: boolean;
  destinations?: DocumentDestinationsConfig;
  onLinkComplete?: (record: Invoice) => void;
}

interface LienWaiverDocumentFormState extends BaseLienWaiverDocumentFormState {
  pairingCandidatesEmpty?: boolean;
}

export function createLienWaiverDocumentSpec(
  options: LienWaiverDocumentSpecOptions = {},
): DocumentSpecDefinition<Invoice, LienWaiverDocumentFormState> {
  const saveSequences = new Map<string, number>();
  return {
    id: "lien-waiver-document",
    label: "Lien Waiver",
    classifications: ["lien-waiver"],
    initForm: (record) => getLienWaiverInitialForm(record, options.destinations?.defaults["lien-waiver"] ?? ""),
    flushPendingChanges: async ({ record, form, patchForm }) => {
      if (!options.onUpdateDocument) return;
      const current = { vendorCode: form.vendorCode, jobNumber: form.jobNumber, amountInput: form.amountInput, throughDate: form.throughDate, waiverType: form.waiverType };
      const saved = { vendorCode: form.savedVendorCode, jobNumber: form.savedJobNumber, amountInput: form.savedAmountInput, throughDate: form.savedThroughDate, waiverType: form.savedWaiverType };
      const amountError = getLienWaiverAmountError(current, saved);
      const payload = buildLienWaiverSavePayload(current, saved);
      if (amountError) patchForm({ saveError: amountError });
      if (!payload) return;
      const requestSequence = (saveSequences.get(record.id) ?? 0) + 1;
      saveSequences.set(record.id, requestSequence);
      try {
        const response = await options.onUpdateDocument(record, payload);
        if (requestSequence !== saveSequences.get(record.id)) return;
        const canonical = response && "invoice" in response ? response.invoice : response;
        const canonicalSnapshot = canonical ? getLienWaiverInitialSnapshot(canonical) : current;
        patchForm({
          ...(payload.vendorCode !== undefined ? { savedVendorCode: canonicalSnapshot.vendorCode } : {}),
          ...(payload.jobNumber !== undefined ? { savedJobNumber: canonicalSnapshot.jobNumber } : {}),
          ...(payload.amount !== undefined ? { savedAmountInput: canonicalSnapshot.amountInput } : {}),
          ...(payload.invoiceDate !== undefined ? { savedThroughDate: canonicalSnapshot.throughDate } : {}),
          ...(payload.waiverType !== undefined ? { savedWaiverType: canonicalSnapshot.waiverType } : {}),
          saveError: amountError,
        });
      } catch (error) {
        if (requestSequence !== saveSequences.get(record.id)) return;
        const description = error instanceof Error ? error.message : "Lien waiver changes could not be saved.";
        patchForm({ saveError: description });
        toast.error("Lien waiver update failed", {
          description,
        });
      }
    },
    build: ({ record, form, patchForm }) => {
      const data = getLienWaiverDocumentData(record);
      const workflow = getLienWaiverWorkflowSummary(form);
      const workflowState = workflow.workflowState;
      const shelved = form.held && !form.released;

      async function holdWaiver() {
        const holdReason = form.holdReason.trim();
        patchForm({ holding: true });
        try {
          await options.onFileDocument?.(record, {
            holdReason: holdReason || undefined,
          });
          toast.success("Shelve", {
            description: holdReason
              ? `${data.fileName} shelved with a note.`
              : `${data.fileName} shelved for later pairing.`,
          });
          patchForm({ held: true, holding: false });
        } catch (error) {
          patchForm({ holding: false });
          toast.error("Shelve", {
            description: error instanceof Error ? error.message : "Shelving failed.",
          });
        }
      }

      async function fileWaiverToProject() {
        patchForm({ filing: true });
        try {
          const result = await options.onFileToProject?.(record, {
            destination: toSharePointDestination(form.destination, options.destinations?.rootLabel),
            ...(form.destinationAbsolute !== undefined ? { destinationAbsolute: form.destinationAbsolute } : {}),
            uploadToSharePoint: true,
            ...getFilenameOverride(form.filename, record),
          });
          const uploadedToProject = showFileToProjectResultToast(result, `${data.fileName} released to ${form.destination}.`);
          patchForm({ released: uploadedToProject, held: !uploadedToProject, filing: false });
        } catch (error) {
          patchForm({ filing: false });
          toast.error("File to Project", {
            description: error instanceof Error ? error.message : "Release failed.",
          });
        }
      }

      const alerts = [
        ...(form.saveError ? [{ id: "waiver-save-error", sectionId: "details", tone: "bad" as const, label: "Waiver details not saved", detail: form.saveError }] : []),
        ...getLienWaiverAlerts(
        workflowState,
        record.waiverAutoLinkSkipReason,
        options.splitDocumentAction,
      )].map((alert) => alert.id === "unpaired" ? {
        ...alert,
        detail: form.pairingCandidatesEmpty
          ? `No unlinked invoices are available. ${alert.detail}`
          : alert.detail,
        action: {
          id: "hold-waiver-on-shelf",
          label: shelved ? "Held on shelf" : "Hold on shelf",
          icon: PauseCircle,
          disabled: shelved || form.holding || !options.onFileDocument,
          pending: form.holding,
          onClick: holdWaiver,
        },
      } : alert);

      const primaryAction = workflow.paired ? {
        id: "file-waiver-to-project",
        label: form.released
          ? "Paired & Filed"
          : form.destinationAbsolute !== undefined
            ? "File to SharePoint"
            : "Pair & File",
        icon: form.released ? CheckCircle2 : Link2,
        disabled: form.released || form.filing || Boolean(options.fileToProjectPending) || !options.onFileToProject || !options.destinations,
        pending: form.filing || Boolean(options.fileToProjectPending),
        onClick: fileWaiverToProject,
      } : {
        id: "file-waiver-to-documents",
        label: shelved ? "Held in Documents" : "File to Documents",
        icon: shelved ? CheckCircle2 : FolderOpen,
        disabled: shelved || form.holding || !options.onFileDocument,
        pending: form.holding,
        onClick: holdWaiver,
      };

      return {
        preferredRenderer: "scroll",
        header: getLienWaiverPanelHeader(data, workflowState),
        alerts,
        checklist: [],
        sections: getLienWaiverDocumentSections({
          candidatesEmpty: form.pairingCandidatesEmpty,
          onCandidatesEmptyChange: alerts.some((alert) => alert.id === "unpaired")
            ? (pairingCandidatesEmpty) => patchForm({ pairingCandidatesEmpty })
            : undefined,
          record,
          data,
          form,
          dirty: workflow.dirty,
          editable: Boolean(options.onUpdateDocument),
          paired: workflow.paired,
          fileToProjectPending: options.fileToProjectPending,
          patchForm,
          onLinkComplete: () => options.onLinkComplete?.(record),
        }),
        primaryAction,
        secondaryActions: [...(options.secondaryActions ?? [])],
      };
    },
  };
}
