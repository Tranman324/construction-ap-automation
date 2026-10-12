"use client";

import { useState } from "react";

import { cn } from "@/modules/shared/lib/utils";
import { useSubcontracts } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { Subcontract } from "@/modules/accounting/modules/invoices/types/api";

import {
  Check,
  CommandItem,
  ComboboxShell,
  ManualBadge,
} from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/ComboboxShell";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SubcontractDropdownProps {
  id?: string;
  value: string | null;
  vendorCode?: string;
  jobNumber?: string;
  isManual?: boolean;
  onChange: (subcontractNumber: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean | "true" | "false";
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SubcontractDropdown({
  id,
  value,
  vendorCode,
  jobNumber,
  isManual,
  onChange,
  placeholder = "Select subcontract…",
  disabled,
  "aria-invalid": ariaInvalid,
  className,
}: SubcontractDropdownProps) {
  const hasFilter = !!(vendorCode || jobNumber);
  const { data: subcontracts, isLoading } = useSubcontracts(vendorCode, jobNumber);
  const [open, setOpen] = useState(false);

  // Sort descending by subcontract number (newest first)
  const subs = [...(subcontracts ?? [])].sort((a, b) =>
    b.subcontractNumber.localeCompare(a.subcontractNumber, undefined, { numeric: true })
  );

  // Build display label from sorted list; fall back to bare number
  const selectedSub = subs.find((s: Subcontract) => s.subcontractNumber === value);
  const displayLabel = selectedSub
    ? `${selectedSub.subcontractNumber} — ${formatCurrency(selectedSub.revContract - selectedSub.totalBilled)} unbilled`
    : value;
  const displayedValue = disabled && !jobNumber ? null : value;

  return (
    <div className="flex flex-col gap-1 w-full">
      <ComboboxShell
        id={id}
        value={displayedValue}
        displayLabel={displayedValue ? displayLabel : null}
        onSelect={(number) => onChange(number)}
        onClear={() => { onChange(null); setOpen(false); }}
        placeholder={placeholder}
        isLoading={isLoading}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        className={className}
      >
        {!hasFilter && !value ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            Select a vendor or job first
          </div>
        ) : !isLoading && subs.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No subcontracts available for this job
          </div>
        ) : (
          subs.map((sub: Subcontract) => {
            const remaining = sub.revContract - sub.totalBilled;
            return (
              <CommandItem
                key={sub.subcontractNumber}
                value={sub.subcontractNumber}
                onSelect={() => { onChange(sub.subcontractNumber); setOpen(false); }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4 shrink-0",
                    value === sub.subcontractNumber ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="truncate">
                  {sub.subcontractNumber} — {formatCurrency(remaining)} unbilled
                </span>
              </CommandItem>
            );
          })
        )}
      </ComboboxShell>

      <ManualBadge isManual={isManual} />
    </div>
  );
}
