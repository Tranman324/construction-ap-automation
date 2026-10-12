import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type {
  Actions, CompareRow, Evidence, PrimaryAction, ResolveCardModel, ResolveIconName, SecondaryAction, Value,
} from "../documents/resolveCardModel";
import {
  DUPLICATE_FALLBACK, DUPLICATE_TITLE, duplicateArmedWarnings, duplicateColumns, duplicateContext, duplicateSentence,
} from "./duplicateCardCopy";

const DELETE_PERMISSION = "accounting.invoices.delete";
const APPROVE_PERMISSION = "accounting.invoices.approve";

type CardState = "spectrum" | "toolbox" | "stale";

export interface DuplicateCardInput {
  invoice: Pick<Invoice, "id" | "status" | "duplicateOf" | "duplicateBypassed">;
  /** Live server evaluation; undefined while loading or on error (served-flag fallback). */
  status?: DuplicateStatusResponse | null;
  discardPending: boolean;
  bypassPending: boolean;
}

/** Same membership rule as the tray row: pending only, the loaded status wins, else the served flag. */
function cardState({ invoice, status }: DuplicateCardInput): CardState | null {
  if (invoice.status !== "pending") return null;
  if (status) return status.state === "none" ? null : status.state;
  return invoice.duplicateOf && !invoice.duplicateBypassed ? "toolbox" : null;
}

/** Amount on the matched record: the Spectrum hit first, else the Toolbox original. */
export function matchedAmount(status: DuplicateStatusResponse): number | null {
  return status.spectrum?.amount ?? status.original?.amount ?? null;
}

/** Amounts differ by half a cent or more; a missing amount on either side never flags. */
export function hasAmountMismatch(status: DuplicateStatusResponse): boolean {
  const ours = status.evidence?.amount;
  const theirs = matchedAmount(status);
  return ours != null && theirs != null && Math.abs(ours - theirs) >= 0.005;
}

const money = (value: number | null | undefined): Value => (value == null ? null : { kind: "money", value });
const mono = (value: string | null | undefined, note?: string): Value => {
  if (!value) return null;
  return note ? { kind: "mono", value, note } : { kind: "mono", value };
};

function invoiceNumberCell(status: DuplicateStatusResponse): Value {
  const raw = status.evidence?.invoiceNumber;
  const normalized = status.evidence?.normalizedInvoiceNumber;
  return mono(raw, normalized && normalized !== raw ? `→ ${normalized}` : undefined);
}

/** The matched record: the Spectrum hit when present, else the Toolbox original. */
function matchedRecord(status: DuplicateStatusResponse): { invoiceNumber: string | null; fileName: string | null } | null {
  const record = status.spectrum ?? status.original;
  if (!record) return null;
  return { invoiceNumber: record.invoiceNumber, fileName: status.spectrum ? null : status.original?.fileName ?? null };
}

function cardEvidence(state: CardState, status: DuplicateStatusResponse | null | undefined): Evidence | undefined {
  if (!status || state === "stale") return undefined;
  const match = matchedRecord(status);
  if (!match) return undefined;
  const rows: CompareRow[] = [
    { label: "Invoice #", a: invoiceNumberCell(status), b: mono(match.invoiceNumber) },
    { label: "Amount", a: money(status.evidence?.amount), b: money(matchedAmount(status)), differs: hasAmountMismatch(status), testid: "duplicate-amounts" },
  ];
  if (match.fileName) rows.push({ label: "File", a: null, b: mono(match.fileName) });
  return { layout: "compare", columns: duplicateColumns(status), rows };
}

/** Compact compare for the Spectrum confirm dialog: Vendor, Invoice # and Amount; no File row. */
export function buildSpectrumConfirmEvidence(status: DuplicateStatusResponse): Extract<Evidence, { layout: "compare" }> {
  const match = matchedRecord(status);
  const vendor = mono(status.evidence?.vendorCode);
  return {
    layout: "compare",
    columns: duplicateColumns(status),
    rows: [
      { label: "Vendor", a: vendor, b: mono(status.spectrum?.vendorCode ?? status.evidence?.vendorCode) },
      { label: "Invoice #", a: invoiceNumberCell(status), b: mono(match?.invoiceNumber) },
      { label: "Amount", a: money(status.evidence?.amount), b: money(matchedAmount(status)), differs: hasAmountMismatch(status) },
    ],
  };
}

interface ActionBase { id: string; label: string; icon: ResolveIconName; testid: string; permission?: string }

const VIEW: ActionBase = { id: "view", label: "View duplicate", icon: "external-link", testid: "duplicate-view" };
const INVOICE_PATH = "/accounting/invoices/";
const DISCARD: ActionBase = { id: "discard", label: "Discard", icon: "trash", testid: "duplicate-discard", permission: DELETE_PERMISSION };
const BYPASS: ActionBase = { id: "bypass", label: "Bypass", icon: "circle-off", testid: "duplicate-bypass", permission: APPROVE_PERMISSION };

/** `pending` and `pendingLabel` only while the action's mutation is in flight. */
function pendingPart(pending: boolean, pendingLabel: string): { pending?: true; pendingLabel?: string } {
  return pending ? { pending: true, pendingLabel } : {};
}

/** The document View duplicate opens: the loaded original first, else the served `duplicateOf`; null when none can be opened. */
function viewHref(state: CardState, { invoice, status }: DuplicateCardInput): string | null {
  if (state === "stale") return null;
  const originalId = status?.original?.id ?? (state === "toolbox" ? invoice.duplicateOf : null);
  if (!originalId) return null;
  if (state === "spectrum" && status?.spectrum) return null;
  return `${INVOICE_PATH}${originalId}`;
}

function cardActions(state: CardState, input: DuplicateCardInput, href: string | null): Actions {
  const discardPending = pendingPart(input.discardPending, "Discarding…");
  const bypassPending = pendingPart(input.bypassPending, "Bypassing…");
  const bypass: SecondaryAction = { ...BYPASS, ...bypassPending, emphasis: "secondary", confirm: "two-step" };
  if (state === "stale") {
    const staleBypass: PrimaryAction = { ...BYPASS, ...bypassPending, emphasis: "primary", confirm: "two-step" };
    return [staleBypass];
  }
  if (state === "spectrum") {
    const discard: PrimaryAction = { ...DISCARD, ...discardPending, emphasis: "primary", confirm: "dialog" };
    return href ? [discard, { ...VIEW, href, emphasis: "secondary" }, bypass] : [discard, bypass];
  }
  const discard: SecondaryAction = { ...DISCARD, ...discardPending, emphasis: "secondary", confirm: "two-step" };
  return href ? [{ ...VIEW, href, emphasis: "primary" }, discard, bypass] : [discard, bypass];
}

/**
 * Pure builder for the duplicate resolve card: null when the invoice has no unresolved duplicate.
 * `view` is a link action (`href` to the original); it never reports through `onAction`.
 */
export function buildDuplicateCardModel(input: DuplicateCardInput): ResolveCardModel | null {
  const state = cardState(input);
  if (!state) return null;
  const { status } = input;
  return {
    id: "duplicate",
    tone: "blocking",
    title: DUPLICATE_TITLE,
    context: duplicateContext(status),
    sentence: duplicateSentence(status),
    actions: cardActions(state, input, viewHref(state, input)),
    armedWarning: duplicateArmedWarnings(status),
    evidence: cardEvidence(state, status),
    fallback: DUPLICATE_FALLBACK,
    testid: "duplicate-resolution-card",
  };
}
