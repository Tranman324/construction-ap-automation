"use client";

import { Bell, Menu } from "lucide-react";
import { ThemeToggle } from "@/modules/shared/components/ThemeToggle";
import { Button } from "@/modules/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/modules/shared/components/ui/dropdown-menu";
import { Separator } from "@/modules/shared/components/ui/separator";
import { useSidebar } from "@/modules/shared/lib/SidebarContext";
import { cn } from "@/modules/shared/lib/utils";
import { Breadcrumbs } from "./Breadcrumbs";
import { CommandPalette } from "./CommandPalette";

export interface UtilityBarNotificationItem {
  color: "yellow" | "green" | "purple" | "red" | "violet" | "orange";
  count: number;
  label: string;
}

interface UtilityBarProps {
  breadcrumbs?: string[];
  className?: string;
  notificationBadgeCount?: number;
  notificationItems?: UtilityBarNotificationItem[];
  notificationLabel?: string;
}

const notificationDotClassNames: Record<UtilityBarNotificationItem["color"], string> = {
  green: "bg-emerald-400",
  orange: "bg-orange-400",
  purple: "bg-purple-400",
  red: "bg-red-400",
  violet: "bg-violet-400",
  yellow: "bg-amber-400",
};

export function UtilityBar({
  breadcrumbs,
  className,
  notificationBadgeCount,
  notificationItems,
  notificationLabel = "Notifications",
}: UtilityBarProps) {
  const { isSidebarOpen, toggleSidebar } = useSidebar();
  const showBadge = (notificationBadgeCount ?? 0) > 0;

  return (
    <div
      className={cn(
        "tbx-util sticky top-0 z-20 flex h-14 items-center gap-4 px-3 sm:h-[60px] sm:px-5",
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 lg:hidden"
        onClick={toggleSidebar}
        aria-label={isSidebarOpen ? "Close navigation panel" : "Open navigation panel"}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Breadcrumbs breadcrumbs={breadcrumbs} className="min-w-0 flex-1" />

      <div className="ml-auto flex items-center gap-2.5">
        <CommandPalette />
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <ThemeToggle className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open notifications"
              className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <Bell className="h-4 w-4" />
              {showBadge ? (
                <span
                  data-testid="utility-bar-notification-badge"
                  className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                >
                  {(notificationBadgeCount ?? 0) > 99 ? "99+" : notificationBadgeCount}
                </span>
              ) : (
                <span
                  data-testid="utility-bar-notification-dot"
                  className="tbx-util__dot absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full"
                />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 border-border/70 bg-popover/95 p-1.5 backdrop-blur">
            <DropdownMenuLabel>{notificationLabel}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notificationItems && notificationItems.length > 0 ? (
              notificationItems.map((item) => (
                <DropdownMenuItem key={item.label} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", notificationDotClassNames[item.color])} />
                    <span>{item.label}</span>
                  </span>
                  <span className="tabular-nums text-xs font-semibold text-muted-foreground">{item.count}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground">Shell notifications will appear here.</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}