"use client";

import { CheckCircle2, ChevronDown, ChevronRight, Mail, UploadCloud, UserRound } from "lucide-react";

import { getInitialW9DocumentData, W9_TAX_CLASSES, W9_US_STATES, W9_VENDOR_TYPES } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentData";
import { deriveW9VendorCodePreview, digitsOnly, failW9Progress, startW9Progress, validateW9Identity, W9_IDLE_PROGRESS, completeW9Progress, type W9ProgressState, type W9TaxIdType } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentModel";
import {
  W9CollapsedContactSummary,
  W9ContactFields,
  W9DocumentStatus,
  W9IdentityFields,
  W9ProgressPanel,
} from "@/modules/accounting/modules/invoices/components/documents/w9DocumentViews";
import type { DocumentAction, DocumentFormState, DocumentSpecDefinition } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { Button } from "@/modules/shared/components/ui/button";

export interface W9DocumentFormState extends DocumentFormState {
  vendorName: string; vendorType: string; taxClass: string; taxIdType: W9TaxIdType; taxId: string;
  contactOpen: boolean; contactName: string; contactEmail: string; phone: string; fax: string;
  addressLine1: string; addressLine2: string; city: string; state: string; zip: string;
  progress: W9ProgressState; submitted: boolean; submitting: boolean; retryCount: number;
}

export interface W9DocumentSpecOptions {
  secondaryActions?: readonly DocumentAction[];
  /** Must resolve from the server-owned create/upload workflow. */
  onCreateVendorAndUpload?: (record: Invoice, form: W9DocumentFormState) => Promise<{ status: "created" | "upload-failed" }>;
}

