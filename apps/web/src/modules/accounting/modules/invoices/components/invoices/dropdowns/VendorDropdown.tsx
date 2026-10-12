"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/modules/shared/lib/utils";
import { useVendorSearch } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { Vendor } from "@/modules/accounting/modules/invoices/types/api";

import {
  Check,
  CommandItem,
  ComboboxShell,
  ManualBadge,
} from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/ComboboxShell";

// ─── Props ────────────────────────────────────────────────────────────────────

interface VendorDropdownProps {
  id?: string;
  value: string | null;
  /** Vendor display name from invoice matching data — shown when the vendor
   * isn't in the current search results (API failure, small result set, etc.) */
  vendorName?: string | null;
  isManual?: boolean;
  onChange: (vendorCode: string | null) => void;
  clearOptionLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean | "true" | "false";
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VendorDropdown({
  id,
  value,
  vendorName,
  isManual,
  onChange,
  clearOptionLabel,
  placeholder = "Select vendor…",
  disabled,
  "aria-invalid": ariaInvalid,
  className,
}: VendorDropdownProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: vendors, isLoading } = useVendorSearch(searchTerm);
  const { data: vendorsByCode } = useVendorSearch(value ?? "");
  const [open, setOpen] = useState(false);

  // Prefer finding the vendor in search results for a canonical label.
  // Fall back to the vendorName passed from invoice matching data so the
  // trigger always shows a human-readable name, even when the vendor API
  // fails or the vendor wasn't in the first N results.
  const selectedVendor = (vendors ?? []).find((v: Vendor) => v.code === value)
    ?? (vendorsByCode ?? []).find((v: Vendor) => v.code === value);
  const displayLabel = selectedVendor
    ? `${selectedVendor.code} — ${selectedVendor.name}`
    : value && vendorName
      ? `${value} — ${vendorName}`
      : value ?? vendorName;

  return (
    <div className="flex flex-col gap-1 w-full">
      <ComboboxShell
        id={id}
        value={value}
        displayLabel={displayLabel}
        onSelect={(code) => onChange(code)}
        onClear={() => { onChange(null); setOpen(false); }}
        placeholder={placeholder}
        searchPlaceholder="Search vendors…"
        onSearchChange={setSearchTerm}
        isLoading={isLoading}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        className={className}
      >
        {clearOptionLabel ? (
          <CommandItem
            value={clearOptionLabel}
            onSelect={() => { onChange(null); setOpen(false); }}
          >
            <X className="mr-2 h-4 w-4 shrink-0" />
            {clearOptionLabel}
          </CommandItem>
        ) : null}
        {(vendors ?? []).map((vendor: Vendor) => (
          <CommandItem
            key={vendor.code}
            value={`${vendor.code} ${vendor.name}`}
            onSelect={() => { onChange(vendor.code); setOpen(false); }}
          >
            <Check
              className={cn(
                "mr-2 h-4 w-4 shrink-0",
                value === vendor.code ? "opacity-100" : "opacity-0"
              )}
            />
            <span className="truncate">
              {vendor.code} — {vendor.name}
            </span>
          </CommandItem>
        ))}
      </ComboboxShell>

      <ManualBadge isManual={isManual} />
    </div>
  );
}
