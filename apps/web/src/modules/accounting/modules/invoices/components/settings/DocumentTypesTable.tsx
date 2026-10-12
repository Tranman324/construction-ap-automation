"use client";

import { FileText, Lock } from "lucide-react";

import {
  canEditClassificationLabel,
  isBuiltInClassification,
  isClassificationDirty,
} from "@/modules/accounting/modules/invoices/components/settings/documentTypesModel";
import {
  DestinationCell,
  StatusControl,
} from "@/modules/accounting/modules/invoices/components/settings/DocumentTypesTableControls";
import type {
  ClassificationAssociation,
  ClassificationInfo,
} from "@/modules/accounting/modules/invoices/types/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/modules/shared/components/ui/table";
import { Input } from "@/modules/shared/components/ui/input";
import { cn } from "@/modules/shared/lib/utils";

interface DocumentTypesTableProps {
  rows: readonly ClassificationInfo[];
  baselineRows: readonly ClassificationInfo[];
  associations: readonly ClassificationAssociation[];
  pending: boolean;
  labelErrors?: Readonly<Record<string, string>>;
  onLabelChange: (name: string, label: string) => void;
  onOpensAsChange: (name: string, opensAs: string) => void;
  onToggleStatus: (name: string) => void;
}

export function DocumentTypesTable({
  rows,
  baselineRows,
  associations,
  pending,
  labelErrors = {},
  onLabelChange,
  onOpensAsChange,
  onToggleStatus,
}: DocumentTypesTableProps) {
  if (rows.length === 0) {
    return <p className="px-5 py-6 text-sm text-muted-foreground">No document type mappings are available.</p>;
  }

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead>Document Type</TableHead>
          <TableHead className="w-[230px]">Opens As</TableHead>
          <TableHead className="w-[132px]">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const baseline = baselineRows.find((item) => item.name === row.name);
          const dirty = isClassificationDirty(row, baseline);
          return (
            <TableRow key={row.name} className={cn(dirty && "[&>td]:bg-amber-500/10")}>
              <TableCell className="min-w-0">
                <DocumentTypeCell
                  row={row}
                  pending={pending}
                  error={labelErrors[row.name]}
                  onLabelChange={(label) => onLabelChange(row.name, label)}
                />
              </TableCell>
              <TableCell>
                <DestinationCell
                  row={row}
                  associations={associations}
                  pending={pending}
                  onChange={(opensAs) => onOpensAsChange(row.name, opensAs)}
                />
              </TableCell>
              <TableCell>
                <StatusControl row={row} pending={pending} onToggle={() => onToggleStatus(row.name)} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function DocumentTypeCell({
  row,
  pending,
  error,
  onLabelChange,
}: {
  row: ClassificationInfo;
  pending: boolean;
  error?: string;
  onLabelChange: (label: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <FileText className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {canEditClassificationLabel(row) ? (
            <Input
              aria-label={`${row.name} label`}
              value={row.label}
              disabled={pending}
              aria-invalid={!!error}
              className="h-8 max-w-[220px] px-2 text-sm font-semibold"
              onChange={(event) => onLabelChange(event.target.value)}
            />
          ) : (
            <p className="truncate text-sm font-semibold">{row.label}</p>
          )}
          {isBuiltInClassification(row) ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-2xs font-semibold text-muted-foreground">
              <Lock className="h-3 w-3" />
              Built-in
            </span>
          ) : null}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">{row.name}</p>
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
