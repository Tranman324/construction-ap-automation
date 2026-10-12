import { AlertTriangle, LoaderCircle, type LucideIcon } from "lucide-react";

import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/modules/shared/components/ui/card";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";

export type MetricStatus = "ready" | "loading" | "error";

export interface MetricDefinition {
  id: string;
  label: string;
  description: string;
  value: number;
  status: MetricStatus;
  icon: LucideIcon;
  errorMessage?: string;
}

export interface HealthSignal {
  id: string;
  label: string;
  status: MetricStatus;
  readyLabel: string;
}

export function AdminMetricCard({ metric }: { metric: MetricDefinition }) {
  const Icon = metric.icon;

  return (
    <Card
      data-testid={`overview-metric-${metric.id}`}
      className="border-border/60 bg-card/90 p-0 shadow-sm shadow-primary/5"
    >
      <CardHeader className="gap-3 border-b border-border/50 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <CardDescription className="truncate whitespace-nowrap text-xs uppercase tracking-[0.16em] text-muted-foreground">
                {metric.label}
              </CardDescription>
              <AdminFieldHelp label={metric.label} description={metric.description} className="shrink-0" />
            </div>
            <CardTitle className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {metric.status === "ready" ? metric.value.toLocaleString() : null}
              {metric.status === "loading" ? <Skeleton className="h-8 w-20" /> : null}
              {metric.status === "error" ? "Unavailable" : null}
            </CardTitle>
          </div>
          <div className="rounded-full border border-primary/10 bg-primary/[0.07] p-2 text-primary">
            {metric.status === "error" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : metric.status === "loading" ? (
              <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Icon className="h-4 w-4" />
            )}
          </div>
        </div>
      </CardHeader>
      {metric.status === "error" ? (
        <CardContent className="px-4 pb-4 pt-4">
          <p className="text-xs text-amber-700 dark:text-amber-300">{metric.errorMessage}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function HealthPill({ signal }: { signal: HealthSignal }) {
  const colorClass =
    signal.status === "ready"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : signal.status === "loading"
        ? "bg-muted text-muted-foreground"
        : "bg-amber-500/15 text-amber-700 dark:text-amber-300";

  const label =
    signal.status === "ready"
      ? signal.readyLabel
      : signal.status === "loading"
        ? "Loading"
        : "Needs attention";

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/70 px-3 py-3">
      <div>
        <p className="text-sm font-medium text-foreground">{signal.label}</p>
        <p className="text-xs text-muted-foreground">Derived from live admin query state.</p>
      </div>
      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${colorClass}`}>
        {label}
      </span>
    </div>
  );
}