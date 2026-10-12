import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

export function makeMutationWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  return { queryClient, Wrapper };
}

export function makeInvoice(id: string, vendorName: string): Invoice {
  return {
    id,
    classification: "invoice",
    confidence: 0.98,
    file: `${vendorName}.pdf`,
    email: {
      from: "vendor@example.com",
      subject: `${vendorName} invoice`,
      receivedAt: "2026-05-14T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-05-14T12:00:00.000Z",
    extracted: {
      vendorName,
      vendorAddress: null,
      invoiceNumber: null,
      invoiceDate: null,
      dueDate: null,
      amount: null,
      jobNumber: null,
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: null,
    overallConfidence: 0.98,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}
