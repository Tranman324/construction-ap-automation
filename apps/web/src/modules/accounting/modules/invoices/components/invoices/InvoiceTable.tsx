"use client";

import * as React from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
  type VisibilityState,
  type ColumnOrderState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy } from "lucide-react";
import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/shared/components/ui/table";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";

import { StatusBadge } from "@/modules/accounting/modules/invoices/components/invoices/renderers/StatusBadge";
import { ClassificationBadge } from "@/modules/accounting/modules/invoices/components/invoices/renderers/ClassificationBadge";
import { CurrencyCell } from "@/modules/accounting/modules/invoices/components/invoices/renderers/CurrencyCell";
import { DateCell } from "@/modules/accounting/modules/invoices/components/invoices/renderers/DateCell";
import { WaiverChip } from "@/modules/accounting/modules/invoices/components/invoices/renderers/WaiverChip";
import { FlagToggleGlyph } from "@/modules/accounting/modules/invoices/components/documents/FlagToggleGlyph";
import { ReplyPriorityMarker } from "@/modules/accounting/modules/invoices/components/invoices/renderers/InvoiceMarkerRenderers";

import { cn } from "@/modules/shared/lib/utils";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { InvoiceListResponse } from "@/modules/accounting/modules/invoices/types/api";
import { DEFAULT_MAPPINGS } from "@/modules/accounting/modules/invoices/hooks/queries";
import { usesInvoiceWorkflow } from "@/modules/accounting/modules/invoices/lib/documentRouting";
import { duplicateSourceLabelLower } from "@/modules/accounting/modules/invoices/lib/duplicateSourceLabel";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";
import { useQueueArrival } from "@/modules/shared/hooks/useQueueArrival";
import { formatShortcutTooltip, useDocumentPanelKeyboardShortcuts, useDocumentShortcutLabels } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";

/** Tooltip for a Spectrum-only duplicate, e.g. "Already in Spectrum (paid, $1,500.00)". */
export function spectrumDuplicateTitle(hit: Invoice["spectrumDuplicate"]): string | null {
  if (!hit) return null;
  const parts = [duplicateSourceLabelLower(hit.source)];
  if (typeof hit.amount === "number" && Number.isFinite(hit.amount)) {
    parts.push(hit.amount.toLocaleString("en-US", { style: "currency", currency: "USD" }));
  }
  return `Already in Spectrum (${parts.join(", ")})`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRowClassName(row: { original: Invoice }) {
  const inv = row.original;
  if (inv.status === "split-processing") {
    return "opacity-60 cursor-default";
  }
  const muted = usesInvoiceWorkflow(inv.classification, DEFAULT_MAPPINGS) ? "" : "text-muted-foreground";
  return cn(muted, "cursor-pointer");
}

// ─── Types ────────────────────────────────────────────────────────────────────

type SortField = "date" | "received" | "vendor" | "amount" | "classification";
type SortDir = "asc" | "desc" | undefined;

interface InvoiceTableProps {
  data: InvoiceListResponse | undefined;
  isLoading: boolean;
  sortField?: string;
  sortDir?: SortDir;
  onSortChange?: (field: SortField) => void;
  onRowClick?: (id: string, status: string, isTrash: boolean) => void;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (v: VisibilityState) => void;
  columnOrder?: string[];
  onColumnOrderChange?: (order: string[]) => void;
  globalSearch?: boolean;
  surface?: "framed" | "flush";
}

// ─── Sortable Header Helper ───────────────────────────────────────────────────

function SortHeader({
  label,
  field,
  sortField,
  sortDir,
  onSortChange,
}: {
  label: string;
  field: SortField;
  sortField?: string;
  sortDir?: SortDir;
  onSortChange?: (f: SortField) => void;
}) {
  const isActive = sortField === field;
  const Icon = isActive
    ? sortDir === "asc"
      ? ArrowUp
      : sortDir === "desc"
        ? ArrowDown
        : ArrowUpDown
    : ArrowUpDown;

  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => onSortChange?.(field)}
    >
      {label}
      <Icon className={`h-3.5 w-3.5 ${isActive ? "text-foreground" : "text-muted-foreground/50"}`} />
    </button>
  );
}

// ─── Column Helper ───────────────────────────────────────────────────────────

const helper = createColumnHelper<Invoice>();

