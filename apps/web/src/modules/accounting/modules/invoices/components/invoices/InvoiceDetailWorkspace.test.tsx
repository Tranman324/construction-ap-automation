import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity, BarChart3, Mail, ShieldCheck } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import {
  InvoiceDetailWorkspace,
  type InvoiceDetailTab,
} from "@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailWorkspace";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";

const tabs: InvoiceDetailTab[] = [
  { id: "details", label: "Details", icon: Mail, alert: true },
  { id: "allocation", label: "Allocation", icon: BarChart3 },
  { id: "waiver", label: "Waiver", icon: ShieldCheck },
  { id: "activity", label: "Activity", icon: Activity },
];

function renderWorkspace(
  overrides: Partial<ComponentProps<typeof InvoiceDetailWorkspace>> = {},
) {
  const onTabChange = vi.fn();
  const props: ComponentProps<typeof InvoiceDetailWorkspace> = {
    headerLeading: <span>Larkspur Plumbing Supply</span>,
    headerActions: <button type="button">Next</button>,
    document: <div>Document preview</div>,
    statusStrip: <div>Pending invoice</div>,
    tabs,
    activeTab: "details",
    onTabChange,
    hasUnsavedChanges: false,
    footer: (
      <div>
        <button type="button">Discard</button>
        <button type="button">Approve</button>
      </div>
    ),
    children: <div>Details content</div>,
    ...overrides,
  };

  render(<InvoiceDetailWorkspace {...props} />);
  return { onTabChange };
}

describe("InvoiceDetailWorkspace", () => {
  it("renders the split workspace, tabs, and footer actions", () => {
    renderWorkspace();

    expect(screen.getByText("Larkspur Plumbing Supply")).toBeInTheDocument();
    expect(screen.getByText("Document preview")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /details/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /allocation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveClass(motionStyles.invoiceTabBody);
  });

  it("keeps the approved content regions ordered and reserves the docked tray slot", () => {
    renderWorkspace({ resolveTray: <div>Resolve tray</div> });

    const regions = [
      screen.getByRole("banner"),
      screen.getByText("Pending invoice"),
      screen.getByRole("tablist"),
      screen.getByRole("tabpanel"),
      screen.getByText("Resolve tray"),
      screen.getByRole("contentinfo"),
    ];

    for (let index = 0; index < regions.length - 1; index += 1) {
      expect(regions[index]?.compareDocumentPosition(regions[index + 1]!))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("shows the dirty save note only when the form has edits", () => {
    const { rerender } = render(
      <InvoiceDetailWorkspace
        headerLeading={<span>Invoice</span>}
        document={<div>Document</div>}
        tabs={tabs}
        activeTab="details"
        onTabChange={vi.fn()}
        hasUnsavedChanges={false}
        footer={<button type="button">Approve</button>}
      >
        <div>Details</div>
      </InvoiceDetailWorkspace>,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(
      <InvoiceDetailWorkspace
        headerLeading={<span>Invoice</span>}
        document={<div>Document</div>}
        tabs={tabs}
        activeTab="details"
        onTabChange={vi.fn()}
        hasUnsavedChanges
        footer={<button type="button">Save</button>}
      >
        <div>Details</div>
      </InvoiceDetailWorkspace>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Unsaved corrections");
  });

  it("renders footer accessory content in the expanded semantic footer, not Details", () => {
    renderWorkspace({
      footerAccessory: <div>Footer warning</div>,
    });

    const warning = screen.getByText("Footer warning");
    const footer = screen.getByRole("contentinfo");

    expect(footer).toContainElement(warning);
    expect(footer).toHaveClass("space-y-3", "px-4", "py-3");
    expect(screen.getByRole("tabpanel")).not.toContainElement(warning);
  });

  it("keeps the normal footer compact when no accessory is supplied", () => {
    renderWorkspace();

    expect(screen.getByRole("contentinfo")).toHaveClass("px-4", "py-3");
    expect(screen.getByRole("contentinfo")).not.toHaveClass("space-y-3");
  });

  it("renders panel notices between the status strip and tabs", () => {
    renderWorkspace({
      panelNotice: <div>Spectrum rejected this invoice</div>,
    });

    expect(screen.getByText("Spectrum rejected this invoice")).toBeInTheDocument();
    expect(screen.getByText("Pending invoice").compareDocumentPosition(
      screen.getByText("Spectrum rejected this invoice"),
    )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("Spectrum rejected this invoice").compareDocumentPosition(
      screen.getByRole("tab", { name: /details/i }),
    )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders a supplied full header instead of the legacy header slots", () => {
    renderWorkspace({
      header: <div role="banner">Shared document header</div>,
    });

    expect(screen.getByRole("banner")).toHaveTextContent("Shared document header");
    expect(screen.queryByText("Larkspur Plumbing Supply")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("wires tab callbacks and attention indicators", async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderWorkspace();

    expect(screen.getByLabelText("Details needs attention")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /waiver/i }));

    expect(onTabChange).toHaveBeenCalledWith("waiver");
  });
});
