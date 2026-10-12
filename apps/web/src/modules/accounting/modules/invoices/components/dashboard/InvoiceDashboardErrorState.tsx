"use client";

import { StatusPanel } from "@/modules/shared/components/patterns";

interface InvoiceDashboardErrorStateProps {
  title: string;
  message: string;
  onRetry?: () => void;
}

export function InvoiceDashboardErrorState({
  title,
  message,
  onRetry,
}: InvoiceDashboardErrorStateProps) {
  return (
    <StatusPanel
      tone="error"
      title={title}
      message={message}
      onAction={onRetry}
    />
  );
}
