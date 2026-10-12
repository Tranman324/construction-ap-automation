"use client";

import {
  ClipboardList,
  KeyRound,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";

import {
  AdminMetricCard,
  HealthPill,
  type HealthSignal,
  type MetricDefinition,
  type MetricStatus,
} from "@/modules/platform-admin/components/AdminOverviewCards";
import {
  useAdminPermissions,
  useAdminRoles,
  useAdminTitleRules,
  useAdminUsers,
} from "@/modules/platform-admin/hooks/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/modules/shared/components/ui/card";

function getStatus(isLoading: boolean, isError: boolean): MetricStatus {
  if (isError) {
    return "error";
  }

  if (isLoading) {
    return "loading";
  }

  return "ready";
}

function getErrorMessage(error: Error | null): string {
  return error?.message?.trim() || "This metric is temporarily unavailable.";
}

function countRegisteredPermissions(groups: Record<string, { key: string }[]> | undefined): number {
  return Object.values(groups ?? {}).flat().length;
}

export function AdminOverview() {
  const usersQuery = useAdminUsers();
  const rolesQuery = useAdminRoles();
  const permissionsQuery = useAdminPermissions();
  const titleRulesQuery = useAdminTitleRules();

  const userStatus = getStatus(usersQuery.isLoading, usersQuery.isError);
  const roleStatus = getStatus(rolesQuery.isLoading, rolesQuery.isError);
  const permissionStatus = getStatus(permissionsQuery.isLoading, permissionsQuery.isError);
  const titleRuleStatus = getStatus(titleRulesQuery.isLoading, titleRulesQuery.isError);

  const metrics: MetricDefinition[] = [
    {
      id: "total-users",
      label: "Total users",
      description: "All directory users currently synced into the platform access model.",
      value: usersQuery.data?.length ?? 0,
      status: userStatus,
      icon: Users,
      errorMessage: getErrorMessage(usersQuery.error),
    },
    {
      id: "active-users",
      label: "Active users",
      description: "Accounts that can still sign in and receive role-based access.",
      value: usersQuery.data?.filter((user) => user.is_active).length ?? 0,
      status: userStatus,
      icon: UserCheck,
      errorMessage: getErrorMessage(usersQuery.error),
    },
    {
      id: "roles",
      label: "Roles",
      description: "Baseline access profiles available for assignment and title rule matching.",
      value: rolesQuery.data?.length ?? 0,
      status: roleStatus,
      icon: ShieldCheck,
      errorMessage: getErrorMessage(rolesQuery.error),
    },
    {
      id: "registered-permissions",
      label: "Permissions",
      description: "Grouped permission keys currently exposed by the backend permission registry.",
      value: countRegisteredPermissions(permissionsQuery.data),
      status: permissionStatus,
      icon: KeyRound,
      errorMessage: getErrorMessage(permissionsQuery.error),
    },
    {
      id: "active-title-rules",
      label: "Active rules",
      description: "Job-title automation rules still participating in role assignment decisions.",
      value: titleRulesQuery.data?.filter((rule) => rule.is_active).length ?? 0,
      status: titleRuleStatus,
      icon: ClipboardList,
      errorMessage: getErrorMessage(titleRulesQuery.error),
    },
  ];

  const healthSignals: HealthSignal[] = [
    { id: "directory", label: "Directory sync", status: userStatus, readyLabel: "User inventory ready" },
    { id: "roles", label: "Role catalog", status: roleStatus, readyLabel: "Role inventory ready" },
    {
      id: "permissions",
      label: "Permission registry",
      status: permissionStatus,
      readyLabel: "Permission groups ready",
    },
    {
      id: "title-rules",
      label: "Title rules",
      status: titleRuleStatus,
      readyLabel: "Assignment automation ready",
    },
  ];

  return (
    <section data-testid="admin-section-overview" className="space-y-4">
      <div data-testid="overview-metric-grid" className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {metrics.map((metric, index) => (
          <div
            key={metric.id}
            data-testid={`overview-metric-slot-${metric.id}`}
            className={index === metrics.length - 1 ? "hidden md:block" : undefined}
          >
            <AdminMetricCard metric={metric} />
          </div>
        ))}
      </div>
      <Card className="border-border/60 bg-card/90 shadow-sm shadow-primary/5">
        <CardHeader className="gap-2 border-b border-border/50 px-5 py-4">
          <CardTitle className="text-base text-foreground">Operational health</CardTitle>
          <CardDescription>
            Query-backed readiness signals for the admin surfaces already online in this route.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-5 py-4 md:grid-cols-2">
          {healthSignals.map((signal) => (
            <HealthPill key={signal.id} signal={signal} />
          ))}
        </CardContent>
      </Card>
    </section>
  );
}