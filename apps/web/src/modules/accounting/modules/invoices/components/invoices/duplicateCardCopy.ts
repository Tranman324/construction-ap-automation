import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import { duplicateSourceLabel, duplicateSourceLabelLower } from "@/modules/accounting/modules/invoices/lib/duplicateSourceLabel";
import { formatValue } from "../documents/resolveCardValue";

/** Card title in every state; the tray row label uses the same string. */
export const DUPLICATE_TITLE = "Possible duplicate";
/** Shown in the actions slot when the user holds none of the actions' permissions. */
export const DUPLICATE_FALLBACK = "Needs an approver";

const BYPASS_TAIL = "Bypassing lets it be approved and submitted a second time. Recorded under your name; restorable from Details.";
const BYPASS_CLEARS = "Clears the duplicate flag. Recorded under your name; restorable from Details.";
const DISCARD_ARMED = "Discards this invoice. The original is not changed.";
const STALE_TAIL = "Nothing to open — bypass to clear the flag.";

export type DuplicateCopyStatus = DuplicateStatusResponse | null | undefined;

function money(value: number | null | undefined): string | null {
  return value == null ? null : formatValue({ kind: "money", value });
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Card context after the title. A status that is not loaded reads like Toolbox, never the duplicateOf id. */
export function duplicateContext(status: DuplicateCopyStatus): string {
  if (status?.state === "spectrum") return "already posted in Spectrum";
  if (status?.state === "stale") return "the original was discarded";
  const number = status?.original?.invoiceNumber;
  return number ? `of ${number} in Toolbox` : "in Toolbox";
}

function staleSentence(discardedAt: string | null | undefined): string {
  const date = discardedAt ? formatValue({ kind: "date", value: discardedAt }) : "—";
  const when = date === "—" ? "" : ` on ${date}`;
  return `The copy this was flagged against was discarded${when} and has been purged. ${STALE_TAIL}`;
}

/** The sentence under the title while no action is armed. */
export function duplicateSentence(status: DuplicateCopyStatus): string {
  if (status?.state === "spectrum") {
    return status.spectrum
      ? `Already posted in Spectrum — ${duplicateSourceLabelLower(status.spectrum.source)}. Confirm it there, then discard.`
      : "Submitted to Spectrum from Toolbox. Confirm it there, then discard.";
  }
  if (status?.state === "stale") return staleSentence(status.evidence?.originalDiscardedAt);
  return "Another Toolbox document has this vendor and invoice number.";
}

function spectrumBypassWarning(status: DuplicateStatusResponse): string {
  const record = status.spectrum;
  if (record) {
    const number = record.invoiceNumber ? ` as #${record.invoiceNumber}` : "";
    const amount = money(record.amount);
    return `Already posted in Spectrum${number} — ${duplicateSourceLabelLower(record.source)}${amount ? `, ${amount}` : ""}. ${BYPASS_TAIL}`;
  }
  const original = status.original;
  const number = original?.invoiceNumber ? ` as #${original.invoiceNumber}` : "";
  const amount = money(original?.amount);
  return `Already submitted to Spectrum from Toolbox${number}${amount ? ` (${amount})` : ""}. ${BYPASS_TAIL}`;
}

/** Armed-state sentences keyed by action id. Only Toolbox has a two-step Discard. */
export function duplicateArmedWarnings(status: DuplicateCopyStatus): Readonly<Record<string, string>> {
  if (status?.state === "spectrum") return { bypass: spectrumBypassWarning(status) };
  if (status?.state === "stale") return { bypass: BYPASS_CLEARS };
  return { bypass: BYPASS_CLEARS, discard: DISCARD_ARMED };
}

/** Evidence column headings: this invoice, then the matched record. */
export function duplicateColumns(status: DuplicateCopyStatus): readonly [string, string] {
  if (status?.state === "spectrum") return ["This invoice", `In Spectrum · ${duplicateSourceLabel(status.spectrum?.source)}`];
  const original = status?.original?.status;
  return ["This invoice", original ? `Original · ${capitalize(original)}` : "Original"];
}
