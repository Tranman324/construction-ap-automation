"use client";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface DiscardSourceMeta {
  label: string;
  filtered: boolean;
}

const discardSourceMeta: Record<NonNullable<Invoice["discardSource"]>, DiscardSourceMeta> = {
  manual: {
    label: "Manual",
    filtered: false,
  },
  "auto-ai": {
    label: "Junk filter",
    filtered: true,
  },
  "rule-filter": {
    label: "Junk filter",
    filtered: true,
  },
  "junk-hash": {
    label: "Junk filter",
    filtered: true,
  },
};

function getDiscardSourceMeta(discardSource: Invoice["discardSource"]): DiscardSourceMeta {
  return discardSourceMeta[discardSource ?? "manual"];
}

export function TrashDiscardSourcePill({ invoice }: { invoice: Invoice }) {
  const meta = getDiscardSourceMeta(invoice.discardSource);
  const skipReason = invoice.notes?.split(/[\r\n]/, 1)[0] ?? "";
  const description = meta.filtered
    ? skipReason || "Auto-filtered as junk"
    : invoice.deletedBy ? `Discarded by ${invoice.deletedBy}` : "Discarded manually";

  return (
    <div className="min-w-[112px]">
      <p className="text-sm font-semibold text-foreground">{meta.label}</p>
      <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p>
    </div>
  );
}
