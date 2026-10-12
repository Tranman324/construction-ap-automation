"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { LogoMark } from "@/modules/shared/components/LogoMark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/modules/shared/components/ui/dropdown-menu";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/shared/components/ui/tooltip";
import { cn } from "@/modules/shared/lib/utils";
import { moduleHasAttention, type ResolvedModuleRegistryModule } from "@/modules/shared/lib/moduleRegistry";
import { getActiveRailModuleId, getRailModuleHref, getUserInitials } from "./sidebarRail.utils";

export interface SidebarRailUser {
  name: string;
  email?: string | null;
  position?: string | null;
  image?: string | null;
}

export interface SidebarRailProps {
  modules: readonly ResolvedModuleRegistryModule[];
  pathname: string;
  activeModuleId?: string;
  user?: SidebarRailUser | null;
  isLoading?: boolean;
  onBrandClick?: () => void;
  onModuleSelect?: (moduleId: string) => void;
  onSignOut?: () => void | Promise<void>;
  getModuleHref?: (module: ResolvedModuleRegistryModule) => string | undefined;
  brandTooltip?: string;
}

function SidebarRailSkeleton() {
  return (
    <aside className="tbx-v3__rail" aria-label="Loading navigation rail">
      <Skeleton className="tbx-v3__rail-brand-skeleton" />
      <div className="tbx-v3__rail-list">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="tbx-v3__rail-btn-skeleton" />
        ))}
      </div>
      <div className="tbx-v3__rail-foot">
        <Skeleton className="tbx-v3__rail-avatar-skeleton" />
      </div>
    </aside>
  );
}

function getRailItemClass(isActive: boolean, isDisabled: boolean): string {
  return cn(
    "tbx-v3__rail-btn group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
    isActive && "is-active",
    isDisabled && "is-disabled",
  );
}

function getTooltipContent(module: ResolvedModuleRegistryModule): ReactNode {
  return (
    <div className="space-y-0.5">
      <p className="font-semibold">{module.label}</p>
      {module.visibility === "disabled-future" ? <p className="text-[11px] text-background/75">Coming soon</p> : null}
    </div>
  );
}

export function SidebarRail({
  modules,
  pathname,
  activeModuleId: activeModuleIdOverride,
  user,
  isLoading = false,
  onBrandClick,
  onModuleSelect,
  onSignOut,
  getModuleHref,
  brandTooltip = "Toolbox",
}: SidebarRailProps) {
  if (isLoading) {
    return <SidebarRailSkeleton />;
  }

  const activeModuleId = activeModuleIdOverride ?? getActiveRailModuleId(pathname);
  const userInitials = getUserInitials(user?.name);
  const userName = user?.name ?? "Unknown user";
  const userSubtitle = user?.position ?? user?.email ?? "User profile";

  return (
    <aside className="tbx-v3__rail">
      <Tooltip>
        <TooltipTrigger asChild>
          {onBrandClick ? (
            <button
              type="button"
              onClick={onBrandClick}
              aria-label={brandTooltip}
              className="tbx-v3__rail-brand"
            >
              <LogoMark className="tbx-v3__mark" />
            </button>
          ) : (
            <div
              aria-label={brandTooltip}
              className="tbx-v3__rail-brand"
            >
              <LogoMark className="tbx-v3__mark" />
            </div>
          )}
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {brandTooltip}
        </TooltipContent>
      </Tooltip>

      <nav aria-label="Primary navigation rail" className="tbx-v3__rail-list">
        {modules.map((module) => {
          const href = getModuleHref ? getModuleHref(module) : getRailModuleHref(module);
          const isActive = activeModuleId === module.id;
          const isDisabled = !href;
          const Icon = module.icon;

          return (
            <Tooltip key={module.id}>
              <TooltipTrigger asChild>
                {href && !onModuleSelect ? (
                  <Link
                    href={href}
                    aria-label={module.label}
                    aria-current={isActive ? "page" : undefined}
                    data-active={isActive ? "true" : undefined}
                    data-visibility={module.visibility}
                    className={getRailItemClass(isActive, false)}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    {moduleHasAttention(module) ? (
                      <span
                        aria-label={`${module.label} needs attention`}
                        className="tbx-v3__rail-attn"
                      />
                    ) : null}
                  </Link>
                ) : (
                  <button
                    type="button"
                    aria-label={module.label}
                    aria-disabled={isDisabled ? "true" : undefined}
                    data-visibility={module.visibility}
                    className={getRailItemClass(isActive, isDisabled)}
                    disabled={isDisabled}
                    onClick={() => {
                      if (!isDisabled) {
                        onModuleSelect?.(module.id);
                      }
                    }}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    {moduleHasAttention(module) ? (
                      <span
                        aria-label={`${module.label} needs attention`}
                        className="tbx-v3__rail-attn"
                      />
                    ) : null}
                  </button>
                )}
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {getTooltipContent(module)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <div className="tbx-v3__rail-foot">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {user?.image ? (
              <button type="button" className="tbx-v3__rail-avatar" aria-label="Open user settings menu">
                <img src={user.image} alt="" className="tbx-v3__rail-avatar-image" aria-hidden="true" />
              </button>
            ) : (
              <button type="button" aria-label="Open user settings menu" className="tbx-v3__rail-avatar">
                {userInitials}
              </button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" sideOffset={10} className="w-56 border-border/70 bg-popover/95 p-1.5 backdrop-blur">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-semibold text-foreground">{userName}</p>
              <p className="text-xs text-muted-foreground">{userSubtitle}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!onSignOut}
              onSelect={() => {
                void onSignOut?.();
              }}
              className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}