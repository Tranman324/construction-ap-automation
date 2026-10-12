"use client";

import "@/modules/feature-requests/register";
import "@/modules/accounting/register";
import "@/modules/platform-admin/register";
import "@/modules/projects/register";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import AppLayout from "@/modules/shared/components/layout/AppLayout";
import { useAuth } from "@/modules/shared/lib/auth";
import { canAccessRoute, getDefaultRoute } from "@/modules/shared/lib/moduleAccess";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      return;
    }

    const routeAuth = {
      isAdmin: user.isAdmin,
      permissions: user.permissions,
    };

    if (canAccessRoute(routeAuth, pathname)) {
      return;
    }

    const fallbackRoute = getDefaultRoute(routeAuth);

    if (fallbackRoute !== pathname) {
      router.replace(fallbackRoute);
    }
  }, [user, pathname, router]);

  return <AppLayout>{children}</AppLayout>;
}