function buildColumns(
  sortField: string | undefined,
  sortDir: SortDir,
  onSortChange: ((f: SortField) => void) | undefined,
  globalSearch: boolean,
  selectAllShortcut: string,
) {
  return [
  // 1. Select
  helper.display({
    id: "select",
    header: ({ table }) => (
      <input
        type="checkbox"
        aria-label="Select all"
        title={formatShortcutTooltip("Select all visible rows", selectAllShortcut)}
        checked={table.getIsAllPageRowsSelected()}
        ref={(el) => {
          if (el) el.indeterminate = table.getIsSomePageRowsSelected();
        }}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        className={cn("cursor-pointer", motionStyles.queueCheckbox)}
        onClick={(e) => e.stopPropagation()}
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label="Select row"
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onChange={row.getToggleSelectedHandler()}
        className={cn("cursor-pointer", motionStyles.queueCheckbox)}
        onClick={(e) => e.stopPropagation()}
      />
    ),
    size: 40,
  }),

  helper.display({
    id: "activityMarker",
    header: "",
    cell: ({ row }) => <ReplyPriorityMarker unreadReplies={row.original.unreadReplies} unreadComments={row.original.unreadComments} />,
    size: 24,
  }),

  // 2. Status
  helper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const inv = info.row.original;

      if (globalSearch && inv.isTrash) {
        return <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">In Trash</span>;
      }

      return (
        <div className="flex items-center gap-1.5">
          <StatusBadge status={info.getValue()} wasModified={inv.wasModified} />
        </div>
      );
    },
  }),

  // 3. Vendor / Invoice
  helper.accessor((row) => {
    const vendor = row.matching?.vendor;
    if (vendor) return vendor.vendorName;
    return row.extracted?.vendorName ?? null;
  }, {
    id: "vendorName",
    header: () => (
      <SortHeader label="Vendor / Invoice" field="vendor" sortField={sortField} sortDir={sortDir} onSortChange={onSortChange} />
    ),
    cell: (info) => {
      const val = info.getValue();
      const invoice = info.row.original;
      const invoiceNumber = invoice.extracted?.invoiceNumber ?? null;
      const toolboxDuplicate = invoice.status === "pending" && Boolean(invoice.duplicateOf);
      const spectrumDuplicateLabel = toolboxDuplicate ? null : spectrumDuplicateTitle(invoice.spectrumDuplicate);

      return (
        <div className="min-w-0">
          {val ? (
            <span className="block max-w-[260px] truncate font-semibold leading-tight text-foreground" title={val}>
              {val}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {invoiceNumber || toolboxDuplicate || spectrumDuplicateLabel ? (
            <span className="flex max-w-[260px] items-center gap-1 font-mono text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{invoiceNumber ?? ""}</span>
              {toolboxDuplicate ? (
                <Link
                  href={`/accounting/invoices/${invoice.duplicateOf}`}
                  aria-label="Possible duplicate — open the original"
                  title="Possible duplicate — open the original"
                  className="inline-flex shrink-0 rounded-sm text-[var(--rc-blocking-glyph)] transition-colors hover:text-[var(--rc-blocking-glyph-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rc-blocking-glyph)]"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Copy aria-hidden="true" className="h-[13.5px] w-[13.5px]" />
                </Link>
              ) : spectrumDuplicateLabel ? (
                // Spectrum-only duplicate: nothing in Toolbox to link to, so a
                // labelled glyph (same icon/colour) instead of a link.
                <span
                  role="img"
                  aria-label={`Possible duplicate: ${spectrumDuplicateLabel}`}
                  title={spectrumDuplicateLabel}
                  data-testid="spectrum-duplicate-glyph"
                  className="inline-flex shrink-0 cursor-default text-[var(--rc-blocking-glyph)]"
                >
                  <Copy aria-hidden="true" className="h-[13.5px] w-[13.5px]" />
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      );
    },
  }),

  // 4. Job Number
  helper.accessor((row) => row.matching?.job?.jobNumber ?? row.extracted?.jobNumber ?? null, {
    id: "jobNumber",
    header: "Job",
    cell: (info) => {
      const val = info.getValue();
      return val ? (
        <span className="inv-job font-mono">{val}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  }),

  // 5. Classification
  helper.accessor("classification", {
    header: () => (
      <SortHeader label="Type" field="classification" sortField={sortField} sortDir={sortDir} onSortChange={onSortChange} />
    ),
    cell: (info) => {
      const classification = info.getValue();
      return (
        <div>
          <ClassificationBadge classification={classification} />
        </div>
      );
    },
  }),

  // 6. Waiver
  helper.display({
    id: "waiver",
    header: "Waiver",
    cell: ({ row }) => <WaiverChip status={row.original.waiverStatus} waiverBypassed={row.original.waiverBypassed} waiverBypassedAt={row.original.waiverBypassedAt} waiverBypassedBy={row.original.waiverBypassedBy} />,
  }),

  // 7. Amount
  helper.accessor((row) => row.extracted?.amount ?? null, {
    id: "amount",
    header: () => (
      <SortHeader label="Amount" field="amount" sortField={sortField} sortDir={sortDir} onSortChange={onSortChange} />
    ),
    cell: (info) => <CurrencyCell amount={info.getValue()} />,
  }),

  // 8. Queued At
  helper.accessor("queuedAt", {
    header: () => (
      <SortHeader label="Received" field="received" sortField={sortField} sortDir={sortDir} onSortChange={onSortChange} />
    ),
    // Received date on the left; the review flag is pushed to the cell's right
    // edge so it reads as its own column while living in the Received cell.
    cell: (info) => (
      <div className="flex w-full items-center justify-between gap-2">
        <DateCell dateStr={info.getValue()} />
        {globalSearch && info.row.original.isTrash ? null : <FlagToggleGlyph record={info.row.original} />}
      </div>
    ),
  }),

  // 9. Email Sender
  helper.accessor((row) => row.email?.from ?? null, {
    id: "emailFrom",
    header: "Sender",
    cell: (info) => {
      const val = info.getValue();
      return val ? (
        <span className="block max-w-[160px] truncate text-xs" title={val}>{val}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  }),

  // 10. Email Subject
  helper.accessor((row) => row.email?.subject ?? null, {
    id: "emailSubject",
    header: "Subject",
    cell: (info) => {
      const val = info.getValue();
      return val ? (
        <span className="block max-w-[200px] truncate text-xs" title={val}>{val}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  }),

  // 12. Actions — removed (was a non-functional placeholder)
  ];
}

// ─── Skeleton Rows ────────────────────────────────────────────────────────────

function SkeletonCell({ columnId }: { columnId: string }) {
  if (columnId === "select") return <Skeleton className="h-4 w-4 rounded-sm" />;
  if (columnId === "activityMarker") return <Skeleton className="h-2.5 w-2.5 rounded-full" />;
  if (columnId === "vendorName") return (
    <div className="space-y-1.5">
      <Skeleton className="h-4 w-32 max-w-full" />
      <Skeleton className="h-3 w-20 max-w-full" />
    </div>
  );
  if (["status", "classification", "waiver"].includes(columnId)) {
    return <Skeleton className="h-5 w-20 max-w-full rounded-full" />;
  }
  if (columnId === "queuedAt") return (
    <div className="flex items-center justify-between gap-2">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-4 rounded-sm" />
    </div>
  );
  if (["jobNumber", "amount"].includes(columnId)) {
    return <Skeleton className="h-4 w-16 max-w-full" />;
  }
  return <Skeleton className="h-4 w-24 max-w-full" />;
}

function SkeletonRows({ columnIds }: { columnIds: string[] }) {
  return (
    <>
      {Array.from({ length: 10 }).map((_, i) => (
        <TableRow key={i} className="pointer-events-none" aria-hidden="true">
          {columnIds.map((columnId) => (
            <TableCell key={columnId}>
              <SkeletonCell columnId={columnId} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ─── InvoiceTable ─────────────────────────────────────────────────────────────

export function InvoiceTable({
  data,
  isLoading,
  sortField,
  sortDir,
  onSortChange,
  onRowClick,
  selectedIds,
  onSelectionChange,
  columnVisibility = {},
  onColumnVisibilityChange,
  columnOrder,
  onColumnOrderChange,
  globalSearch = false,
  surface = "framed",
}: InvoiceTableProps) {
  const shortcuts = useDocumentShortcutLabels();
  const [internalRowSelection, setInternalRowSelection] = React.useState<RowSelectionState>({});
  const dragColId = React.useRef<string | null>(null);
  const [dragOverColId, setDragOverColId] = React.useState<string | null>(null);

  function handleColDragStart(colId: string) {
    dragColId.current = colId;
  }

  function handleColDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault();
    if (dragColId.current && dragColId.current !== colId) {
      setDragOverColId(colId);
    }
  }

  function handleColDrop(targetId: string) {
    const srcId = dragColId.current;
    if (!srcId || srcId === targetId) { setDragOverColId(null); return; }
    const ids = [...(columnOrder ?? [])];
    const from = ids.indexOf(srcId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) { setDragOverColId(null); return; }
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, srcId);
    onColumnOrderChange?.(next);
    setDragOverColId(null);
    dragColId.current = null;
  }

  function handleColDragEnd() {
    setDragOverColId(null);
    dragColId.current = null;
  }

  // Build full TanStack column order: fixed "select" first, then user-defined order.
  const fullColumnOrder: ColumnOrderState = React.useMemo(() => {
    if (!columnOrder || columnOrder.length === 0) return [];
    return ["select", ...columnOrder];
  }, [columnOrder]);

  const invoices = data?.invoices ?? [];
  const rowCount = data?.total ?? 0;
  const isSelectionControlled = selectedIds !== undefined;
  const rowSelection = React.useMemo<RowSelectionState>(() => {
    if (!isSelectionControlled) return internalRowSelection;

    const selectedIdSet = new Set(selectedIds);
    return Object.fromEntries(
      invoices
        .filter((invoice) => selectedIdSet.has(invoice.id))
        .map((invoice) => [invoice.id, true]),
    );
  }, [internalRowSelection, invoices, isSelectionControlled, selectedIds]);

  React.useEffect(() => {
    if (!isSelectionControlled) setInternalRowSelection({});
  }, [data, isSelectionControlled]);

  const columns = React.useMemo(
    () => buildColumns(sortField, sortDir, onSortChange, globalSearch, shortcuts.selectAll),
    [sortField, sortDir, onSortChange, globalSearch, shortcuts.selectAll]
  );

  const table = useReactTable({
    data: invoices,
    columns,
    rowCount,
    state: {
      rowSelection,
      columnVisibility,
      ...(fullColumnOrder.length > 0 ? { columnOrder: fullColumnOrder } : {}),
    },
    enableRowSelection: (row) => !(globalSearch && row.original.isTrash),
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnVisibility) : updater;
      onColumnVisibilityChange?.(next as VisibilityState);
    },
    onColumnOrderChange: (updater) => {
      const next = typeof updater === "function" ? updater(fullColumnOrder) : updater;
      // Strip the fixed "select" entry before surfacing to parent
      const stripped = next.filter((id) => id !== "select");
      onColumnOrderChange?.(stripped);
    },
    onRowSelectionChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(rowSelection) : updater;
      if (!isSelectionControlled) {
        setInternalRowSelection(next);
      }
      if (onSelectionChange) {
        const nextVisibleIds = Object.entries(next)
          .filter(([, selected]) => selected)
          .map(([id]) => id);

        if (isSelectionControlled) {
          const visibleIdSet = new Set(invoices.map((invoice) => invoice.id));
          const preservedIds = (selectedIds ?? []).filter((id) => !visibleIdSet.has(id));
          onSelectionChange([...preservedIds, ...nextVisibleIds]);
        } else {
          onSelectionChange(nextVisibleIds);
        }
      }
    },
    getRowId: (row) => row.id,
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const colCount = table.getVisibleLeafColumns().length;
  const arrivingRows = useQueueArrival(isLoading, rows.map((row) => row.id));
  const shortcutRef = React.useRef(null);
  useDocumentPanelKeyboardShortcuts({
    primaryActionRef: shortcutRef,
    undoAction: null,
    previousAction: null,
    nextAction: null,
    selectAllAction: {
      label: "Select all visible rows",
      disabled: isLoading || rows.length === 0,
      run: () => table.toggleAllPageRowsSelected(true),
    },
  });

  return (
    <div className={cn(surface === "framed" && "rounded-md border", "tbx-tablescroll overflow-x-auto")}>
      <Table className="tbx-table min-w-[880px]">
        <TableHeader className="bg-muted/50">
          {headerGroups.map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const isDraggable = header.column.id !== "select";
                const isDropTarget = dragOverColId === header.column.id;
                return (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                    draggable={isDraggable}
                    onDragStart={isDraggable ? () => handleColDragStart(header.column.id) : undefined}
                    onDragOver={isDraggable ? (e) => handleColDragOver(e, header.column.id) : undefined}
                    onDrop={isDraggable ? () => handleColDrop(header.column.id) : undefined}
                    onDragEnd={isDraggable ? handleColDragEnd : undefined}
                    className={[
                      isDraggable ? "cursor-grab select-none" : "",
                      isDropTarget ? "border-l-2 border-primary bg-primary/5" : "",
                    ].filter(Boolean).join(" ") || undefined}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <SkeletonRows columnIds={table.getVisibleLeafColumns().map((column) => column.id)} />
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colCount} className="h-32 text-center text-muted-foreground">
                No invoices found
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => (
              <TableRow
                key={row.id}
                data-arriving={index < arrivingRows ? "true" : undefined}
                data-row-order={index < arrivingRows ? index : undefined}
                style={index < arrivingRows ? { "--queue-row-order": index } as React.CSSProperties : undefined}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className={cn(getRowClassName(row), row.original.flaggedAt != null && "is-flagrow", motionStyles.queueRow, motionStyles.queueArrivalRow)}
                onClick={() => {
                  if (row.original.status !== "split-processing") {
                    onRowClick?.(row.original.id, row.original.status, row.original.isTrash === true);
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
