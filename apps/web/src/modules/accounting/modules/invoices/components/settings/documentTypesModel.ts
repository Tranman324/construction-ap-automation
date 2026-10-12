import { DEFAULT_MAPPINGS } from "@/modules/accounting/modules/invoices/hooks/queries";
import type {
  ClassificationAssociation,
  ClassificationBatchUpdatePayload,
  ClassificationInfo,
} from "@/modules/accounting/modules/invoices/types/api";

export interface AddTypeDraft {
  name: string;
  label: string;
  opensAs: string;
}

export interface AddTypeValidation {
  valid: boolean;
  errors: Partial<Record<keyof AddTypeDraft, string>>;
}

export type DocumentTypeStatus = "active" | "disabled" | "needs-input";
export type SurfaceTone = "invoice" | "document" | "generic";

const BLOCKED_NAMES = new Set([
  "document",
  "file",
  "page",
  "attachment",
  "email",
  "pdf",
  "image",
  "text",
  "unknown",
]);

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function cloneClassificationRows(rows: readonly ClassificationInfo[]): ClassificationInfo[] {
  return rows.map((row) => ({ ...row }));
}

export function documentTypesSignature(rows: readonly ClassificationInfo[]): string {
  return JSON.stringify(rows.map((row) => row.name).sort());
}

export function isBuiltInClassification(row: ClassificationInfo): boolean {
  return row.builtIn;
}

export function canMutateClassification(row: ClassificationInfo): boolean {
  return row.name !== "invoice";
}

export function canEditOpensAs(row: ClassificationInfo): boolean {
  return row.name !== "invoice";
}

export function canEditClassificationLabel(row: ClassificationInfo): boolean {
  return !row.builtIn;
}

export function canEditClassificationStatus(row: ClassificationInfo): boolean {
  return !row.builtIn;
}

export function needsInput(row: ClassificationInfo): boolean {
  return row.opensAs === null;
}

export function deriveDocumentTypeStatus(row: ClassificationInfo): DocumentTypeStatus {
  if (needsInput(row)) return "needs-input";
  return row.status;
}

export function isClassificationDirty(current: ClassificationInfo, baseline?: ClassificationInfo): boolean {
  if (!baseline) return false;
  return current.label !== baseline.label || current.opensAs !== baseline.opensAs || current.status !== baseline.status;
}

export function getDirtyClassificationNames(
  currentRows: readonly ClassificationInfo[],
  baselineRows: readonly ClassificationInfo[],
): string[] {
  return currentRows
    .filter((row) => hasMutableChanges(row, findBaseline(row.name, baselineRows)))
    .map((row) => row.name);
}

export function buildChangedClassificationPayload(
  currentRows: readonly ClassificationInfo[],
  baselineRows: readonly ClassificationInfo[],
): ClassificationBatchUpdatePayload {
  const updates = currentRows.flatMap((row) => {
    if (!canMutateClassification(row)) return [];
    const baseline = findBaseline(row.name, baselineRows);
    if (!baseline) return [];

    const update: ClassificationBatchUpdatePayload["updates"][number] = { name: row.name };
    if (canEditClassificationLabel(row) && row.label !== baseline.label) update.label = row.label;
    if (row.opensAs !== baseline.opensAs) update.opensAs = row.opensAs;
    if (canEditClassificationStatus(row) && row.status !== baseline.status) update.status = row.status;
    return hasUpdateFields(update) ? [update] : [];
  });

  return { updates };
}

function hasMutableChanges(current: ClassificationInfo, baseline?: ClassificationInfo): boolean {
  if (!baseline || !canMutateClassification(current)) return false;
  if (current.opensAs !== baseline.opensAs) return true;
  if (canEditClassificationLabel(current) && current.label !== baseline.label) return true;
  return canEditClassificationStatus(current) && current.status !== baseline.status;
}

function hasUpdateFields(update: ClassificationBatchUpdatePayload["updates"][number]): boolean {
  return update.label !== undefined || update.opensAs !== undefined || update.status !== undefined;
}

export function validateAddType(
  draft: AddTypeDraft,
  existingRows: readonly ClassificationInfo[],
): AddTypeValidation {
  const errors: AddTypeValidation["errors"] = {};
  const name = draft.name.trim();
  const label = draft.label.trim();

  if (!name) {
    errors.name = "Name is required.";
  } else if (name.length > 50) {
    errors.name = "Name must be 50 characters or fewer.";
  } else if (!NAME_PATTERN.test(name)) {
    errors.name = "Use kebab-case letters, numbers, and hyphens only.";
  } else if (isReservedName(name, existingRows)) {
    errors.name = "Name is already used or reserved.";
  }

  const labelError = validateClassificationLabel(label);
  if (labelError) errors.label = labelError;

  if (!draft.opensAs) {
    errors.opensAs = "Choose a destination.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateClassificationLabel(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return "Label is required.";
  if (trimmed.length > 100) return "Label must be 100 characters or fewer.";
  return null;
}

export function getAssociation(
  associations: readonly ClassificationAssociation[],
  opensAs: string | null,
): ClassificationAssociation | undefined {
  return associations.find((association) => association.key === opensAs);
}

export function getAssociationLabel(
  associations: readonly ClassificationAssociation[],
  opensAs: string | null,
): string {
  return getAssociation(associations, opensAs)?.label ?? "Choose destination...";
}

export function getSurfaceTone(opensAs: string | null): SurfaceTone {
  if (opensAs === "invoice") return "invoice";
  if (opensAs === "other" || opensAs === null) return "generic";
  return "document";
}

export function upsertClassificationRow(
  rows: readonly ClassificationInfo[],
  row: ClassificationInfo,
): ClassificationInfo[] {
  const exists = rows.some((item) => item.name === row.name);
  if (!exists) return [...rows, { ...row }];
  return rows.map((item) => (item.name === row.name ? { ...row } : { ...item }));
}

export function removeClassificationRow(
  rows: readonly ClassificationInfo[],
  name: string,
): ClassificationInfo[] {
  return rows.filter((row) => row.name !== name).map((row) => ({ ...row }));
}

export function errorMessageFromUnknown(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}

function findBaseline(
  name: string,
  baselineRows: readonly ClassificationInfo[],
): ClassificationInfo | undefined {
  return baselineRows.find((row) => row.name === name);
}

function isReservedName(name: string, existingRows: readonly ClassificationInfo[]): boolean {
  if (BLOCKED_NAMES.has(name)) return true;
  const existingNames = new Set([
    ...DEFAULT_MAPPINGS.map((row) => row.name),
    ...existingRows.map((row) => row.name),
  ]);
  return existingNames.has(name);
}

function isRecord(value: unknown): value is { message?: unknown } {
  return typeof value === "object" && value !== null;
}
