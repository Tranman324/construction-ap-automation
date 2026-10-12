"use client";

import { useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  INVOICE_PANELS,
  type InvoiceFilters,
} from "@/modules/accounting/modules/invoices/types/ui";

const VALID_STATUSES = new Set<string>([
  "all", "documents", "flagged", "pending", "approved", "rejected", "discarded", "submitted", "retry-pending", "duplicate",
  "reviewed", "needs-split", "split-processing", "split",
]);
const VALID_SORTS = new Set<string>(["date", "received", "vendor", "amount", "classification", "waivers-first"]);
const VALID_SORT_DIRS = new Set<string>(["asc", "desc"]);
const VALID_PANELS = new Set<string>(INVOICE_PANELS);

function shouldDeleteFilterParam(key: string, value: string | number | boolean | undefined): boolean {
  return value === undefined || value === "" || (value === "all" && key !== "status");
}

export function useInvoiceFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ─── Parse current URL params ──────────────────────────────────────────────
  const rawStatus = searchParams.get("status") ?? "pending";
  const rawSort = searchParams.get("sort") ?? "";
  const rawSortDir = searchParams.get("sortDir") ?? "";
  const rawPage = parseInt(searchParams.get("page") ?? "1", 10);
  const rawLimit = parseInt(searchParams.get("limit") ?? "25", 10);
  const legacyFlaggedView = rawStatus === "flagged";

  const filters: InvoiceFilters = {
    status: legacyFlaggedView
      ? "all"
      : VALID_STATUSES.has(rawStatus)
      ? (rawStatus as InvoiceFilters["status"])
      : "all",
    // Keep old `?status=flagged` links working while moving the flag view to
    // its own composable URL parameter. That lets the active status remain in
    // place when a user narrows the queue to flagged documents.
    flagged: legacyFlaggedView || searchParams.get("flagged") === "true",
    panel: VALID_PANELS.has(searchParams.get("panel") ?? "")
      ? (searchParams.get("panel") as InvoiceFilters["panel"])
      : undefined,
    classification: searchParams.get("classification") ?? undefined,
    job: searchParams.get("job") ?? undefined,
    search: searchParams.get("search") ?? "",
    sort: VALID_SORTS.has(rawSort)
      ? (rawSort as InvoiceFilters["sort"])
      : undefined,
    sortDir: VALID_SORT_DIRS.has(rawSortDir)
      ? (rawSortDir as InvoiceFilters["sortDir"])
      : undefined,
    page: isNaN(rawPage) || rawPage < 1 ? 1 : rawPage,
    limit: isNaN(rawLimit) || rawLimit < 1 ? 25 : rawLimit,
  };

  // ─── setFilter ────────────────────────────────────────────────────────────
  const setFilter = useCallback(
    (key: keyof InvoiceFilters, value: string | number | boolean | undefined) => {
      const params = new URLSearchParams(searchParams.toString());

      if (shouldDeleteFilterParam(key, value)) {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }

      if (key === "flagged" && params.get("status") === "flagged") {
        params.set("status", "all");
      }

      // Reset to page 1 when changing filter/search/sort (but not when changing page itself)
      if (key !== "page" && key !== "limit") {
        params.delete("page");
      }

      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  // ─── setFilters (batch) ───────────────────────────────────────────────────
  const setFilters = useCallback(
    (updates: Partial<Record<keyof InvoiceFilters, string | number | boolean | undefined>>) => {
      const params = new URLSearchParams(searchParams.toString());
      let resetPage = false;

      for (const [key, value] of Object.entries(updates)) {
        if (shouldDeleteFilterParam(key, value)) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
        if (key !== "page" && key !== "limit") resetPage = true;
      }

      if (Object.hasOwn(updates, "flagged") && params.get("status") === "flagged") {
        params.set("status", "all");
      }

      if (resetPage) params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  return { filters, setFilter, setFilters };
}
