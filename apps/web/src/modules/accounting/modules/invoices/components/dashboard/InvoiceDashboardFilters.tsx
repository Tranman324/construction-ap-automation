"use client";

import { useState } from "react";

import { cn } from "@/modules/shared/lib/utils";
import { useJobSearch } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { Job } from "@/modules/accounting/modules/invoices/types/api";
import {
  Check,
  CommandItem,
  ComboboxShell,
} from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/ComboboxShell";

interface InvoiceDashboardFiltersProps {
  job: string | undefined;
  onJobChange: (job: string | undefined) => void;
}

export function InvoiceDashboardFilters({
  job,
  onJobChange,
}: InvoiceDashboardFiltersProps) {
  const [jobSearchTerm, setJobSearchTerm] = useState("");
  const [jobOpen, setJobOpen] = useState(false);
  const { data: jobs, isLoading } = useJobSearch(jobSearchTerm);

  const visibleJobs = jobs ?? [];

  const selectedJob = visibleJobs.find((item: Job) => item.number === job);
  const jobDisplayLabel = selectedJob
    ? `${selectedJob.number} · ${selectedJob.description}`
    : job
      ? `Job ${job}`
      : "All jobs";

  function selectJob(nextJob: string | undefined): void {
    onJobChange(nextJob);
    setJobOpen(false);
    setJobSearchTerm("");
  }

  return (
    <div className="w-full min-w-0">
      <ComboboxShell
        value={job ?? null}
        displayLabel={jobDisplayLabel}
        onSelect={(value) => selectJob(value === "all" ? undefined : value)}
        onClear={() => selectJob(undefined)}
        placeholder="All jobs"
        searchPlaceholder="Search jobs..."
        onSearchChange={setJobSearchTerm}
        isLoading={isLoading}
        open={jobOpen}
        onOpenChange={setJobOpen}
      >
        <CommandItem value="all jobs" onSelect={() => selectJob(undefined)}>
          <Check className={cn("mr-2 h-4 w-4 shrink-0", !job ? "opacity-100" : "opacity-0")} />
          <span>All jobs</span>
        </CommandItem>
        {visibleJobs.map((item: Job) => (
          <CommandItem
            key={item.number}
            value={`${item.number} ${item.description} ${item.address}`}
            onSelect={() => selectJob(item.number)}
          >
            <Check
              className={cn(
                "mr-2 h-4 w-4 shrink-0",
                job === item.number ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="truncate font-medium">{item.number} · {item.description}</span>
          </CommandItem>
        ))}
      </ComboboxShell>
    </div>
  );
}
