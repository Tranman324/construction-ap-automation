"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/modules/shared/lib/auth";
import { getVisibleModules } from "@/modules/shared/lib/moduleRegistry";
import { cn } from "@/modules/shared/lib/utils";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/modules/shared/components/ui/command";

interface CommandPaletteItem {
  disabled: boolean;
  href?: string;
  id: string;
  label: string;
  moduleId: string;
  moduleLabel: string;
  searchText: string;
  statusLabel: string;
  Icon: React.ComponentType<{ className?: string }>;
}

interface CommandPaletteGroup {
  items: CommandPaletteItem[];
  label: string;
  moduleId: string;
}

function isNavigableHref(href?: string): href is string {
  return typeof href === "string" && !href.startsWith("/workspace/");
}

function buildCommandGroups(
  permissions: readonly string[],
  isAdmin: boolean,
  query: string,
): CommandPaletteGroup[] {
  const normalizedQuery = query.trim().toLowerCase();

  return getVisibleModules({ isAdmin, permissions: [...permissions] })
    .map((module) => {
      const items = module.children
        .filter((child) => child.visibility !== "hidden-by-permission")
        .map<CommandPaletteItem>((child) => {
          const isNavigable = child.visibility === "live" && isNavigableHref(child.href);

          return {
            disabled: !isNavigable,
            href: isNavigable ? child.href : undefined,
            Icon: child.icon,
            id: child.id,
            label: child.label,
            moduleId: module.id,
            moduleLabel: module.label,
            searchText: `${module.label} ${child.label} ${child.href ?? ""}`.toLowerCase(),
            statusLabel: isNavigable ? child.href ?? "" : "Coming Soon",
          };
        })
        .filter((item) => (normalizedQuery ? item.searchText.includes(normalizedQuery) : true));

      return {
        items,
        label: module.label,
        moduleId: module.id,
      };
    })
    .filter((group) => group.items.length > 0);
}

export function CommandPalette() {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const groups = useMemo(
    () => buildCommandGroups(user?.permissions ?? [], user?.isAdmin ?? false, deferredQuery),
    [deferredQuery, user?.isAdmin, user?.permissions],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);

    if (!nextOpen) {
      setQuery("");
    }
  }

  function handleSelect(href: string) {
    handleOpenChange(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Open command palette"
        className="tbx-util__search flex h-10 min-w-[11rem] items-center gap-2.5 rounded-xl border border-border/80 bg-muted/40 px-4 text-sm text-muted-foreground shadow-sm shadow-primary/5 transition-[background-color,border-color,color] hover:border-primary/30 hover:bg-muted/60 hover:text-foreground sm:min-w-[16rem] lg:min-w-[22rem]"
        data-testid="command-palette-trigger"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="truncate text-left">Search pages...</span>
        <kbd className="ml-auto hidden rounded-md bg-muted/70 px-2 py-1 font-mono text-[11px] text-muted-foreground sm:inline-flex">⌘K</kbd>
      </button>

      <CommandDialog
        className="top-0 left-0 max-h-[100dvh] max-w-none translate-x-0 translate-y-0 rounded-none border-x-0 border-t-0 p-0 sm:top-[18%] sm:left-1/2 sm:max-w-2xl sm:-translate-x-1/2 sm:translate-y-0 sm:rounded-xl sm:border sm:border-border"
        description="Search the Toolbox module registry"
        open={open}
        onOpenChange={handleOpenChange}
        showCloseButton={false}
        title="Search pages"
      >
        <CommandInput placeholder="Search pages..." value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[70vh] px-2 py-3">
          <CommandEmpty>No matching pages found.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.moduleId} heading={group.label}>
              {group.items.map((item) => (
                <CommandItem
                  key={`${item.moduleId}-${item.id}`}
                  data-testid={`command-item-${item.moduleId}-${item.id}`}
                  disabled={item.disabled}
                  onSelect={() => {
                    if (item.href) {
                      handleSelect(item.href);
                    }
                  }}
                  value={item.searchText}
                  className="gap-3 rounded-lg px-3 py-2.5 data-[selected=true]:bg-primary/10"
                >
                  <item.Icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium text-foreground">{item.label}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{item.moduleLabel}</span>
                  </div>
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium",
                      item.disabled ? "bg-muted text-muted-foreground" : "text-muted-foreground",
                    )}
                  >
                    {item.statusLabel}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}