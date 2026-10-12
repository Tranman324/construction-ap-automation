"use client";

import { Columns, RotateCcw } from "lucide-react";
import type { VisibilityState } from "@tanstack/react-table";
import { Button } from "@/modules/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/modules/shared/components/ui/dropdown-menu";

export const TOGGLEABLE_COLUMNS: { id: string; label: string; defaultHidden?: boolean }[] = [
  { id: "status",            label: "Status" },
  { id: "jobNumber",         label: "Job"         },
  { id: "classification",    label: "Type"        },
  { id: "waiver",            label: "Waiver"      },
  { id: "emailFrom",         label: "Sender",      defaultHidden: true },
  { id: "emailSubject",      label: "Subject",     defaultHidden: true },
  { id: "amount",            label: "Amount"      },
  { id: "queuedAt",          label: "Received"    },
];

export const DEFAULT_COLUMN_ORDER = [
  "status",
  "activityMarker",
  "vendorName",
  "jobNumber",
  "classification",
  "waiver",
  "amount",
  "queuedAt",
  "emailFrom",
  "emailSubject",
];

function isVisible(id: string, visibility: VisibilityState) {
  if (visibility[id] !== undefined) return visibility[id] !== false;
  return !TOGGLEABLE_COLUMNS.find((column) => column.id === id)?.defaultHidden;
}

function differsFromDefault(columnVisibility: VisibilityState, columnOrder: string[]): boolean {
  const visibilityDiffers = TOGGLEABLE_COLUMNS.some((column) => {
    const defaultVisible = !column.defaultHidden;
    return isVisible(column.id, columnVisibility) !== defaultVisible;
  });
  return visibilityDiffers || columnOrder.length !== DEFAULT_COLUMN_ORDER.length
    || columnOrder.some((column, index) => column !== DEFAULT_COLUMN_ORDER[index]);
}

interface Props {
  columnVisibility: VisibilityState;
  onVisibilityChange: (v: VisibilityState) => void;
  columnOrder: string[];
  onReset?: () => void;
}

export function ColumnToggleDropdown({
  columnVisibility,
  onVisibilityChange,
  columnOrder,
  onReset,
}: Props) {

  const hasCustomColumns = differsFromDefault(columnVisibility, columnOrder);

  function toggle(id: string) {
    onVisibilityChange({ ...columnVisibility, [id]: !isVisible(id, columnVisibility) });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="relative h-9 w-9 shadow-xs"
          aria-label="Columns"
          title="Columns"
        >
          <Columns className="h-4 w-4" aria-hidden="true" />
          {hasCustomColumns && <span aria-hidden="true" className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-primary" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[190px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="text-2xs uppercase text-muted-foreground">
          Show columns
        </DropdownMenuLabel>
        {TOGGLEABLE_COLUMNS.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.id}
            checked={isVisible(col.id, columnVisibility)}
            onCheckedChange={() => toggle(col.id)}
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
        {onReset && (
          <DropdownMenuItem onSelect={onReset} className="gap-2 font-medium">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset to default
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
