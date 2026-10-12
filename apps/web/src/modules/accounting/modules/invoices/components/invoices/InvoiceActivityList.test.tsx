import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  InvoiceActivityList,
  normalizeActivityActor,
} from "@/modules/accounting/modules/invoices/components/invoices/InvoiceActivityList";

describe("InvoiceActivityList", () => {
  it("renders backend actor objects as display names with initials fallback", () => {
    render(
      <InvoiceActivityList
        entries={[
          {
            id: "event-1",
            action: "waiver-override-set",
            actor: { userId: null, name: "Dana Donnelly", role: "controller" },
            createdAt: "2026-07-03T12:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Dana Donnelly").length).toBeGreaterThan(0);
    expect(screen.getByText("(controller)")).toBeInTheDocument();
    expect(screen.getByText("DD")).toBeInTheDocument();
    expect(screen.queryByText("dana@example.com")).not.toBeInTheDocument();
  });

  it("falls back to raw string actors only when no display name is available", () => {
    expect(normalizeActivityActor("dana@example.com")).toMatchObject({
      displayName: "dana@example.com",
      role: null,
    });
  });

  it("prefers an explicit backend avatar URL when the actor provides one", () => {
    expect(
      normalizeActivityActor({
        userId: "azure-user-1",
        name: "Dana Donnelly",
        avatar_url: "/api/backend/users/azure-user-1/photo?size=648x648",
      }),
    ).toMatchObject({
      displayName: "Dana Donnelly",
      avatarUrl: "/api/backend/users/azure-user-1/photo?size=648x648",
    });
  });

  it("binds an identity to the existing photo path when no explicit URL is served", () => {
    expect(normalizeActivityActor({ userId: "azure-user-2", name: "Jordan Tran" })).toMatchObject({
      displayName: "Jordan Tran",
      avatarUrl: "/api/backend/users/azure-user-2/photo",
    });
  });

  it("keeps initials available when an actor has no identity or photo", () => {
    render(
      <InvoiceActivityList
        entries={[{ id: "event-2", action: "flagged", actor: { name: "Jordan Tran" }, createdAt: "invalid" }]}
      />,
    );

    expect(screen.getByText("JT")).toBeInTheDocument();
    expect(normalizeActivityActor({ name: "Jordan Tran" }).avatarUrl).toBeNull();
  });
});
