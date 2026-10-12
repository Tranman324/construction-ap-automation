import type { SpectrumDuplicateSource } from "@/modules/accounting/modules/invoices/types/invoice";

/** Label shown when a duplicate has no Spectrum bucket (Toolbox-only, null, or unrecognized source). */
const TOOLBOX_LABEL = "Submitted from Toolbox";

const SOURCE_LABEL: Record<SpectrumDuplicateSource, string> = {
  OPEN_ITEMS: "Unpaid (open items)",
  APPROVAL: "Awaiting approval",
  PAYMENT_HIST: "Paid",
};

function isKnownSource(source: string): source is SpectrumDuplicateSource {
  return Object.prototype.hasOwnProperty.call(SOURCE_LABEL, source);
}

/**
 * Single source-to-label map for duplicate buckets. Null, empty and unrecognized
 * sources all read "Submitted from Toolbox"; a raw enum value never renders.
 */
export function duplicateSourceLabel(source: string | null | undefined): string {
  return source && isKnownSource(source) ? SOURCE_LABEL[source] : TOOLBOX_LABEL;
}

/** Lower-first variant for mid-sentence use; only the first character changes ("Toolbox" keeps its capital). */
export function duplicateSourceLabelLower(source: string | null | undefined): string {
  const label = duplicateSourceLabel(source);
  return label.charAt(0).toLowerCase() + label.slice(1);
}
