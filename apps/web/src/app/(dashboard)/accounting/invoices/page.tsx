"use client";

import { Suspense } from "react";
import { InvoiceQueuePage } from "@/app/(dashboard)/accounting/invoices/InvoiceQueuePage";

export default function InvoicesPage() {
  return (
    <Suspense>
      <InvoiceQueuePage />
    </Suspense>
  );
}