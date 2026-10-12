import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDocumentPanelRouteSpecs } from "@/modules/accounting/modules/invoices/components/documents/documentPanelRouteSpecs";
import { makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const permissionMock = vi.hoisted(() => ({ hasPermission: vi.fn(() => true) }));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: permissionMock.hasPermission }),
}));

function makeRecord(): Invoice {
  return {
    id: "doc-1",
    classification: "lien-waiver",
    confidence: 0.9,
    file: "waiver.pdf",
    email: {
      from: "vendor@example.com",
      subject: "Lien waiver",
      receivedAt: "2026-06-14T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-14T12:00:00.000Z",
    extracted: null,
    matching: null,
    overallConfidence: 0.9,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

describe("useDocumentPanelRouteSpecs", () => {
  it("assembles dedicated specs and binds route discard navigation to the current record", () => {
    const record = makeRecord();
    const onDiscard = vi.fn();
    const { Wrapper } = makeMutationWrapper();

    const { result } = renderHook(() => useDocumentPanelRouteSpecs({
      record,
      onDiscard,
    }), { wrapper: Wrapper });

    expect(result.current.lienWaiverSpec.classifications).toEqual(["lien-waiver"]);
    expect(result.current.simpleFilingSpec.id).toBe("simple-filing-document");
    expect(permissionMock.hasPermission).toHaveBeenCalledWith("accounting.invoices.coi_override");
    expect(permissionMock.hasPermission).toHaveBeenCalledWith("accounting.invoices.approve");

    act(() => result.current.panelNavigation.onDiscard?.());
    expect(onDiscard).toHaveBeenCalledWith(record);
  });
});
