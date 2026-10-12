"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ADMIN_SECTION_QUERY_PARAM } from "@/modules/shared/lib/adminNavigation";
import { useAuth } from "@/modules/shared/lib/auth";
import { findModuleByPath, findSubmoduleByPath, getVisibleModules, type ResolvedModuleRegistryModule } from "@/modules/shared/lib/moduleRegistry";
import { cn } from "@/modules/shared/lib/utils";

export interface BreadcrumbItem {
  href?: string;
  isCurrent: boolean;
  label: string;
}

interface BreadcrumbsProps {
  breadcrumbs?: string[];
  className?: string;
}

function isSafeHref(href?: string): href is string {
  return typeof href === "string" && !href.startsWith("/workspace/");
}

function getModuleHref(module: ResolvedModuleRegistryModule): string | undefined {
  const defaultChild = module.children.find(
    (child) => child.id === module.defaultSubmodule && child.visibility === "live" && isSafeHref(child.href),
  );

  if (defaultChild?.href) {
    return defaultChild.href;
  }

  return module.children.find((child) => child.visibility === "live" && isSafeHref(child.href))?.href;
}

function getToolboxHref(modules: readonly ResolvedModuleRegistryModule[]): string | undefined {
  return modules.map((module) => getModuleHref(module)).find((href): href is string => Boolean(href));
}

export function buildBreadcrumbItems(
  pathname: string,
  visibleModules: readonly ResolvedModuleRegistryModule[],
  breadcrumbs?: string[],
  adminSectionValue?: string | null,
): BreadcrumbItem[] {
  if (breadcrumbs && breadcrumbs.length > 0) {
    return breadcrumbs.map((label, index) => ({
      isCurrent: index === breadcrumbs.length - 1,
      label,
    }));
  }

  const moduleMatch = visibleModules.find((module) => module.id === findModuleByPath(pathname)?.id);

  if (!moduleMatch) {
    return [{ isCurrent: true, label: "Toolbox" }];
  }

  const submoduleMatch = moduleMatch.children.find((child) => child.id === findSubmoduleByPath(pathname, adminSectionValue)?.id);
  const items: BreadcrumbItem[] = [
    {
      href: getToolboxHref(visibleModules),
      isCurrent: false,
      label: "Toolbox",
    },
    {
      href: getModuleHref(moduleMatch),
      isCurrent: !submoduleMatch,
      label: moduleMatch.label,
    },
  ];

  if (submoduleMatch) {
    items.push({
      href: isSafeHref(submoduleMatch.href) ? submoduleMatch.href : undefined,
      isCurrent: true,
      label: submoduleMatch.label,
    });
  }

  return items.map((item, index) => ({
    ...item,
    href: index === items.length - 1 ? undefined : item.href,
    isCurrent: index === items.length - 1,
  }));
}

export function buildCompactBreadcrumbItems(items: readonly BreadcrumbItem[]): BreadcrumbItem[] {
  if (items.length <= 2) {
    return [...items];
  }

  const firstItem = items[0];
  const lastItem = items[items.length - 1];

  return firstItem.label === lastItem.label ? [lastItem] : [firstItem, lastItem];
}

function BreadcrumbsResolved({ breadcrumbs, className }: BreadcrumbsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  const items = useMemo(
    () =>
      buildBreadcrumbItems(
        pathname,
        getVisibleModules({
          isAdmin: user?.isAdmin ?? false,
          permissions: user?.permissions ?? [],
        }),
        breadcrumbs,
        searchParams.get(ADMIN_SECTION_QUERY_PARAM),
      ),
    [breadcrumbs, pathname, searchParams, user?.isAdmin, user?.permissions],
  );
  const compactItems = useMemo(() => buildCompactBreadcrumbItems(items), [items]);

  function renderTrail(trail: readonly BreadcrumbItem[]) {
    return trail.map((item, index) => (
      <div key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-2">
        {index > 0 ? <span className="text-muted-foreground/60">/</span> : null}
        {item.href && !item.isCurrent ? (
          <button
            type="button"
            className="max-w-[9rem] truncate text-left text-muted-foreground transition-colors hover:text-foreground sm:max-w-[12rem]"
            onClick={() => router.push(item.href!)}
          >
            {item.label}
          </button>
        ) : (
          <span
            aria-current={item.isCurrent ? "page" : undefined}
            className={cn(
              "max-w-[9rem] truncate sm:max-w-[12rem]",
              item.isCurrent ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {item.label}
          </span>
        )}
      </div>
    ));
  }

  return (
    <nav aria-label="Breadcrumbs" className={cn("min-w-0", className)}>
      <div data-testid="breadcrumbs-mobile" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground sm:hidden">
        {renderTrail(compactItems)}
      </div>
      <div data-testid="breadcrumbs-desktop" className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground sm:flex lg:text-[15px]">
        {renderTrail(items)}
      </div>
    </nav>
  );
}

export function Breadcrumbs(props: BreadcrumbsProps) {
  return (
    <Suspense fallback={<nav aria-label="Breadcrumbs" className={cn("min-w-0", props.className)} />}>
      <BreadcrumbsResolved {...props} />
    </Suspense>
  );
}
