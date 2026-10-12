import type { SplitGroup } from "@/modules/accounting/modules/invoices/types/api";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";

// ─── Editor State ────────────────────────────────────────────────────────────

export interface EditorGroup {
  id: string;
  pages: number[];
  docType: string;
  displayName: string;
}

export interface SplitDocTypeOption {
  value: string;
  label: string;
}

export const FALLBACK_SPLIT_DOC_TYPE_OPTIONS: SplitDocTypeOption[] = [
  { value: "invoice", label: "Invoice" },
  { value: "lien-waiver", label: "Lien Waiver" },
  { value: "coi", label: "COI" },
  { value: "statement", label: "Statement" },
  { value: "other", label: "Other" },
];

export function getActiveSplitDocTypeOptions(
  classifications: readonly ClassificationInfo[],
): SplitDocTypeOption[] {
  const options = classifications
    .filter((classification) => classification.status === "active")
    .map((classification) => ({
      value: classification.name,
      label: classification.label,
    }));

  return options.length > 0 ? options : FALLBACK_SPLIT_DOC_TYPE_OPTIONS;
}

function humanizeDocType(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word === "w9" ? "W-9" : word[0]?.toUpperCase() + word.slice(1))
    .join(" ") || "Invoice";
}

export function getSplitDocTypeLabel(
  value: string,
  options: readonly SplitDocTypeOption[] = FALLBACK_SPLIT_DOC_TYPE_OPTIONS,
): string {
  return options.find((option) => option.value === value)?.label ?? humanizeDocType(value);
}

export interface SplitEditorState {
  groups: EditorGroup[];
  discardedPages: number[];
  selectedPages: Set<number>;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates the current editor layout against the total page count.
 * Every page 1..pageCount must appear exactly once across groups + discardedPages.
 */
export function validateLayout(
  state: SplitEditorState,
  pageCount: number,
): ValidationResult {
  const errors: string[] = [];

  // Check for empty groups
  for (const group of state.groups) {
    if (group.pages.length === 0) {
      errors.push(`Group "${group.displayName || "(unnamed)"}" has no pages`);
    }
    if (!group.displayName.trim()) {
      errors.push("All groups must have a display name");
    }
  }

  // Track all assigned pages
  const assigned = new Map<number, string>();
  for (const group of state.groups) {
    for (const page of group.pages) {
      if (assigned.has(page)) {
        errors.push(`Page ${page} is in multiple groups`);
      }
      assigned.set(page, group.id);
    }
  }
  for (const page of state.discardedPages) {
    if (assigned.has(page)) {
      errors.push(`Page ${page} is both in a group and discarded`);
    }
    assigned.set(page, "__discarded__");
  }

  // Check for unassigned pages
  const unassigned: number[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (!assigned.has(p)) {
      unassigned.push(p);
    }
  }
  if (unassigned.length > 0) {
    errors.push(`Unassigned pages: ${unassigned.join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Unassigned Pages ────────────────────────────────────────────────────────

/** Returns page numbers not assigned to any group or discarded. */
export function getUnassignedPages(
  state: SplitEditorState,
  pageCount: number,
): number[] {
  const assigned = new Set<number>();
  for (const group of state.groups) {
    for (const page of group.pages) assigned.add(page);
  }
  for (const page of state.discardedPages) assigned.add(page);

  const result: number[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (!assigned.has(p)) result.push(p);
  }
  return result;
}

// ─── Payload Builder ─────────────────────────────────────────────────────────

/** Maps editor state to the API request payload. */
export function layoutToGroups(state: SplitEditorState): {
  groups: SplitGroup[];
  discardPages: number[];
} {
  return {
    groups: state.groups.map((g) => ({
      pages: [...g.pages].sort((a, b) => a - b),
      docType: g.docType,
      displayName: g.displayName,
    })),
    discardPages: [...state.discardedPages].sort((a, b) => a - b),
  };
}

/** Find which group a page belongs to. Returns the group index or -1. */
export function findPageGroup(
  groups: EditorGroup[],
  page: number,
): number {
  return groups.findIndex((g) => g.pages.includes(page));
}

// ─── ID Generator ────────────────────────────────────────────────────────────

let counter = 0;
export function generateGroupId(): string {
  counter += 1;
  return `group-${Date.now()}-${counter}`;
}
