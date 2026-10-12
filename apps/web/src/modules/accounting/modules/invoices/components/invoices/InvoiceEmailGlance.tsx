"use client";

import type { InvoiceEmail } from "@/modules/accounting/modules/invoices/types/invoice";
import { cn } from "@/modules/shared/lib/utils";
import { DocumentEmailSection } from "@/modules/accounting/modules/invoices/components/documents/DocumentEmailSection";

export interface InvoiceEmailGlanceProps {
  email?: InvoiceEmail | null;
  body?: string | null;
  className?: string;
}

/** Invoice-scoped email glance card; document panels retain their own default presentation. */
export function InvoiceEmailGlance({ email, body, className }: InvoiceEmailGlanceProps) {
  return (
    <DocumentEmailSection
      presentation="glance"
      email={email}
      body={body}
      className={cn(
        "mb-[18px] shrink-0 rounded-xl border border-border bg-muted/25 px-[14px] py-[11px]",
        className,
      )}
    />
  );
}
