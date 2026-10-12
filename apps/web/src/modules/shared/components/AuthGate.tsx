"use client";

import type { PermissionKey } from "@/modules/shared/types/permissions";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";
import { useAuth } from "@/modules/shared/lib/auth";

// TODO Task 5.2: Replace isAuthenticated check with NextAuth middleware
// (this component becomes unused once middleware-level auth is in place)

interface AuthGateProps {
  children: React.ReactNode;
  requiredPermissions?: PermissionKey[];
  mode?: "any" | "all";
}

function AccessRestricted({ signIn }: { signIn: () => Promise<void> }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-muted-foreground text-sm">Access restricted.</p>
      <button
        onClick={() => {
          void signIn();
        }}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
      >
        Sign In
      </button>
    </div>
  );
}

export function AuthGate({
  children,
  requiredPermissions,
  mode = "all",
}: AuthGateProps) {
  const { isLoading, isAuthenticated, signIn } = useAuth();
  const { hasAnyPermission, hasAllPermissions } = usePermissions();
  const hasPermissionRequirements = (requiredPermissions?.length ?? 0) > 0;
  const hasRequiredPermissions = !hasPermissionRequirements
    || (mode === "all"
      ? hasAllPermissions(requiredPermissions ?? [])
      : hasAnyPermission(requiredPermissions ?? []));

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated || !hasRequiredPermissions) {
    return <AccessRestricted signIn={signIn} />;
  }

  return <>{children}</>;
}
