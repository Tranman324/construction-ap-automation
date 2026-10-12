"use client";

import { useEffect } from "react";
import { PlatformMeshBackground } from "@/modules/shared/components/layout/PlatformMeshBackground";
import { SidebarRailPanel } from "@/modules/shared/components/layout/SidebarRailPanel";
import { UtilityBar } from "@/modules/shared/components/layout/UtilityBar";
import { SidebarProvider } from "@/modules/shared/lib/SidebarContext";
import { useAuth } from "@/modules/shared/lib/auth";
import { setDefaultHeader } from "@/modules/shared/lib/api";

interface AppLayoutProps {
  children: React.ReactNode;
  onFilterChange?: (filter: Record<string, unknown>) => void;
}

export default function AppLayout({ children, onFilterChange }: AppLayoutProps) {
  void onFilterChange;

  // Inject user identity headers for backend request scoping
  const { user } = useAuth();
  useEffect(() => {
    if (user?.email) setDefaultHeader("x-user-id", user.email);
    if (user?.name) setDefaultHeader("x-user-name", user.name);
  }, [user?.email, user?.name]);

  return (
    <SidebarProvider>
      <div className="tbx-platform-shell relative flex h-screen overflow-hidden isolate">
        <PlatformMeshBackground />
        <div className="tbx-platform-header-underlay" aria-hidden="true" />
        <SidebarRailPanel />
        <main className="tbx-platform-main relative flex min-w-0 flex-1 flex-col overflow-y-auto">
          <UtilityBar />
          <div className="tbx-platform-content relative flex min-h-0 flex-1 flex-col">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

