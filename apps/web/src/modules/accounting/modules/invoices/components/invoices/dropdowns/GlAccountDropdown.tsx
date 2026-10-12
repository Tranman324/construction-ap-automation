"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/modules/shared/lib/utils";
import { useGlAccounts, useGlAccountByCode } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { GlAccountOption } from "@/modules/accounting/modules/invoices/types/api";

import {
  Check,
  CommandItem,
  ComboboxShell,
} from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/ComboboxShell";

function glAccountLabel(account: GlAccountOption): string {
  const code = account.code.trim();
  const description = account.description?.trim() ?? "";
  return description ? `${code} - ${description}` : code;
}

interface GlAccountDropdownProps {
  id?: string;
  /** Selected GL account code (not label). */
  value: string | null;
  onChange: (code: string) => void;
  onClear?: () => void;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Optional in-list "clear" entry (e.g. the rule-builder's leave-unchanged). */
  clearOptionLabel?: string;
  /** Overrides the trigger label (e.g. the rule-builder's "Clear value" state). */
  displayLabelOverride?: string | null;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

/**
 * Server-search GL account typeahead. The catalog is 2000+ live-Spectrum rows,
 * so it is never loaded whole — a debounced `?search=` (matches account number
 * OR description) fetches a bounded page (mirrors JobDropdown/VendorDropdown).
 *
 * Load-bearing: the currently-SELECTED account keeps its full label in the
 * trigger even when it is not on the active search page — resolved via
 * `useGlAccountByCode`, so a pre-filled 5450 never collapses to a bare code.
 */
export function GlAccountDropdown({
  id,
  value,
  onChange,
  onClear,
  placeholder = "Select GL account…",
  searchPlaceholder = "Search GL accounts…",
  clearOptionLabel,
  displayLabelOverride,
  open: controlledOpen,
  onOpenChange,
  disabled,
  className,
  "aria-invalid": ariaInvalid,
}: GlAccountDropdownProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const { data: accounts = [], isLoading, isError } = useGlAccounts(searchTerm);

  // Prefer the selected account from the active results; fall back to a
  // by-code lookup so the trigger always shows "code - description".
  const selectedInResults = accounts.find((account) => account.code === value);
  const { data: resolvedSelected } = useGlAccountByCode(
    !selectedInResults && value ? value : undefined,
  );
  const selected = selectedInResults ?? resolvedSelected ?? null;
  const displayLabel = displayLabelOverride !== undefined
    ? displayLabelOverride
    : value ? (selected ? glAccountLabel(selected) : value) : null;

  function selectCode(code: string) {
    onChange(code);
    setOpen(false);
  }

  return (
    <div className="w-full">
      <ComboboxShell
        className={className}
        id={id}
        value={value}
        displayLabel={displayLabel}
        onSelect={selectCode}
        onClear={onClear ? () => { onClear(); setOpen(false); } : undefined}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        onSearchChange={setSearchTerm}
        isLoading={isLoading}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
        aria-invalid={ariaInvalid}
      >
        {clearOptionLabel ? (
          <CommandItem value={clearOptionLabel} onSelect={() => { onClear?.(); setOpen(false); }}>
            <X className="mr-2 h-4 w-4 shrink-0" />
            {clearOptionLabel}
          </CommandItem>
        ) : null}
        {accounts.map((account) => (
          <CommandItem
            key={account.code}
            value={`${account.code} ${account.description ?? ""}`}
            onSelect={() => selectCode(account.code)}
          >
            <Check className={cn("mr-2 h-4 w-4 shrink-0", value === account.code ? "opacity-100" : "opacity-0")} />
            <span className="truncate">{glAccountLabel(account)}</span>
          </CommandItem>
        ))}
      </ComboboxShell>
      {isError && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          GL accounts unavailable — reference data could not be loaded.
        </p>
      )}
    </div>
  );
}
