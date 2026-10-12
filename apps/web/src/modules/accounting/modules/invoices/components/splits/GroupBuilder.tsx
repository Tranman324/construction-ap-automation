"use client";

import { Check, Plus, Trash2, X } from "lucide-react";

import {
  ClassificationSelectItem,
  ClassificationSelectValue,
} from "@/modules/accounting/modules/invoices/components/invoices/renderers/ClassificationSelectParts";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";
import {
  findPageGroup,
  getUnassignedPages,
  getSplitDocTypeLabel,
  type EditorGroup,
  type SplitDocTypeOption,
  type SplitEditorState,
} from "@/modules/accounting/modules/invoices/lib/splitLayout";
import {
  getGroupBorderColor,
  getGroupColor,
  getGroupSoftColor,
  getGroupTextColor,
} from "@/modules/accounting/modules/invoices/lib/splitGroupColors";
import { cn } from "@/modules/shared/lib/utils";

interface GroupBuilderProps {
  state: SplitEditorState;
  pageCount: number;
  selectedPage: number;
  docTypeOptions: readonly SplitDocTypeOption[];
  onCreateGroup: () => void;
  onUpdateGroupName: (groupId: string, name: string) => void;
  onUpdateGroupDocType: (groupId: string, docType: EditorGroup["docType"]) => void;
  onDiscardSelected: () => void;
  onClearSelection: () => void;
  onSelectAllUnassigned: () => void;
  onSelectGroup: (groupId: string) => void;
  onHoverGroup: (index: number | null) => void;
}

function formatRange(pages: number[]): string {
  const sortedPages = [...pages].sort((a, b) => a - b);
  if (sortedPages.length === 0) return "No pages";
  if (sortedPages.length === 1) return `p${sortedPages[0]}`;
  return `p${sortedPages[0]}-${sortedPages[sortedPages.length - 1]}`;
}

export function GroupBuilder({
  state,
  pageCount,
  selectedPage,
  docTypeOptions,
  onCreateGroup,
  onUpdateGroupName,
  onUpdateGroupDocType,
  onDiscardSelected,
  onClearSelection,
  onSelectAllUnassigned,
  onSelectGroup,
  onHoverGroup,
}: GroupBuilderProps) {
  const unassignedPages = getUnassignedPages(state, pageCount);
  const selectedGroupIndex = findPageGroup(state.groups, selectedPage);
  const hasSelection = state.selectedPages.size > 0;
  const showSelectAllUnassigned = pageCount > 5 && unassignedPages.length > 0;

  return (
    <section className="flex max-h-[42%] min-h-[220px] shrink-0 flex-col border-t bg-card">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">
            Documents
          </p>
          <p className="text-xs text-muted-foreground">
            Name each output document and confirm its classification.
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
          {state.groups.length}
        </span>
      </div>

      {hasSelection ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2">
          <span className="font-mono text-xs font-semibold text-primary">
            {state.selectedPages.size} selected
          </span>
          <PermissionGate requires="accounting.invoices.manage_splits">
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onCreateGroup}>
              <Plus className="h-3.5 w-3.5" />
              New document
            </Button>
          </PermissionGate>
          <PermissionGate requires="accounting.invoices.manage_splits">
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onDiscardSelected}>
              <Trash2 className="h-3.5 w-3.5" />
              Discard
            </Button>
          </PermissionGate>
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 gap-1 text-xs" onClick={onClearSelection}>
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      ) : null}

      {!hasSelection && unassignedPages.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <span>{unassignedPages.length} unassigned page{unassignedPages.length !== 1 ? "s" : ""}</span>
          {showSelectAllUnassigned ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  aria-label="Select all unassigned pages"
                  onClick={onSelectAllUnassigned}
                >
                  Select all
                </Button>
              </TooltipTrigger>
              <TooltipContent>Select all unassigned pages</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      {!hasSelection && unassignedPages.length === 0 && state.groups.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b bg-emerald-50 px-4 py-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
          <Check className="h-3.5 w-3.5" />
          All pages assigned
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-2">
          {state.groups.map((group, index) => {
            const isSelected = selectedGroupIndex === index;
            return (
              <div
                key={group.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectGroup(group.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectGroup(group.id);
                  }
                }}
                onMouseEnter={() => onHoverGroup(index)}
                onMouseLeave={() => onHoverGroup(null)}
                className={cn(
                  "grid grid-cols-[14px_52px_minmax(0,1fr)_148px_64px_52px] items-center gap-2 rounded-md border border-l-4 bg-background px-3 py-2 text-left transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  getGroupBorderColor(index),
                  isSelected && [getGroupSoftColor(index), "shadow-sm"],
                )}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", getGroupColor(index))} />
                <span className={cn("text-xs font-bold", getGroupTextColor(index))}>
                  Doc {index + 1}
                </span>
                <Input
                  value={group.displayName}
                  placeholder={`Document ${index + 1}`}
                  className="h-8 min-w-0 text-sm font-semibold"
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onUpdateGroupName(group.id, event.target.value)}
                />
                <div onClick={(event) => event.stopPropagation()}>
                  <Select
                    value={group.docType}
                    onValueChange={(value) => onUpdateGroupDocType(group.id, value)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue>
                        <ClassificationSelectValue
                          classification={group.docType}
                          label={getSplitDocTypeLabel(group.docType, docTypeOptions)}
                        />
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {docTypeOptions.map((option) => (
                        <ClassificationSelectItem
                          key={option.value}
                          classification={option.value}
                          label={option.label}
                          className="text-xs"
                        />
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <span className="text-right font-mono text-xs text-muted-foreground">
                  {formatRange(group.pages)}
                </span>
                <span className="text-right font-mono text-xs text-muted-foreground">
                  {group.pages.length} pg
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
