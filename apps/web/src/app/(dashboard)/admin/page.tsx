"use client";

import { Suspense } from "react";
import { AdminPanel } from "@/modules/platform-admin/components/AdminPanel";
import { AuthGate } from "@/modules/shared/components/AuthGate";

function AdminPageFallback() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-gradient-to-b from-primary/[0.03] via-background to-background">
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="rounded-2xl border border-border/60 bg-gradient-to-r from-primary/[0.08] via-card/95 to-card/85 px-5 py-4 shadow-sm shadow-primary/5 backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              ADMIN PANEL // LOADING
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/90 px-5 py-6 shadow-sm shadow-primary/5 backdrop-blur-sm">
            <div className="h-4 w-40 rounded-full bg-muted/70" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <AuthGate requiredPermissions={["platform.admin"]}>
      <Suspense fallback={<AdminPageFallback />}>
        <AdminPanel />
      </Suspense>
    </AuthGate>
  );
}