import type { Invoice, StatementLine, StatementLineStatus } from "@/modules/accounting/modules/invoices/types/invoice";

export interface CodingOption {
  value: string;
  label: string;
}

export type StatementLineMatchState = StatementLineStatus;

export interface StatementLineState {
  id: string;
  invoiceNumber: string;
  date: string;
  statementAmount: number;
  apAmount: number | null;
  matchState: StatementLineMatchState;
  resolved: boolean;
  resolvedAt?: string | null;
  resolutionType?: "accept_line" | "use_ap_amount" | null;
  resolvedBy?: string | null;
  source: "extracted" | "manual";
  clear?: boolean;
}

export interface StatementStats {
  cleared: number;
  total: number;
  openDiffs: number;
  openMissing: number;
  unresolved: number;
  balance: number;
}

export function roundDocumentMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function documentMoneyToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function sumDocumentMoney(values: readonly number[]): number {
  return values.reduce((total, value) => total + documentMoneyToCents(value), 0) / 100;
}

export function formatDocumentMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(roundDocumentMoney(value));
}

export function formatDocumentDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function addDocumentDays(value: string | null | undefined, days: number): string {
  if (!value) return "";
  const base = new Date(value);
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + days);
  return base.toISOString();
}

export function getDocumentVendor(record: Invoice): string {
  return record.extracted?.vendorName ?? record.matching?.vendor?.vendorName ?? record.email.from;
}

export function getStatementVendor(record: Invoice): string {
  return record.filing?.vendor?.value
    ?? record.extracted?.vendor
    ?? record.extracted?.vendorName
    ?? record.matching?.vendor?.vendorName
    ?? "Unknown vendor";
}

export function getDocumentAmount(record: Invoice): number | null {
  return record.extracted?.amount ?? null;
}

export function getReceiptLastFour(): string | null {
  return null;
}

export function lineFromStatementLine(line: StatementLine): StatementLineState {
  return {
    id: line.id,
    invoiceNumber: line.invoiceNumber,
    date: line.date ?? "",
    statementAmount: line.amount,
    apAmount: null,
    matchState: line.status,
    resolved: Boolean(line.resolvedAt && line.resolutionType),
    resolvedAt: line.resolvedAt ?? null,
    resolutionType: line.resolutionType ?? null,
    resolvedBy: line.resolvedBy ?? null,
    source: line.source,
    clear: line.clear,
  };
}

export function linesFromStatementLines(lines: readonly StatementLine[]): StatementLineState[] {
  return lines.map(lineFromStatementLine);
}

export function getInitialStatementLines(record: Invoice): StatementLineState[] {
  const statementLines = record.statementLines ?? record.extracted?.statementLines ?? [];
  return statementLines.map(lineFromStatementLine);
}

export function getStatementStats(lines: readonly StatementLineState[]): StatementStats {
  const cleared = lines.filter((line) => line.clear === true).length;
  const openDiffs = lines.filter((line) => (
    line.matchState === "amount_differs" && line.clear !== true
  )).length;
  const openMissing = lines.filter((line) => line.matchState === "not_received" && line.clear !== true).length;
  const unresolved = Math.max(lines.length - cleared, 0);
  return {
    cleared,
    total: lines.length,
    openDiffs,
    openMissing,
    unresolved,
    balance: sumDocumentMoney(lines.map((line) => line.statementAmount)),
  };
}
