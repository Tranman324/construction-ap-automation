import { describe, expect, it } from "vitest";
import type { NotificationRoute } from "@/modules/shared/types/notificationRoute";

describe("notificationRoute types", () => {
  it("accepts the documented notification route contract", () => {
    const route: NotificationRoute = {
      eventTypes: ["invoice.approved"],
      audience: {
        permissions: ["accounting.invoices.approve"],
        roles: ["admin"],
        userIds: ["user_123"],
      },
      channel: "in-app",
      priority: "normal",
    };

    expect(route.eventTypes).toEqual(["invoice.approved"]);
    expect(route.audience.permissions).toEqual(["accounting.invoices.approve"]);
    expect(route.channel).toBe("in-app");
  });
});
