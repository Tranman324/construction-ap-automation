"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronRight, X } from "lucide-react";

import { DocumentShelfControls, DOCUMENT_STATUSES, type DocumentShelfStatus } from "@/modules/accounting/modules/invoices/components/documents/DocumentShelfControls";
import { DocumentShelfSelectionBar } from "@/modules/accounting/modules/invoices/components/documents/DocumentShelfSelectionBar";
import { LienWaiverEditPanel } from "@/modules/accounting/modules/invoices/components/documents/LienWaiverEditPanel";
import { InvoiceTable } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceTable";
import { PaginationBar } from "@/modules/accounting/modules/invoices/components/invoices/PaginationBar";
import { useInvoices } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";
import { Button } from "@/modules/shared/components/ui/button";

function getDocumentStatus(value: string | null): DocumentShelfStatus {
  return DOCUMENT_STATUSES.includes(value as DocumentShelfStatus) ? value as DocumentShelfStatus : "all";
}

export function DocumentShelfWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const [editPanelId, setEditPanelId] = useState<string | null>(null);

  const search = searchParams.get("search") ?? "";
  const panel = searchParams.get("panel") as InvoiceFilters["panel"] | null;
  const classification = searchParams.get("classification") ?? "";
  const documentStatus = getDocumentStatus(searchParams.get("docStatus"));
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.max(1, Number.parseInt(searchParams.get("limit") ?? "25", 10) || 25);
  const sort = searchParams.get("sort") as InvoiceFilters["sort"] | null;
  const sortDir = searchParams.get("sortDir") as InvoiceFilters["sortDir"] | null;
  const selectionScope = [panel ?? "", classification, documentStatus, limit, page, search, sort ?? "", sortDir ?? ""].join("|");
  const selectedIds = selection.scope === selectionScope ? selection.ids : [];

  const setParam = useCallback((key: string, value: string | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("status", "documents");
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    if (key !== "page" && key !== "limit") params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }, [pathname, router, searchParams]);

  const { data, isLoading } = useInvoices({
    search: search || undefined,
    panel: panel ?? undefined,
    classification: classification || undefined,
    status: documentStatus === "all" ? undefined : documentStatus,
    page,
    limit,
    filed: true,
    sort: sort ?? undefined,
    sortDir: sortDir ?? undefined,
  });
  const { data: pendingLienWaivers } = useInvoices({
    classification: "lien-waiver",
    status: "pending",
    filed: true,
    limit: 50,
  });

  function openDocument(id: string) {
    const returnParams = new URLSearchParams(searchParams.toString());
    returnParams.set("status", "documents");
    const detailParams = new URLSearchParams();
    detailParams.set("from", `${pathname}?${returnParams.toString()}`);
    detailParams.set("status", "documents");
    if (classification) detailParams.set("classification", classification);
    if (panel) detailParams.set("panel", panel);
    if (documentStatus !== "all") detailParams.set("docStatus", documentStatus);
    if (search) detailParams.set("search", search);
    if (sort) detailParams.set("sort", sort);
    if (sortDir) detailParams.set("sortDir", sortDir);
    detailParams.set("page", String(page));
    detailParams.set("limit", String(limit));
    router.push(`/accounting/documents/${id}?${detailParams.toString()}`);
  }

  const waiverCount = pendingLienWaivers?.invoices.length ?? 0;

  return (
    <>
      <DocumentShelfControls
        documentStatus={documentStatus}
        onParamChange={setParam}
      />
      <div className="flex flex-col gap-3 px-4 py-3">
        {search && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <span>Showing results for <span className="font-medium">&quot;{search}&quot;</span></span>
            <Button variant="ghost" size="icon" className="ml-auto h-5 w-5" aria-label="Clear search" onClick={() => setParam("search", undefined)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {waiverCount > 0 && !((panel === "lien-waiver" || (!panel && classification === "lien-waiver")) && documentStatus === "pending") && (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left transition-colors hover:bg-amber-100 dark:border-amber-800/50 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("status", "documents");
              params.set("panel", "lien-waiver");
              params.delete("classification");
              params.set("docStatus", "pending");
              params.delete("page");
              router.push(`${pathname}?${params.toString()}`);
            }}
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-800 dark:text-amber-200">
              <span className="font-semibold">{waiverCount} lien waiver{waiverCount === 1 ? "" : "s"}</span> missing vendor or job
            </span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
          </button>
        )}

        <InvoiceTable
          data={data}
          isLoading={isLoading}
          onRowClick={(id) => openDocument(id)}
          selectedIds={selectedIds}
          onSelectionChange={(ids) => setSelection({ scope: selectionScope, ids })}
          columnVisibility={{ amount: false, status: false }}
          columnOrder={["classification", "vendorName", "jobNumber", "emailFrom", "emailSubject", "queuedAt"]}
          surface="flush"
        />
        <PaginationBar
          page={page}
          pages={data?.pages ?? 1}
          total={data?.total ?? 0}
          limit={limit}
          selectedCount={selectedIds.length}
          onPageChange={(nextPage) => setParam("page", String(nextPage))}
          onLimitChange={(nextLimit) => setParam("limit", String(nextLimit))}
        />
      </div>

      <DocumentShelfSelectionBar selectedIds={selectedIds} onClear={() => setSelection({ scope: selectionScope, ids: [] })} />
      <LienWaiverEditPanel id={editPanelId} onClose={() => setEditPanelId(null)} />
    </>
  );
}
