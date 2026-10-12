import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { DashboardStats, InvoiceListResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";
import type { DataTableTab } from "@/modules/shared/components/patterns";

export const INVOICE_DASHBOARD_TABS: Array<{
  value: NonNullable<InvoiceFilters["status"]>;
  label: string;
}> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "submitted", label: "Submitted" },
  { value: "all", label: "All" },
  { value: "documents", label: "Documents" },
];

export function deriveOpenApBalance(stats: DashboardStats | undefined): number {
  return (stats?.amounts.pending ?? 0) + (stats?.amounts.approved ?? 0);
}

function getActiveTotal(stats: DashboardStats): number {
  return stats.activeTotal ?? stats.pending + stats.approved + stats.submitted;
}

export function getDashboardTabCount(
  stats: DashboardStats | undefined,
  status: InvoiceFilters["status"] | null | undefined,
): number | undefined {
  if (!stats) return undefined;

  switch (status) {
    case "pending":
      return stats.pending;
    case "approved":
      return stats.approved;
    case "submitted":
      return stats.submitted;
    case "all":
      return getActiveTotal(stats);
    case "discarded":
      return stats.trashTotal ?? stats.discarded;
    case "documents":
      return stats.shelfTotal;
    case "flagged":
      return stats.flaggedCount;
    default:
      return undefined;
  }
}

export function buildInvoiceDashboardTabs(stats: DashboardStats | undefined): DataTableTab[] {
  return INVOICE_DASHBOARD_TABS.map((item) => {
    return { value: item.value, label: item.label, count: getDashboardTabCount(stats, item.value) };
  });
}

function matchesJob(invoice: Invoice, job: string | undefined): boolean {
  if (!job) return true;
  return invoice.matching?.job?.jobNumber === job || invoice.extracted?.jobNumber === job;
}

export function toInvoiceQueryFilters(
  filters: InvoiceFilters,
  splitFrom: string | undefined,
): InvoiceFilters & { splitFrom?: string } {
  if (filters.search?.trim()) {
    return {
      search: filters.search.trim(),
      page: filters.page,
      limit: filters.limit,
      sort: filters.sort,
      sortDir: filters.sortDir,
      scope: 'global',
    };
  }
  const serverFilters: InvoiceFilters = { ...filters };
  delete serverFilters.job;
  const isLegacyFlaggedView = filters.status === "flagged";

  return {
    ...serverFilters,
    status: filters.status === "documents" ? undefined : isLegacyFlaggedView ? "all" : filters.status,
    // Normalize empty search to undefined so an unset search on the dashboard
    // ("") and on the detail URL (absent → undefined) resolve identically.
    search: filters.search || undefined,
    // Flagged is composable with the active queue status and document-type
    // panel. The server performs the timestamp-backed filtering; we never
    // derive this view by filtering the loaded page in the browser.
    flagged: filters.flagged || isLegacyFlaggedView ? true : undefined,
    filed: false,
    splitFrom,
  };
}

// ─── Queue navigation context (list ⇄ detail parity) ─────────────────────────
//
// The invoice list request and the detail-panel neighbors request MUST be built
// from byte-identical filter params, or `total`/`position`/`next`/`prev`
// disagree with the rendered list. The fields below are the single definition
// of what scopes a queue: the dashboard serializes them into the detail URL
// (openDetail) and the detail page deserializes them back (useInvoiceNeighbors),
// then BOTH feed the SAME `toInvoiceQueryFilters`. Keeping one field list here
// prevents the two call sites from drifting (e.g. the former dropped `splitFrom`).
// Order matches the historical detail-URL layout so existing links stay stable;
// `splitFrom` is appended by the serializer.
const QUEUE_NAV_STRING_FIELDS = ["sort", "sortDir", "panel", "classification", "search", "status"] as const;

/** Dashboard queue context → detail-URL params (used by `openDetail`). */
export function serializeQueueNavParams(
  filters: InvoiceFilters,
  splitFrom: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of QUEUE_NAV_STRING_FIELDS) {
    const value = filters[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  if (filters.flagged) out.flagged = "true";
  if (splitFrom) out.splitFrom = splitFrom;
  return out;
}

/** Detail-URL params → queue context (used by the detail page's neighbors query). */
export function deserializeQueueNavContext(
  get: (key: string) => string | null,
): { filters: InvoiceFilters; splitFrom: string | undefined } {
  const filters: InvoiceFilters = {};
  for (const key of QUEUE_NAV_STRING_FIELDS) {
    const value = get(key);
    if (value) (filters as Record<string, string>)[key] = value;
  }
  if (filters.status === "flagged") {
    filters.status = "all";
    filters.flagged = true;
  } else if (get("flagged") === "true") {
    filters.flagged = true;
  }
  return { filters, splitFrom: get("splitFrom") ?? undefined };
}

export function applyDashboardFilters(
  data: InvoiceListResponse | undefined,
  filters: InvoiceFilters,
): InvoiceListResponse | undefined {
  if (!data) return data;
  if (filters.scope === 'global') return data;

  const hasClientFilters = Boolean(filters.job);

  const invoices = data.invoices.filter((invoice) => matchesJob(invoice, filters.job));

  if (!hasClientFilters) return { ...data, invoices };

  return {
    ...data,
    invoices,
    total: invoices.length,
    page: 1,
    pages: 1,
  };
}
