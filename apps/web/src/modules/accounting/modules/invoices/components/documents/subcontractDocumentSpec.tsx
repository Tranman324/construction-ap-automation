"use client";

import { FilingFilenameField, getFilenameOverride } from "./documentFilenameField";

import { CheckCircle2, ClipboardCheck, FolderOpen, UploadCloud } from "lucide-react";

import { DestinationPicker } from "@/modules/accounting/modules/invoices/components/documents/DestinationPicker";
import { DocumentKeyValueRows } from "@/modules/accounting/modules/invoices/components/documents/DocumentAtoms";
import { showFileToProjectResultToast } from "@/modules/accounting/modules/invoices/components/documents/documentFilingResult";
import {
  formatDocumentMoney,
} from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import {
  getSubcontractFilingData,
} from "@/modules/accounting/modules/invoices/components/documents/simpleFilingDocumentModel";
import { toast } from "@/modules/shared/components/ui/toaster";
import type { DocumentDestinationsConfig } from "@/modules/accounting/modules/invoices/types/api";
import type {
  DocumentAction,
  DocumentFilingMeta,
  DocumentFilingResult,
  DocumentFormState,
  DocumentSpecDefinition,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { toSharePointDestination } from "@/modules/accounting/modules/invoices/lib/destinationTree";

export interface SubcontractDocumentFormState extends DocumentFormState {
  destination: string;
  filename: string;
  destinationAbsolute?: string;
  filed: boolean;
  filing: boolean;
}

export interface SubcontractDocumentSpecOptions {
  secondaryActions?: readonly DocumentAction[];
  onFileDocument?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onFileToProject?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  fileToProjectPending?: boolean;
  destinations?: DocumentDestinationsConfig;
}

export function createSubcontractDocumentSpec(
  options: SubcontractDocumentSpecOptions = {},
): DocumentSpecDefinition<Invoice, SubcontractDocumentFormState> {
  return {
    id: "subcontract-document",
    label: "Subcontract",
    classifications: ["subcontract"],
    initForm: (record) => ({
      filename: record.filing?.fileName?.value ?? "",
      destinationAbsolute: undefined,
      destination: options.destinations?.defaults.subcontract ?? "",
      filed: Boolean(record.spFileUrl),
      filing: false,
    }),
    build: ({ record, form, patchForm }) => {
      const data = getSubcontractFilingData(record);
      const projectFiled = Boolean(record.spFileUrl) || form.filed;
      const rows = [
        { label: "Subcontractor", value: data.subcontractor },
        { label: "Trade / scope", value: data.trade },
        { label: "Job", value: data.job.label, mono: true },
        { label: "Contract number", value: data.subcontractNumber, mono: true },
        { label: "Contract sum", value: formatDocumentMoney(data.contractSum), mono: true },
        ...(data.retainage ? [{ label: "Retainage", value: data.retainage, mono: true }] : []),
      ];

      async function fileSubcontractToProject() {
        patchForm({ filing: true });
        try {
          const result = await options.onFileToProject?.(record, {
            destination: toSharePointDestination(form.destination, options.destinations?.rootLabel),
            ...(form.destinationAbsolute !== undefined ? { destinationAbsolute: form.destinationAbsolute } : {}),
            ...getFilenameOverride(form.filename, record),
            uploadToSharePoint: true,
          });
          const uploaded = showFileToProjectResultToast(result, `${data.subcontractNumber} filed to ${form.destination}.`);
          patchForm({ filed: uploaded, filing: false });
        } catch (error) {
          patchForm({ filing: false });
          toast.error("File to Project", {
            description: error instanceof Error ? error.message : "Filing failed.",
          });
        }
      }

      return {
        preferredRenderer: "scroll",
        header: {
          kindLabel: "Subcontract",
          title: data.subcontractor,
          subtitle: data.subcontractNumber,
          statusLabel: projectFiled ? "Filed" : "Ready",
          statusTone: projectFiled ? "ok" : "warn",
          externalStatusLabel: record.spFileUrl ? "Filed to SP" : undefined,
          externalStatusTone: "ok",
          readyLabel: projectFiled ? "Filed" : "Ready",
        },
        checklist: [],
        sections: [
          {
            id: "summary",
            title: "Subcontract",
            icon: ClipboardCheck,
            children: <DocumentKeyValueRows rows={rows} />,
          },
          {
            id: "destination",
            title: "File To",
            icon: UploadCloud,
            children: (
              <div className="space-y-3">
              <DestinationPicker
                value={form.destination}
                onChange={(destination) => patchForm({ destination })}
                onChangePath={(destinationAbsolute) => patchForm({ destinationAbsolute })}
                jobId={data.job.id}
                jobName={data.job.name}
                disabled={form.filing || projectFiled}
                note={`Defaults to ${options.destinations?.defaults.subcontract ?? "this document type's folder"}. Browse to file it elsewhere.`}
              />
              <FilingFilenameField record={record} value={form.filename} onChange={(filename) => patchForm({ filename })}
                filing={form.filing || Boolean(options.fileToProjectPending)} filed={projectFiled} />
              </div>
            ),
          },
        ],
        primaryAction: {
          id: "file-subcontract-to-project",
          label: projectFiled ? "Filed to SharePoint" : "File to SharePoint",
          icon: projectFiled ? CheckCircle2 : FolderOpen,
          disabled: projectFiled || form.filing || Boolean(options.fileToProjectPending) || !options.onFileToProject || !options.destinations,
          pending: form.filing || Boolean(options.fileToProjectPending),
          onClick: fileSubcontractToProject,
        },
        secondaryActions: [...(options.secondaryActions ?? [])],
      };
    },
  };
}
