"use client";

import { BarChart3, CheckCircle2, Clock } from "lucide-react";

import type { DashboardStats } from "@/modules/accounting/modules/invoices/types/api";
import type { InvoiceStatusFilter } from "@/modules/accounting/modules/invoices/types/ui";
import {
  deriveOpenApBalance,
} from "@/modules/accounting/modules/invoices/components/dashboard/invoiceDashboardModel";
import { InvoiceDashboardErrorState } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceDashboardErrorState";
import { MetricCard, StatGrid } from "@/modules/shared/components/patterns";

interface InvoiceMetricsGridProps {
  stats: DashboardStats | undefined;
  isLoading: boolean;
  isError?: boolean;
  activeStatus: InvoiceStatusFilter;
  onStatusSelect: (status: InvoiceStatusFilter) => void;
  onRetry?: () => void;
}

function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatMetricValue(value: number | undefined, isLoading: boolean): string | number {
  if (isLoading) return "--";
  return value ?? 0;
}

export function InvoiceMetricsGrid({
  stats,
  isLoading,
  isError = false,
  activeStatus,
  onStatusSelect,
  onRetry,
}: InvoiceMetricsGridProps) {
  if (isError) {
    return (
      <InvoiceDashboardErrorState
        title="Invoice metrics unavailable"
        message="The queue totals could not be loaded. Retry before making dashboard-wide decisions."
        onRetry={onRetry}
      />
    );
  }

  const openApBalance = deriveOpenApBalance(stats);

  return (
    <StatGrid cols={3}>
      <MetricCard
        label="Pending Approval"
        value={formatMetricValue(stats?.pending, isLoading)}
        icon={Clock}
        tone="amber"
        active={activeStatus === "pending"}
        delta={stats ? { dir: "up", label: formatCompactCurrency(stats.amounts.pending) } : undefined}
        onClick={() => onStatusSelect("pending")}
      />
      <MetricCard
        label="Ready to Submit"
        value={formatMetricValue(stats?.approved, isLoading)}
        icon={CheckCircle2}
        tone="cyan"
        active={activeStatus === "approved"}
        delta={stats ? { dir: "up", label: formatCompactCurrency(stats.amounts.approved) } : undefined}
        onClick={() => onStatusSelect("approved")}
      />
      <MetricCard
        label="Open AP Balance"
        value={isLoading ? "--" : formatCompactCurrency(openApBalance)}
        icon={BarChart3}
        tone="violet"
        delta={stats ? { dir: "up", label: `${stats.submitted} submitted this cycle` } : undefined}
      />
    </StatGrid>
  );
}
