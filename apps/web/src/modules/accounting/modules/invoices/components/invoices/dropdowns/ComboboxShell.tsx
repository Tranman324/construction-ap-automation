"use client";

import { useEffect, useState, useRef } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { cn } from "@/modules/shared/lib/utils";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/modules/shared/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/modules/shared/components/ui/popover";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";

// ─── ManualBadge ──────────────────────────────────────────────────────────────
// Confidence display is retired from the UI (2026-09-02): matcher confidence
// remains in API payloads as diagnostic metadata only. This badge now marks
// manually overridden fields and nothing else.

interface ManualBadgeProps {
  isManual?: boolean;
}

export function ManualBadge({ isManual }: ManualBadgeProps) {
  if (!isManual) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-blue-600">
      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 inline-block" />
      Manual
    </span>
  );
}

// ─── ComboboxShell ────────────────────────────────────────────────────────────

export interface ComboboxShellProps {
  id?: string;
  /** Currently selected value (the key/code, not label). */
  value: string | null;
  /** Human-readable label to show in the trigger button (overrides value). */
  displayLabel?: string | null;
  onSelect: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  /** Called on every keystroke in the search input (for server-side search). */
  onSearchChange?: (term: string) => void;
  isLoading?: boolean;
  /** When true, hides the search input (e.g. small static lists). */
  hideSearch?: boolean;
  /** Controlled open state — when provided, parent owns open/close. */
  open?: boolean;
  /** Callback when open state changes (required for controlled mode). */
  onOpenChange?: (open: boolean) => void;
  /** Called when the user clicks the clear (X) button. When provided and value is set, shows a clear button. */
  onClear?: () => void;
  /** When true, the trigger is disabled: it cannot open, and the clear (X) is hidden. */
  disabled?: boolean;
  "aria-invalid"?: boolean | "true" | "false";
  className?: string;
  /** CommandItems to render inside the list. */
  children: React.ReactNode;
}

export function ComboboxShell({
  id,
  value,
  displayLabel,
  onSelect,
  placeholder,
  searchPlaceholder = "Search...",
  onSearchChange,
  isLoading,
  hideSearch,
  open: controlledOpen,
  onOpenChange,
  onClear,
  disabled,
  "aria-invalid": ariaInvalid,
  className,
  children,
}: ComboboxShellProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  // A disabled combobox never opens, regardless of controlled/internal state.
  const open = disabled ? false : (controlledOpen ?? internalOpen);
  const setOpen = disabled ? () => {} : (onOpenChange ?? setInternalOpen);

  useEffect(() => {
    if (disabled && controlledOpen) onOpenChange?.(false);
  }, [controlledOpen, disabled, onOpenChange]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-label={displayLabel ?? value ?? placeholder}
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate">{displayLabel ?? value ?? placeholder}</span>
          <span className="ml-2 flex items-center gap-0.5 shrink-0">
            {value && onClear && !disabled && (
              <span
                role="button"
                tabIndex={0}
                className="rounded-sm p-0.5 hover:bg-muted transition-colors"
                onClick={(e) => { e.stopPropagation(); onClear(); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onClear(); } }}
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5 opacity-50 hover:opacity-100" />
              </span>
            )}
            <ChevronsUpDown className="shrink-0 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onEscapeKeyDown={() => setOpen(false)}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (hideSearch) {
            listRef.current?.focus();
          } else {
            inputRef.current?.focus();
          }
        }}
      >
        <Command shouldFilter={false}>
          {!hideSearch && (
            <CommandInput
              ref={inputRef}
              placeholder={searchPlaceholder}
              onValueChange={onSearchChange}
            />
          )}
          <CommandList ref={listRef} tabIndex={hideSearch ? -1 : undefined}>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {isLoading ? (
                <div className="space-y-1.5 p-1">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                children
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Re-export CommandItem so dropdown files only need one import source.
export { CommandItem, Check };
