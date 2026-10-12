"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/modules/shared/lib/utils";
import { useJobSearch, useJobByNumber } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { Job } from "@/modules/accounting/modules/invoices/types/api";

import {
  Check,
  CommandItem,
  ComboboxShell,
  ManualBadge,
} from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/ComboboxShell";

// ─── Props ────────────────────────────────────────────────────────────────────

interface JobDropdownProps {
  id?: string;
  value: string | null;
  /** Job description from invoice matching data — shown when the job isn't
   * in the current search results (API failure, small result set, etc.) */
  jobDescription?: string | null;
  isManual?: boolean;
  onChange: (jobNumber: string | null) => void;
  clearOptionLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean | "true" | "false";
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JobDropdown({
  id,
  value,
  jobDescription,
  isManual,
  onChange,
  clearOptionLabel,
  placeholder = "Select job…",
  disabled,
  "aria-invalid": ariaInvalid,
  className,
}: JobDropdownProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: jobs, isLoading } = useJobSearch(searchTerm);
  const [open, setOpen] = useState(false);

  // Sort descending by job number (newest jobs first)
  const sortedJobs = [...(jobs ?? [])].sort((a, b) =>
    b.number.localeCompare(a.number, undefined, { numeric: true })
  );

  // Prefer finding the job in search results; fall back to a dedicated lookup
  // by number so the selected job remains identifiable even outside the
  // current search page.
  const selectedSearchJob = sortedJobs.find((j: Job) => j.number === value);
  const { data: lookedUpJob } = useJobByNumber(
    !selectedSearchJob && value ? value : undefined
  );
  const selectedJob = selectedSearchJob ?? lookedUpJob;
  const resolvedDescription =
    selectedJob?.description ?? jobDescription;
  const displayLabel = value && resolvedDescription
    ? `${value} — ${resolvedDescription}`
    : value;
  const orderedJobs = selectedJob
    ? [selectedJob, ...sortedJobs.filter((job: Job) => job.number !== selectedJob.number)]
    : sortedJobs;

  return (
    <div className="flex flex-col gap-1 w-full">
      <ComboboxShell
        id={id}
        value={value}
        displayLabel={displayLabel}
        onSelect={(number) => onChange(number)}
        onClear={() => { onChange(null); setOpen(false); }}
        placeholder={placeholder}
        searchPlaceholder="Search jobs…"
        onSearchChange={setSearchTerm}
        isLoading={isLoading}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        className={className}
      >
        {orderedJobs.map((job: Job) => (
          <CommandItem
            key={job.number}
            value={`${job.number} ${job.description} ${job.address}`}
            onSelect={() => { onChange(job.number); setOpen(false); }}
            className="items-start"
          >
            <Check
              className={cn(
                "mr-2 h-4 w-4 shrink-0 mt-0.5",
                value === job.number ? "opacity-100" : "opacity-0"
              )}
            />
            <div className="flex flex-col min-w-0">
              <span className="truncate font-medium">
                {job.number} — {job.description}
              </span>
              {job.address && (
                <span className="truncate text-xs text-muted-foreground">
                  {job.address}
                </span>
              )}
            </div>
          </CommandItem>
        ))}
        {clearOptionLabel ? (
          <CommandItem
            value={clearOptionLabel}
            onSelect={() => { onChange(null); setOpen(false); }}
          >
            <X className="mr-2 h-4 w-4 shrink-0" />
            {clearOptionLabel}
          </CommandItem>
        ) : null}
      </ComboboxShell>

      {selectedJob?.address ? (
        <p className="truncate text-xs text-muted-foreground">
          {selectedJob.address}
        </p>
      ) : null}
      <ManualBadge isManual={isManual} />
    </div>
  );
}