export function createW9DocumentSpec(
  options: W9DocumentSpecOptions = {},
): DocumentSpecDefinition<Invoice, W9DocumentFormState> {
  return {
    id: "w9-document",
    label: "W-9",
    classifications: ["w9"],
    initForm: (record) => {
      const data = getInitialW9DocumentData(record);
      return {
        vendorName: data.vendorName,
        vendorType: data.vendorType,
        taxClass: data.taxClass,
        taxIdType: data.taxIdType,
        taxId: data.taxId,
        contactOpen: true,
        contactName: "",
        contactEmail: data.contactEmail,
        phone: "",
        fax: "",
        addressLine1: data.addressLine1,
        addressLine2: "",
        city: data.city,
        state: data.state,
        zip: data.zip,
        progress: W9_IDLE_PROGRESS,
        submitted: false,
        submitting: false,
        retryCount: 0,
      };
    },
    build: ({ record, form, patchForm }) => {
      const data = getInitialW9DocumentData(record);
      const validation = validateW9Identity(form);
      const busy = form.submitting || form.progress.phase === "submitting";
      const error = form.progress.phase === "error";
      const vendorCode = deriveW9VendorCodePreview(form.vendorName);

      async function submitW9() {
        if (!validation.valid || busy || form.submitted || !options.onCreateVendorAndUpload) return;
        patchForm({ submitting: true, progress: startW9Progress() });
        try {
          const result = await options.onCreateVendorAndUpload(record, form);
          if (result.status === "created") {
            patchForm({ progress: completeW9Progress(), submitted: true, submitting: false });
            return;
          }
          patchForm({ progress: failW9Progress("upload"), submitting: false, retryCount: form.retryCount + 1 });
        } catch {
          patchForm({ progress: failW9Progress("upload"), submitting: false, retryCount: form.retryCount + 1 });
        }
      }

      return {
        preferredRenderer: "scroll",
        header: {
          kindLabel: "W-9",
          title: form.vendorName || data.fileName,
          subtitle: data.fileName,
          statusLabel: form.submitted ? "Vendor created" : error ? "Upload failed" : "New vendor",
          statusTone: form.submitted ? "ok" : error ? "bad" : "warn",
          readyLabel: form.submitted ? "Created" : "Ready",
        },
        alerts: [
          ...(!validation.nameOk ? [{ id: "w9-vendor-name", sectionId: "identity", fieldId: "vendor-name", tone: "warn" as const, label: "Vendor name required", detail: "Sets the vendor identity and generated Spectrum code." }] : []),
          ...(!validation.typeOk ? [{ id: "w9-vendor-type", sectionId: "identity", fieldId: "vendor-type", tone: "warn" as const, label: "Vendor type required", detail: "Sets the insurance and 1099 requirements for this vendor." }] : []),
          ...(!validation.taxClassOk ? [{ id: "w9-tax-class", sectionId: "identity", fieldId: "tax-class", tone: "warn" as const, label: "Tax classification required", detail: "Select the vendor's tax classification." }] : []),
          ...(!validation.taxIdOk ? [{ id: "w9-tax-id", sectionId: "identity", fieldId: "tax-id", tone: "warn" as const, label: "Tax ID required", detail: "Enter a complete 9-digit tax ID." }] : []),
        ],
        sections: [
          ...(busy || form.submitted || error ? [{ id: "progress", title: form.submitted ? "Submission Complete" : "Spectrum Progress", icon: UploadCloud, flagged: error, children: (
              <W9ProgressPanel progress={form.progress} failureContent={error ? <div className="mt-2 space-y-2 text-sm">
                <p className="font-semibold text-destructive">W-9 upload failed</p>
                <p>{`${form.vendorName} (${vendorCode}) was created, but the document upload failed. Retry the upload.`}</p>
                <Button type="button" size="sm" disabled={busy || !validation.valid || !options.onCreateVendorAndUpload} onClick={submitW9}>Retry upload</Button>
              </div> : undefined} />
          ) }] : []),
          {
            id: "identity",
            title: "Vendor Identity",
            icon: UserRound,
            flagged: !validation.valid,
            children: (
              <W9IdentityFields
                vendorName={form.vendorName}
                vendorCode={vendorCode}
                vendorType={form.vendorType}
                taxClass={form.taxClass}
                taxIdType={form.taxIdType}
                taxId={form.taxId}
                validation={validation}
                vendorTypes={W9_VENDOR_TYPES}
                taxClasses={W9_TAX_CLASSES}
                onChange={(patch) => patchForm({ ...patch, taxId: patch.taxId === undefined ? form.taxId : digitsOnly(patch.taxId, 9) })}
              />
            ),
          },
          {
            id: "contact",
            title: "Vendor Contact",
            icon: Mail,
            action: (
              <Button type="button" variant="ghost" size="sm" onClick={() => patchForm({ contactOpen: !form.contactOpen })} aria-expanded={form.contactOpen}>
                {form.contactOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                {form.contactOpen ? "Hide" : "Show"}
              </Button>
            ),
            children: form.contactOpen
              ? <W9ContactFields {...form} states={W9_US_STATES} onChange={(patch) => patchForm({ ...patch, phone: patch.phone === undefined ? form.phone : digitsOnly(patch.phone, 10), fax: patch.fax === undefined ? form.fax : digitsOnly(patch.fax, 10), zip: patch.zip === undefined ? form.zip : digitsOnly(patch.zip, 9) })} />
              : <W9CollapsedContactSummary email={form.contactEmail} phone={form.phone} />,
          },
          { id: "document", title: "W-9 Document", icon: UploadCloud, children: <W9DocumentStatus fileName={data.fileName} /> },
        ],
        primaryAction: {
          id: "create-vendor-upload",
          label: form.submitted ? "Vendor Created" : error ? "Retry Upload" : "Create Vendor & Upload",
          icon: form.submitted ? CheckCircle2 : UploadCloud,
          disabled: form.submitted || busy || !validation.valid || !options.onCreateVendorAndUpload,
          disabledReason: !options.onCreateVendorAndUpload ? "Vendor creation is not available from this panel yet." : undefined,
          pending: busy,
          onClick: submitW9,
        },
        secondaryActions: [...(options.secondaryActions ?? [])],
      };
    },
  };
}
