import { describe, expect, it } from "vitest";
import { FolderKanban, LayoutDashboard, Shield } from "lucide-react";
import type { ModuleRegistryModule } from "@/modules/shared/lib/moduleRegistry.types";
import {
  adminQueryHref,
  adminQueryItem,
  deriveSidebarLiveRouteAccess,
  findModuleByPath,
  findSubmoduleByPath,
  futureItem,
  getVisibleModules,
  liveItem,
  moduleHasAttention,
  placeholderItem,
  resolveDefaultSubmodule,
} from "@/modules/shared/lib/moduleRegistry.utils";

const testRegistry: readonly ModuleRegistryModule[] = [
  {
    id: "projects",
    label: "Projects",
    icon: FolderKanban,
    availability: "live",
    defaultSubmodule: "active",
    permission: "projects.view",
    children: [
      liveItem("active", "Active", FolderKanban, "/projects"),
      liveItem("pending", "Pending", FolderKanban, "/projects/pending", true),
      placeholderItem("projects", "archive", "Archive", FolderKanban),
      futureItem("map", "Map", FolderKanban),
    ],
  },
  {
    id: "admin",
    label: "Admin",
    icon: Shield,
    availability: "live",
    defaultSubmodule: "overview",
    permission: "platform.admin",
    children: [
      adminQueryItem("overview", "Overview", LayoutDashboard),
      adminQueryItem("users", "Users", Shield),
    ],
  },
];

describe("moduleRegistry.utils", () => {
  it("creates live, placeholder, future, and admin query items", () => {
    expect(liveItem("active", "Active", FolderKanban, "/projects")).toMatchObject({
      id: "active",
      href: "/projects",
      routePrefixes: ["/projects"],
      availability: "live",
      attention: false,
    });
    expect(placeholderItem("projects", "archive", "Archive", FolderKanban)).toMatchObject({
      href: "/workspace/projects/archive",
    });
    expect(futureItem("map", "Map", FolderKanban)).toMatchObject({
      availability: "future",
      routePrefixes: [],
    });
    expect(adminQueryHref("users")).toBe("/admin?section=users");
  });

  it("derives live route access from module and child permissions", () => {
    const registry: readonly ModuleRegistryModule[] = [
      {
        id: "projects",
        label: "Projects",
        icon: FolderKanban,
        availability: "live",
        defaultSubmodule: "active",
        permission: "projects.view",
        children: [
          liveItem("active", "Active", FolderKanban, "/projects"),
          { ...liveItem("settings", "Settings", Shield, "/projects/settings"), permission: "platform.admin" },
          futureItem("map", "Map", FolderKanban),
        ],
      },
    ];

    expect(deriveSidebarLiveRouteAccess(registry)).toEqual({
      "/projects": "projects.view",
      "/projects/settings": "platform.admin",
    });
  });

  it("resolves route matches, admin sections, defaults, attention, and visibility", () => {
    expect(findModuleByPath(testRegistry, "/projects/pending/123")?.id).toBe("projects");
    expect(findSubmoduleByPath(testRegistry, "/projects/pending/123")?.id).toBe("pending");
    expect(findSubmoduleByPath(testRegistry, "/admin", "not-real")?.id).toBe("overview");
    expect(resolveDefaultSubmodule(testRegistry, "projects", "archive")).toBe("archive");
    expect(resolveDefaultSubmodule(testRegistry, "projects", "map")).toBe("active");
    expect(moduleHasAttention(testRegistry[0])).toBe(true);

    const visible = getVisibleModules({ isAdmin: false, permissions: [] }, testRegistry);

    expect(visible.map((module) => module.id)).toEqual([]);
  });
});
