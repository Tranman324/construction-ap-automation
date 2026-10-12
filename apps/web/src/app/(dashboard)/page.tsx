"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/modules/shared/lib/auth";
import { getDefaultRoute } from "@/modules/shared/lib/moduleAccess";

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      return;
    }

    router.replace(getDefaultRoute({
      isAdmin: user.isAdmin,
      permissions: user.permissions,
    }));
  }, [router, user]);

  return null;
}
