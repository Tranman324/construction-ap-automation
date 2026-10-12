import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceSurface", () => ({
  RulesWorkspaceSurface: ({ active }: { active: boolean }) => (
    <div data-active={String(active)}>Embedded rules workspace</div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/settings/DocumentTypesSection", () => ({
  DocumentTypesSection: () => <div>Document types section content</div>,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/useRules", () => ({
  useRules: () => ({
    data: {
      rules: [
        { isActive: true },
        { isActive: false },
        { isActive: true },
      ],
    },
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useClassifications: () => ({
    classifications: [
      { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
      { name: "coi", label: "Certificate of Insurance", opensAs: "coi", action: "view-only", builtIn: true, status: "active" },
      { name: "w9", label: "W-9", opensAs: "w9", action: "view-only", builtIn: true, status: "disabled" },
    ],
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/components/settings/RetentionPoliciesSection", () => ({
  RetentionPoliciesSection: () => (
    <label>
      Retention marker
      <input aria-label="Retention marker" defaultValue="" />
    </label>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/settings/StaleCleanupSection", () => ({
  StaleCleanupSection: () => (
    <label>
      Stale cleanup marker
      <input aria-label="Stale cleanup marker" defaultValue="" />
    </label>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/settings/IgnoreRulesPanel", () => ({
  IgnoreRulesPanel: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Ignore Rules">
        <button type="button" onClick={() => onOpenChange(false)}>
          Close ignore rules
        </button>
      </div>
    ) : null,
}));

import { SettingsPanel } from "@/modules/accounting/modules/invoices/components/settings/SettingsPanel";

describe("SettingsPanel", () => {
  it("renders the centered settings dialog with four left rail sections", () => {
    render(<SettingsPanel open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Settings" })).toHaveTextContent(
      "Invoices · automation and document lifecycle",
    );
    expect(screen.getByRole("button", { name: /Auto-coding Rules/ })).toHaveTextContent("2 active");
    expect(screen.getByRole("button", { name: /Retention Policies/ })).toHaveTextContent("Purge windows");
    expect(screen.getByRole("button", { name: /Stale Cleanup/ })).toHaveTextContent("Pending → discarded");
    expect(screen.getByRole("button", { name: /Document Types/ })).toHaveTextContent("3 mappings");
    expect(screen.getByText("Embedded rules workspace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open workspace" })).not.toBeInTheDocument();
  });

  it("switches sections and keeps retention separate from stale cleanup", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Retention Policies/ }));

    expect(screen.getByText("Retention marker")).toBeVisible();
    expect(screen.getByText("Stale cleanup marker")).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: /Stale Cleanup/ }));

    expect(screen.getByText("Stale cleanup marker")).toBeVisible();
    expect(screen.getByText("Retention marker")).not.toBeVisible();
  });

  it("opens ignore rules as a secondary retention affordance", async () => {
    const user = userEvent.setup();

    render(<SettingsPanel open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Retention Policies/ }));
    await user.click(screen.getByRole("button", { name: /Ignore Rules/ }));

    expect(screen.getByRole("dialog", { name: "Ignore Rules" })).toBeInTheDocument();
  });

  it("preserves section content state while switching rail sections", async () => {
    const user = userEvent.setup();

    render(<SettingsPanel open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Retention Policies/ }));
    await user.type(screen.getByLabelText("Retention marker"), "kept");
    await user.click(screen.getByRole("button", { name: /Stale Cleanup/ }));
    await user.type(screen.getByLabelText("Stale cleanup marker"), "also kept");
    await user.click(screen.getByRole("button", { name: /Auto-coding Rules/ }));
    await user.click(screen.getByRole("button", { name: /Retention Policies/ }));

    expect(screen.getByLabelText("Retention marker")).toHaveValue("kept");
    await user.click(screen.getByRole("button", { name: /Stale Cleanup/ }));
    expect(screen.getByLabelText("Stale cleanup marker")).toHaveValue("also kept");
  });

  it("renders the document types section from the rail", async () => {
    const user = userEvent.setup();

    render(<SettingsPanel open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Document Types/ }));

    expect(screen.getByText("Document types section content")).toBeVisible();
  });

  it("requests close from the footer and Escape key", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<SettingsPanel open onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
