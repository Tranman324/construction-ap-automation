import { describe, expect, it } from "vitest";
import type { ModuleRegistrationConfig, ModuleRegistryAuth } from "@/modules/shared/lib/moduleRegistry.types";

describe("moduleRegistry.types", () => {
  it("accepts auth and registration contracts without widening event catalogs", () => {
    const auth: ModuleRegistryAuth = {
      isAdmin: false,
      permissions: ["projects.view"],
    };
    const registration: ModuleRegistrationConfig = {
      permissions: {
        "projects.view": "View projects",
      },
      events: {
        "project.future_event": {
          label: "Future project event",
          severity: "info",
          targetType: "project",
        },
      },
    };

    expect(auth.permissions).toEqual(["projects.view"]);
    expect(Object.keys(registration.events ?? {})).toEqual(["project.future_event"]);
  });
});
