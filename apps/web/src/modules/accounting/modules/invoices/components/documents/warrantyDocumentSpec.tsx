"use client";

import { FilingFilenameField, getFilenameOverride } from "./documentFilenameField";

import { BadgeCheck, CheckCircle2, FolderOpen, UploadCloud } from "lucide-react";

import { DestinationPicker } from "@/modules/accounting/modules/invoices/components/documents/DestinationPicker";
import { DocumentKeyValueRows } from "@/modules/accounting/modules/invoices/components/documents/DocumentAtoms";
import { WarrantyClassificationEditor } from "@/modules/accounting/modules/invoices/components/documents/warrantyClassificationEditor";
import { showFileToProjectResultToast } from "@/modules/accounting/modules/invoices/components/documents/documentFilingResult";
import {
  getWarrantyFilingData,
} from "@/modules/accounting/modules/invoices/components/documents/simpleFilingDocumentModel";
import { toast } from "@/modules/shared/components/ui/toaster";
import type { DocumentDestinationsConfig } from "@/modules/accounting/modules/invoices/types/api";
import type {
  UpdateWarrantyClassificationPayload,
  UpdateWarrantyClassificationResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import type {
  DocumentAction,
  DocumentFilingMeta,
  DocumentFilingResult,
  DocumentFormState,
  DocumentSpecDefinition,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { toSharePointDestination } from "@/modules/accounting/modules/invoices/lib/destinationTree";

export interface WarrantyDocumentFormState extends DocumentFormState {
  destination: string;
  filename: string;
  destinationAbsolute?: string;
  filed: boolean;
  filing: boolean;
}

export interface WarrantyDocumentSpecOptions {
  secondaryActions?: readonly DocumentAction[];
  onFileDocument?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onFileToProject?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  fileToProjectPending?: boolean;
  destinations?: DocumentDestinationsConfig;
  canEditClassification?: boolean;
  classificationPending?: boolean;
  classificationError?: string | null;
  onUpdateClassification?: (record: Invoice, payload: UpdateWarrantyClassificationPayload) => UpdateWarrantyClassificationResponse | Promise<UpdateWarrantyClassificationResponse>;
}

export function createWarrantyDocumentSpec(
  options: WarrantyDocumentSpecOptions = {},
): DocumentSpecDefinition<Invoice, WarrantyDocumentFormState> {
  return {
    id: "warranty-document",
    label: "Warranty",
    classifications: ["warranty"],
    initForm: (record) => ({
      filename: record.filing?.fileName?.value ?? "",
      destinationAbsolute: undefined,
      destination: options.destinations?.defaults.warranty ?? "",
      filed: Boolean(record.spFileUrl),
      filing: false,
    }),
    build: ({ record, form, patchForm }) => {
      const data = getWarrantyFilingData(record);
      const projectFiled = Boolean(record.spFileUrl) || form.filed;

      async function fileWarrantyToProject() {
        patchForm({ filing: true });
        try {
          const result = await options.onFileToProject?.(record, {
            destination: toSharePointDestination(form.destination, options.destinations?.rootLabel),
            ...(form.destinationAbsolute !== undefined ? { destinationAbsolute: form.destinationAbsolute } : {}),
            ...getFilenameOverride(form.filename, record),
            uploadToSharePoint: true,
          });
          const uploaded = showFileToProjectResultToast(result, `${data.provider} warranty filed to ${form.destination}.`);
          patchForm({ filed: uploaded, filing: false });
        } catch (error) {
          patchForm({ filing: false });
          toast.error("File to SharePoint", {
            description: error instanceof Error ? error.message : "Filing failed.",
          });
        }
      }

      const alerts = [
        ...(!data.providerKind ? [{ id: "provider-kind-required", sectionId: "coverage", tone: "warn" as const, label: "Provider kind required", detail: "Add the warranty provider kind before filing." }] : []),
        ...(!data.warrantyType ? [{ id: "warranty-type-required", sectionId: "coverage", tone: "warn" as const, label: "Warranty type required", detail: "Add the warranty type before filing." }] : []),
        ...(options.classificationError ? [{ id: "warranty-classification-error", sectionId: "coverage", tone: "bad" as const, label: "Warranty classification could not be saved", detail: options.classificationError }] : []),
      ];

      return {
        preferredRenderer: "scroll",
        header: {
          kindLabel: "Warranty",
          title: data.provider,
          subtitle: data.fileName,
          statusLabel: projectFiled ? "Filed to Project" : "Ready",
          statusTone: projectFiled ? "ok" : "warn",
          externalStatusLabel: record.spFileUrl ? "Filed to SP" : undefined,
          externalStatusTone: "ok",
          readyLabel: projectFiled ? "Filed" : "Ready",
        },
        alerts,
        sections: [
          {
            id: "coverage",
            title: "Coverage",
            icon: BadgeCheck,
            children: (
              <div className="space-y-3">
                <DocumentKeyValueRows
                  rows={[
                    { label: "Provider", value: data.provider },
                    { label: "Job", value: data.job.label, mono: true },
                  ]}
                />
                <WarrantyClassificationEditor
                  providerKind={record.filing?.providerKind}
                  warrantyType={record.filing?.warrantyType}
                  canEdit={Boolean(options.canEditClassification && options.onUpdateClassification)}
                  pending={Boolean(options.classificationPending)}
                  error={null}
                  onSave={async (payload) => {
                    if (!options.onUpdateClassification) return;
                    try {
                      await options.onUpdateClassification(record, payload);
                    } catch {
                      // The mutation error is retained by the route hook and rendered verbatim above.
                    }
                  }}
                />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {data.scope}
                </p>
              </div>
            ),
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
                note="Defaults to the Closeout folder — browse to file it elsewhere."
              />
              <FilingFilenameField record={record} value={form.filename} onChange={(filename) => patchForm({ filename })}
                filing={form.filing || Boolean(options.fileToProjectPending)} filed={projectFiled} />
              </div>
            ),
          },
        ],
        primaryAction: {
          id: "file-warranty-to-project",
          label: projectFiled ? "Filed to SharePoint" : "File to SharePoint",
          icon: projectFiled ? CheckCircle2 : FolderOpen,
          disabled: projectFiled || form.filing || Boolean(options.fileToProjectPending) || !options.onFileToProject || !options.destinations,
          pending: form.filing || Boolean(options.fileToProjectPending),
          onClick: fileWarrantyToProject,
        },
        secondaryActions: [...(options.secondaryActions ?? [])],
      };
    },
  };
}
