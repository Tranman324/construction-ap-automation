"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ADMIN_SECTION_QUERY_PARAM } from "@/modules/shared/lib/adminNavigation";
import { SidebarPanel } from "@/modules/shared/components/layout/SidebarPanel";
import { SidebarRail } from "@/modules/shared/components/layout/SidebarRail";
import { useAuth } from "@/modules/shared/lib/auth";
import { useSidebar } from "@/modules/shared/lib/SidebarContext";
import {
  findModuleByPath,
  findSubmoduleByPath,
  getSubmoduleRoute,
  getVisibleModules,
  resolveDefaultSubmodule,
  type ResolvedModuleRegistryModule,
} from "@/modules/shared/lib/moduleRegistry";
import styles from "./SidebarRailPanel.module.css";

const MOBILE_BREAKPOINT = 1024;
const PANEL_PINNED_KEY = "tbx-panel-pinned";
const MODULE_DEFAULTS_KEY = "tbx-module-defaults";

interface ModuleDefaults {
  [moduleId: string]: string;
}

function readPanelPinned(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(PANEL_PINNED_KEY) === "true";
  } catch {
    return false;
  }
}

function readModuleDefaults(): ModuleDefaults {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(MODULE_DEFAULTS_KEY);

    if (!rawValue) {
      return {};
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsedValue).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function writePanelPinned(isPinned: boolean) {
  try {
    window.localStorage.setItem(PANEL_PINNED_KEY, String(isPinned));
  } catch {}
}

function writeModuleDefaults(moduleDefaults: ModuleDefaults) {
  try {
    window.localStorage.setItem(MODULE_DEFAULTS_KEY, JSON.stringify(moduleDefaults));
  } catch {}
}

function getModuleHref(module: ResolvedModuleRegistryModule, moduleDefaults: ModuleDefaults): string | undefined {
  const defaultSubmoduleId = resolveDefaultSubmodule(module.id, moduleDefaults[module.id] ?? module.defaultSubmodule);
  const preferredChild = defaultSubmoduleId
    ? module.children.find((child) => child.id === defaultSubmoduleId && child.visibility === "live" && child.href)
    : undefined;
  const fallbackChild = module.children.find((child) => child.visibility === "live" && child.href);

  return preferredChild?.href ?? fallbackChild?.href ?? (defaultSubmoduleId ? getSubmoduleRoute(module.id, defaultSubmoduleId) : undefined);
}

function SidebarRailPanelContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isLoading, signOut } = useAuth();
  const { isSidebarOpen, setSidebarOpen } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);
  const [isPinned, setIsPinned] = useState(() => readPanelPinned());
  const [moduleDefaults, setModuleDefaults] = useState<ModuleDefaults>(() => readModuleDefaults());
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function syncViewport() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }

    syncViewport();
    window.addEventListener("resize", syncViewport);

    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    if (!isSidebarOpen || isPinned) {
      return;
    }

    function collapseOnOutsidePointer(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node) || shellRef.current?.contains(target)) {
        return;
      }

      setSidebarOpen(false);
    }

    document.addEventListener("pointerdown", collapseOnOutsidePointer);

    return () => document.removeEventListener("pointerdown", collapseOnOutsidePointer);
  }, [isPinned, isSidebarOpen, setSidebarOpen]);

  const visibleModules = getVisibleModules({
    isAdmin: user?.isAdmin ?? false,
    permissions: user?.permissions ?? [],
  });
  const routeModuleId = findModuleByPath(pathname)?.id;
  const activeModule = routeModuleId ? visibleModules.find((module) => module.id === routeModuleId) : undefined;
  const activeSubmoduleId = activeModule
    ? findSubmoduleByPath(
        pathname,
        activeModule.id === "admin" ? searchParams.get(ADMIN_SECTION_QUERY_PARAM) : undefined,
      )?.id
    : undefined;
  const panelUser = user
    ? {
        email: user.email,
        image: user.image,
        name: user.name,
        position: user.position,
        role: user.role,
      }
    : {
        email: "",
        image: null,
        name: "Unknown user",
        position: null,
        role: "",
      };
  const shouldRenderSkeleton = isLoading;
  const shouldShowMobileShell = isMobile && (isSidebarOpen || shouldRenderSkeleton);
  const shouldShowPanel = Boolean(activeModule) && (isSidebarOpen || shouldRenderSkeleton);

  const panel = activeModule && shouldShowPanel && !shouldRenderSkeleton ? (
    <SidebarPanel
      module={activeModule}
      activeSubmoduleId={activeSubmoduleId}
      currentDefaultSubmoduleId={moduleDefaults[activeModule.id]}
      isPinned={isPinned}
      user={panelUser}
      onTogglePinned={handleTogglePinned}
      onNavigateSubmodule={handleNavigateSubmodule}
      onSetDefaultSubmodule={handleSetDefaultSubmodule}
    />
  ) : null;

  function handleModuleSelect(moduleId: string) {
    const selectedModule = visibleModules.find((item) => item.id === moduleId);

    if (!selectedModule || selectedModule.visibility !== "live") {
      return;
    }

    if (activeModule?.id === moduleId) {
      setSidebarOpen(!isSidebarOpen);
      return;
    }

    const href = getModuleHref(selectedModule, moduleDefaults);

    if (href) {
      router.push(href);
    }
  }

  function handleBrandClick() {
    if (activeModule) {
      setSidebarOpen(!isSidebarOpen);
      return;
    }

    const firstLiveModule = visibleModules.find((module) => module.visibility === "live");
    const href = firstLiveModule ? getModuleHref(firstLiveModule, moduleDefaults) : undefined;

    if (href) {
      setSidebarOpen(true);
      router.push(href);
    }
  }

  function handleTogglePinned() {
    setIsPinned((currentPinned) => {
      const nextPinned = !currentPinned;

      writePanelPinned(nextPinned);

      if (nextPinned) {
        setSidebarOpen(true);
      }

      return nextPinned;
    });
  }

  function handleSetDefaultSubmodule(moduleId: string, submoduleId: string) {
    setModuleDefaults((currentDefaults) => {
      const resolvedSubmoduleId = resolveDefaultSubmodule(moduleId, submoduleId);

      if (!resolvedSubmoduleId) {
        return currentDefaults;
      }

      const nextDefaults = { ...currentDefaults, [moduleId]: resolvedSubmoduleId };
      writeModuleDefaults(nextDefaults);
      return nextDefaults;
    });
  }

  function handleNavigateSubmodule(moduleId: string, submoduleId: string, href: string) {
    void moduleId;
    void submoduleId;
    router.push(href);

    if (!isPinned) {
      setSidebarOpen(false);
    }
  }

  return (
    <>
      {isMobile && isSidebarOpen && panel ? (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div ref={shellRef} className={[styles.root, "tbx-v3", panel ? "is-open" : "is-collapsed", isMobile ? "tbx-v3--mobile" : ""].join(" ")}>
        <div className="tbx-v3__rail-slot">
          <SidebarRail
            modules={visibleModules}
            pathname={pathname}
            activeModuleId={activeModule?.id}
            user={user ? { email: user.email, image: user.image, name: user.name, position: user.position } : null}
            isLoading={shouldRenderSkeleton}
            onBrandClick={handleBrandClick}
            brandTooltip={activeModule && isSidebarOpen ? "Collapse Toolbox panel" : "Expand Toolbox panel"}
            onModuleSelect={handleModuleSelect}
            onSignOut={signOut}
            getModuleHref={(module) => getModuleHref(module, moduleDefaults)}
          />
        </div>

        {panel ? (
          <div
            className={[
              "tbx-v3__panel-slot transition-transform duration-200",
              isMobile
                ? [
                    "fixed inset-y-2 left-[72px] z-50",
                    shouldShowMobileShell ? "translate-x-0" : "-translate-x-full",
                  ].join(" ")
                : "relative flex h-full",
            ].join(" ")}
          >
            {panel}
          </div>
        ) : null}
      </div>
    </>
  );
}

export function SidebarRailPanel() {
  return (
    <Suspense fallback={null}>
      <SidebarRailPanelContent />
    </Suspense>
  );
}
