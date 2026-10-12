"use client";

import { ShieldCheck } from "lucide-react";

import { JobDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown";
import { VendorDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown";
import {
  getLienWaiverAmountError,
  type LienWaiverDocumentData,
  type LienWaiverEditableSnapshot,
} from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentModel";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Input } from "@/modules/shared/components/ui/input";

export interface LienWaiverDetailsEditorProps {
  data: LienWaiverDocumentData;
  vendorCode: string | null;
  jobNumber: string | null;
  amountInput: string;
  throughDate: string;
  waiverType: string;
  savedSnapshot: LienWaiverEditableSnapshot;
  disabled?: boolean;
  onVendorCodeChange: (value: string | null) => void;
  onJobNumberChange: (value: string | null) => void;
  onAmountInputChange: (value: string) => void;
  onThroughDateChange: (value: string) => void;
  onWaiverTypeChange: (value: string) => void;
}

const selectClassName =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

export function LienWaiverDetailsEditor({
  data,
  vendorCode,
  jobNumber,
  amountInput,
  throughDate,
  waiverType,
  savedSnapshot,
  disabled,
  onVendorCodeChange,
  onJobNumberChange,
  onAmountInputChange,
  onThroughDateChange,
  onWaiverTypeChange,
}: LienWaiverDetailsEditorProps) {
  const currentSnapshot = { vendorCode, jobNumber, amountInput, throughDate, waiverType };
  const claimantEdited = vendorCode !== savedSnapshot.vendorCode;
  const jobEdited = jobNumber !== savedSnapshot.jobNumber;
  const waiverTypeEdited = waiverType !== savedSnapshot.waiverType;
  const amountInvalid = Boolean(getLienWaiverAmountError(currentSnapshot, savedSnapshot));
  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-[7px] text-[13px] font-semibold leading-none text-foreground">
        <span>Claimant</span>
        <VendorDropdown value={vendorCode} vendorName={data.vendorName ?? data.claimant} isManual={claimantEdited} onChange={onVendorCodeChange} disabled={disabled} />
      </label>
      <label className="flex flex-col gap-[7px] text-[13px] font-semibold leading-none text-foreground">
        <span>Job</span>
        <JobDropdown value={jobNumber} jobDescription={data.jobName} isManual={jobEdited} onChange={onJobNumberChange} disabled={disabled} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-[7px] text-[13px] font-semibold leading-none text-foreground">
          <span>Through date</span>
          <Input type="date" aria-label="Through date" value={throughDate.slice(0, 10)} onChange={(event) => onThroughDateChange(event.target.value)} disabled={disabled} className="font-mono tabular-nums" />
        </label>
        <label className="flex flex-col gap-[7px] text-[13px] font-semibold leading-none text-foreground">
          <span>Amount</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input inputMode="decimal" aria-label="Amount" value={amountInput} onChange={(event) => onAmountInputChange(event.target.value)} disabled={disabled} aria-invalid={amountInvalid} className="pl-7 font-mono tabular-nums" />
          </div>
          {amountInvalid ? <span role="alert" className="block text-xs font-normal leading-snug text-destructive">Enter a valid numeric amount before leaving this waiver.</span> : null}
        </label>
      </div>
      <label className="flex flex-col gap-[7px] text-[13px] font-semibold leading-none text-foreground">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          Waiver type
          {waiverTypeEdited ? (
            <Badge variant="outline" className="ml-1 h-5 border-violet-300 bg-violet-50 px-1.5 text-3xs text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
              Edited
            </Badge>
          ) : null}
        </span>
        <select
          className={selectClassName}
          aria-label="Waiver type"
          value={waiverType}
          onChange={(event) => onWaiverTypeChange(event.target.value)}
          disabled={disabled}
        >
          <option value="">Select waiver type</option>
          <option value="Conditional progress waiver">Conditional · Progress payment</option>
          <option value="Unconditional progress waiver">Unconditional · Progress payment</option>
          <option value="Conditional final waiver">Conditional · Final payment</option>
          <option value="Unconditional final waiver">Unconditional · Final payment</option>
        </select>
      </label>

    </div>
  );
}
