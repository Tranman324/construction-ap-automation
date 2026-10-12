import type { RetentionRule } from "@/modules/accounting/modules/invoices/types/api";
import type { RuleOptionsResponse } from "@/modules/accounting/modules/invoices/types/api";

export interface SelectOption {
  value: string;
  label: string;
}

export interface RetentionDraft {
  classification: string;
  status: string;
  retentionDays: number;
  deletePdf: boolean;
  deleteBox: boolean;
}

export interface StaleCleanupRule {
  id: string;
  classification: string;
  days: number;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface StaleCleanupDraft {
  classification: string;
  days: number;
}

export const STATUS_TONES: Record<string, "success" | "primary" | "warning" | "destructive" | "muted" | "info"> = {
  approved: "success",
  modified: "primary",
  reviewed: "info",
  submitted: "primary",
  duplicate: "warning",
  rejected: "destructive",
  discarded: "muted",
  "retry-pending": "warning",
};

export function retentionStatusOptions(options: RuleOptionsResponse | undefined): SelectOption[] {
  return options?.statuses.map((status) => ({ value: status.value, label: status.label })) ?? [];
}

export function classificationLabel(
  value: string,
  labels: Record<string, string>,
  wildcardLabel = "All Types",
): string {
  if (value === "*") return wildcardLabel;
  return labels[value] ?? "Classification unavailable";
}

export function statusLabel(value: string, labels: Record<string, string>): string {
  return labels[value] ?? "Status unavailable";
}

export function isWildcardClassification(value: string): boolean {
  return value === "*";
}

export function clampDays(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Math.max(1, Number.isFinite(parsed) ? Math.floor(parsed) : 1);
}

export function sortRetentionRules(rules: RetentionRule[], statusOptions: SelectOption[] = []): RetentionRule[] {
  return [...rules].sort((a, b) => {
    if (isWildcardClassification(a.classification) !== isWildcardClassification(b.classification)) {
      return isWildcardClassification(a.classification) ? -1 : 1;
    }
    if (a.classification !== b.classification) return a.classification.localeCompare(b.classification);
    return statusOrder(a.status, statusOptions) - statusOrder(b.status, statusOptions);
  });
}

export function sortStaleCleanupRules(rules: StaleCleanupRule[]): StaleCleanupRule[] {
  return [...rules].sort((a, b) => {
    if (isWildcardClassification(a.classification) !== isWildcardClassification(b.classification)) {
      return isWildcardClassification(a.classification) ? -1 : 1;
    }
    return a.classification.localeCompare(b.classification);
  });
}

export function hasDuplicateRetentionRule(
  rules: RetentionRule[],
  classification: string,
  status: string,
  excludeId?: number,
): boolean {
  return rules.some((rule) => rule.id !== excludeId && rule.classification === classification && rule.status === status);
}

export function hasDuplicateStaleRule(rules: StaleCleanupRule[], classification: string, excludeId?: string): boolean {
  return rules.some((rule) => rule.id !== excludeId && rule.classification === classification);
}

export function formatRetentionTimestamp(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function initialStaleCleanupRules(): StaleCleanupRule[] {
  return [
    { id: "stale-all", classification: "*", days: 60, enabled: true, updatedAt: "Local default", updatedBy: "System" },
    { id: "stale-coi", classification: "coi", days: 90, enabled: true, updatedAt: "Local default", updatedBy: "System" },
    { id: "stale-w9", classification: "w9", days: 30, enabled: true, updatedAt: "Local default", updatedBy: "System" },
  ];
}

function statusOrder(status: string, options: SelectOption[]): number {
  const index = options.findIndex((option) => option.value === status);
  return index < 0 ? options.length : index;
}
