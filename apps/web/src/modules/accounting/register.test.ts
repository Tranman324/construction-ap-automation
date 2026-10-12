import { beforeEach, describe, expect, it, vi } from "vitest";

const EXPECTED_ACCOUNTING_PERMISSIONS = [
  "accounting.invoices.view",
  "accounting.invoices.view_details",
  "accounting.invoices.approve",
  "accounting.invoices.reject",
  "accounting.invoices.delete",
  "accounting.invoices.manage_retention",
  "accounting.invoices.manage_splits",
  "accounting.invoices.export",
  "accounting.invoices.submit_spectrum",
  "accounting.invoices.request_waiver",
  "accounting.invoices.coi_override",
  "accounting.invoices.manage_settings",
] as const;

function sortValues(values: readonly string[]): string[] {
  return [...values].sort();
}

beforeEach(() => {
  vi.resetModules();
});

describe("accounting registration", () => {
  it("registers child invoice permissions and events under the accounting module", async () => {
    await import("@/modules/accounting/register");
    const { getModuleEventTypes } = await import("@/modules/shared/lib/eventRegistry");
    const { getModulePermissions } = await import("@/modules/shared/lib/permissionRegistry");

    expect(sortValues(getModulePermissions("accounting") ?? [])).toEqual(
      sortValues(EXPECTED_ACCOUNTING_PERMISSIONS),
    );
    expect(getModuleEventTypes("accounting")).toContain("invoice.approved");
  });
});
