import {
  getInitialStatementLines,
  linesFromStatementLines,
  roundDocumentMoney,
  type StatementLineState,
} from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import type {
  AddStatementLinePayload,
  AddStatementLineResponse,
  DeleteStatementLineResponse,
  RematchStatementLinesResponse,
  StatementLineResolutionResponse,
  UpdateStatementLineResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import type { DocumentFormState } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice, StatementAttributes, StatementReconcileState } from "@/modules/accounting/modules/invoices/types/invoice";

export interface StatementDocumentFormState extends DocumentFormState {
  lines: StatementLineState[];
  vendorCode: string;
  statementPeriod: string;
  statementBalance: string;
  newLineInvoiceNumber: string;
  newLineDate: string;
  newLineAmount: string;
  addLineError: string | null;
  addingLine: boolean;
  filed: boolean;
  filing: boolean;
  reconciled: boolean;
  reconciling: boolean;
  reconcileError: string | null;
  rematchingLines: boolean;
  rematchError: string | null;
  vendorUpdateError: string | null;
  reconcile: StatementReconcileState | null;
  statementAttributes: StatementAttributes | null;
  statementAttributeError: string | null;
  statementAttributeSaveState: "idle" | "saving" | "saved" | "error";
}

interface ParsedStatementLinePayload {
  payload: AddStatementLinePayload | null;
  error: string | null;
}

function formatStatementBalanceInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return roundDocumentMoney(value).toFixed(2);
}

export function initStatementDocumentForm(record: Invoice): StatementDocumentFormState {
  const lines = getInitialStatementLines(record);
  const attributes = record.statementAttributes ?? null;
  const balance = attributes?.balance.value ?? null;
  return {
    lines,
    vendorCode: record.matching?.vendor?.vendorCode ?? "",
    statementPeriod: attributes?.statementPeriod.value ?? "",
    statementBalance: formatStatementBalanceInput(balance),
    newLineInvoiceNumber: "",
    newLineDate: "",
    newLineAmount: "",
    addLineError: null,
    addingLine: false,
    filed: Boolean(record.filed),
    filing: false,
    reconciled: Boolean(record.reconciled),
    reconciling: false,
    reconcileError: null,
    rematchingLines: false,
    rematchError: null,
    vendorUpdateError: null,
    reconcile: record.reconcile ?? null,
    statementAttributes: attributes,
    statementAttributeError: null,
    statementAttributeSaveState: "idle",
  };
}

export function parseStatementAmountInput(value: string): number | null {
  const amount = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function parseStatementLinePayload(form: StatementDocumentFormState): ParsedStatementLinePayload {
  const invoiceNumber = form.newLineInvoiceNumber.trim();
  const amount = parseStatementAmountInput(form.newLineAmount);
  if (!invoiceNumber) return { payload: null, error: "Invoice number is required." };
  if (amount === null) return { payload: null, error: "Enter a positive amount." };
  return {
    payload: { invoiceNumber, date: form.newLineDate || null, amount },
    error: null,
  };
}

function getStatementLines(response: { statementLines?: Invoice["statementLines"] | null } | null | undefined): StatementLineState[] {
  return linesFromStatementLines(response?.statementLines ?? []);
}

export function getStatementLinesAfterAdd(
  response: AddStatementLineResponse,
): StatementLineState[] {
  return getStatementLines(response);
}

export function getStatementLinesAfterUpdate(
  response: UpdateStatementLineResponse,
): StatementLineState[] {
  return getStatementLines(response);
}

export function getStatementLinesAfterDelete(
  response: DeleteStatementLineResponse,
): StatementLineState[] {
  return getStatementLines(response);
}

export function getStatementLinesAfterRematch(
  response: RematchStatementLinesResponse,
): StatementLineState[] {
  return getStatementLines(response);
}

export function getStatementLinesAfterResolution(
  response: StatementLineResolutionResponse,
): StatementLineState[] {
  return getStatementLines(response);
}
