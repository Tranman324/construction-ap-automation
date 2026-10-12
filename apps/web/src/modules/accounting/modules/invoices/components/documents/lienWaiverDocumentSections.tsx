"use client";

import { FilingFilenameField } from "./documentFilenameField";

import { BadgeCheck, Link2, UploadCloud } from "lucide-react";

import { DestinationPicker } from "@/modules/accounting/modules/invoices/components/documents/DestinationPicker";
import { LienWaiverPairingPanel } from "@/modules/accounting/modules/invoices/components/documents/LienWaiverPairingPanel";
import {
  LienWaiverDetailsEditor,
} from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentViews";
import type { LienWaiverDocumentData } from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentModel";
import type { DocumentSection } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

export interface LienWaiverSectionFormState {
  vendorCode: string | null;
  jobNumber: string | null;
  amountInput: string;
  throughDate: string;
  waiverType: string;
  savedVendorCode: string | null;
  savedJobNumber: string | null;
  savedAmountInput: string;
  savedThroughDate: string;
  savedWaiverType: string;
  linkedInvoiceId: string | null;
  destination: string;
  filename: string;
  destinationAbsolute?: string;
  holdReason: string;
  released: boolean;
  filing: boolean;
  holding: boolean;
}

export interface LienWaiverSectionPatch extends Record<string, unknown> {
  vendorCode?: string | null;
  jobNumber?: string | null;
  amountInput?: string;
  throughDate?: string;
  waiverType?: string;
  linkedInvoiceId?: string | null;
  destination?: string;
  filename?: string;
  destinationAbsolute?: string;
  holdReason?: string;
}

export interface LienWaiverDocumentSectionsOptions {
  record: Invoice;
  data: LienWaiverDocumentData;
  form: LienWaiverSectionFormState;
  dirty: boolean;
  editable?: boolean;
  paired: boolean;
  patchForm: (patch: LienWaiverSectionPatch) => void;
  onLinkComplete?: () => void;
  fileToProjectPending?: boolean;
  candidatesEmpty?: boolean;
  onCandidatesEmptyChange?: (empty: boolean) => void;
}

export function getLienWaiverDocumentSections({
  record,
  data,
  form,
  dirty,
  editable = true,
  paired,
  patchForm,
  onLinkComplete,
  fileToProjectPending,
  candidatesEmpty,
  onCandidatesEmptyChange,
}: LienWaiverDocumentSectionsOptions): DocumentSection[] {
  return [
    {
      id: "details",
      title: "Waiver Details",
      icon: BadgeCheck,
      flagged: dirty,
      children: (
        <LienWaiverDetailsEditor
          data={data}
          vendorCode={form.vendorCode}
          jobNumber={form.jobNumber}
          amountInput={form.amountInput}
          throughDate={form.throughDate}
          waiverType={form.waiverType}
          savedSnapshot={{
            vendorCode: form.savedVendorCode,
            jobNumber: form.savedJobNumber,
            amountInput: form.savedAmountInput,
            throughDate: form.savedThroughDate,
            waiverType: form.savedWaiverType,
          }}
          disabled={!editable || form.released || form.filing}
          onVendorCodeChange={(vendorCode) => patchForm({ vendorCode })}
          onJobNumberChange={(jobNumber) => patchForm({ jobNumber })}
          onAmountInputChange={(amountInput) => patchForm({ amountInput })}
          onThroughDateChange={(throughDate) => patchForm({ throughDate })}
          onWaiverTypeChange={(waiverType) => patchForm({ waiverType })}
        />
      ),
    },
    {
      id: "pairing",
      title: "Pair to Invoice",
      icon: Link2,
      flagged: !paired,
      flagIndicator: "dot",
      children: (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Suggested invoices this waiver releases — matched on claimant, job, and amount. If the invoice is not in the system yet, file it to the Documents shelf and pair it later.
          </p>
          <LienWaiverPairingPanel
            candidatesEmpty={candidatesEmpty}
            onCandidatesEmptyChange={onCandidatesEmptyChange}
            key={record.id}
            record={record}
            linkedInvoiceId={form.linkedInvoiceId}
            onLinkedInvoiceChange={(linkedInvoiceId) => patchForm({ linkedInvoiceId })}
            onLinkComplete={onLinkComplete}
          />
        </div>
      ),
    },
    {
      id: "destination",
      title: "File To",
      icon: UploadCloud,
      children: (
        <div className="space-y-3"><DestinationPicker
          value={form.destination}
          onChange={(destination) => patchForm({ destination })}
          onChangePath={(destinationAbsolute) => patchForm({ destinationAbsolute })}
          jobId={form.jobNumber ?? data.jobNumber}
          jobName={data.jobName}
          disabled={form.released || form.filing}
          note="Defaults to the Lien Waivers folder — browse to file it elsewhere."
        /><FilingFilenameField record={record} value={form.filename} onChange={(filename) => patchForm({ filename })}
          filing={form.filing || Boolean(fileToProjectPending)} filed={form.released} /></div>
      ),
    },
  ];
}
