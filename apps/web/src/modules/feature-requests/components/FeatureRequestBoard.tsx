"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  LayoutGrid,
  MessageSquarePlus,
  Plus,
} from "lucide-react";
import { NewRequestDialog } from "@/modules/feature-requests/components/NewRequestDialog";
import { RequestCard } from "@/modules/feature-requests/components/RequestCard";
import { useFeatureRequests } from "@/modules/feature-requests/hooks/queries";
import type { FeatureRequest, Status } from "@/modules/feature-requests/types";
import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardContent } from "@/modules/shared/components/ui/card";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import { InlinePageSearch } from "@/modules/shared/components/layout/InlinePageSearch";
import { cn } from "@/modules/shared/lib/utils";

const STATUSES: ReadonlyArray<Status> = ["open", "in_progress", "completed", "declined"];

type SortKey = "votes" | "newest" | "oldest";

function formatLabel(value: string) {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function FilterPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-[background-color,color,box-shadow]",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

export function FeatureRequestBoard() {
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("votes");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const queryParams = useMemo(
    () => ({
      ...(statusFilter !== "all" && { status: statusFilter }),
    }),
    [statusFilter],
  );

  const { data, isLoading, isError, error, refetch } = useFeatureRequests(
    Object.keys(queryParams).length > 0 ? queryParams : undefined,
  );
  const requests = data?.requests;

  const filteredRequests = useMemo(() => {
    let results: FeatureRequest[] = requests ?? [];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      results = results.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
    }

    return [...results].sort((a, b) => {
      let diff = 0;
      if (sortKey === "votes") diff = b.totalVotes - a.totalVotes;
      else if (sortKey === "newest") diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      else if (sortKey === "oldest") diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === "desc" ? diff : -diff;
    });
  }, [requests, searchQuery, sortKey, sortDir]);

  const errorMessage = error?.message ?? "Something went wrong.";

  const allRequests: FeatureRequest[] = requests ?? [];
  const openCount = allRequests.filter((r) => r.status === "open").length;
  const inProgressCount = allRequests.filter((r) => r.status === "in_progress").length;
  const completedCount = allRequests.filter((r) => r.status === "completed").length;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex flex-col gap-4 p-4">
        {/* Action strip */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-xl border border-primary/15 bg-gradient-to-r from-primary/[0.04] to-transparent px-4 sm:px-5 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Feature Request Board</p>
            <p className="text-xs text-muted-foreground">Vote on what matters — highest demand rises to the top.</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
            <Button size="sm" className="h-9 flex-1 sm:flex-initial" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Request
            </Button>
          </div>
        </div>

        {/* Section header + filter controls */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2 lg:flex-1">
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
              <FilterPill
                active={statusFilter === "all"}
                label="All"
                onClick={() => setStatusFilter("all")}
              />
              {STATUSES.map((status) => (
                <FilterPill
                  key={status}
                  active={statusFilter === status}
                  label={formatLabel(status)}
                  onClick={() => setStatusFilter(status)}
                />
              ))}
            </div>
            <InlinePageSearch
              ariaLabel="Search feature requests"
              className="w-full lg:max-w-sm"
              onValueChange={setSearchInput}
              placeholder="Search feature requests..."
              value={searchInput}
            />
          </div>

          <div className="flex items-center gap-2 lg:ml-auto">
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
              {(["votes", "newest", "oldest"] as SortKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortKey(key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-[background-color,color,box-shadow]",
                    sortKey === key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {key === "votes" ? "Top" : key === "newest" ? "Newest" : "Oldest"}
                </button>
              ))}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              aria-label="Toggle sort direction"
            >
              {sortDir === "desc" ? (
                <ArrowDown className="h-4 w-4" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Section label */}
        <div className="flex items-center gap-2 pt-1">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground tracking-wide uppercase">
            Requests
          </h2>
          {!isLoading && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full tabular-nums">
              {filteredRequests.length}
            </span>
          )}
        </div>

        {/* Loading skeletons for cards */}
        {isLoading && (
          <div className="mx-auto w-full max-w-2xl flex flex-col gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} style={{ animation: "card-enter 0.4s ease-out both", animationDelay: `${i * 60}ms` }}>
                <CardContent className="h-48">
                  <Skeleton className="h-full w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold">Unable to load feature requests</h2>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        )}

        {/* Card grid */}
        {!isLoading && !isError && (
          filteredRequests.length > 0 ? (
            <div className="mx-auto w-full max-w-2xl flex flex-col gap-4">
              {filteredRequests.map((request, index) => (
                <RequestCard key={request.id} request={request} index={index} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <MessageSquarePlus className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">
                {allRequests.length === 0
                  ? "No requests yet — be the first!"
                  : "No requests match your filters."}
              </p>
              {statusFilter !== "all" && (
                <Button variant="outline" size="sm" onClick={() => setStatusFilter("all")}>
                  Reset filters
                </Button>
              )}
            </div>
          )
        )}
      </div>

      <NewRequestDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}