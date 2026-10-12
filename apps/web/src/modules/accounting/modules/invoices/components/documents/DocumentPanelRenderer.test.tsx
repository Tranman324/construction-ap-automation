import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText, Scissors } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { DocumentPanelRenderer } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelRenderer";
import { createW9DocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentSpec";
import { requestCollaborationCompose } from "@/modules/accounting/modules/invoices/components/activity/ActivityPanel";
import type { DocumentSpecOutput } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";

const output: DocumentSpecOutput = {
  header: {
    kindLabel: "Document",
    title: "Submittal.pdf",
    statusLabel: "Pending",
    statusTone: "warn",
  },
  preferredRenderer: "tabs",
  tabs: [
    { id: "summary", label: "Summary", icon: FileText },
    { id: "workflow", label: "Workflow" },
  ],
  alerts: [{ id: "route", tabId: "workflow", tone: "warn", label: "Needs routing" }],
  sections: [
    { id: "summary", title: "Summary", tabId: "summary", children: "Summary body" },
    { id: "workflow", title: "Workflow", tabId: "workflow", flagged: true, children: "Workflow body" },
  ],
  primaryAction: { id: "file-to-shelf", label: "Shelve", onClick: vi.fn() },
};

describe("DocumentPanelRenderer", () => {
  it("renders the inactive activity surface without auth or query providers", () => {
    expect(() => render(<DocumentPanelRenderer documentId="doc-1" output={output} actions={[{ id: "archive", label: "Archive", onClick: vi.fn() }]} auditEntries={[]} />)).not.toThrow();
  });

  it("keeps generic document tabs on their compact rounded treatment", () => {
    render(<DocumentPanelRenderer output={output} />);

    const tablist = screen.getByRole("tablist");
    const summary = screen.getByRole("tab", { name: /Summary/i });

    expect(tablist).toHaveClass("gap-1");
    expect(tablist).not.toHaveClass("bg-card", "pt-2");
    expect(summary).toHaveClass("h-8", "rounded-md", "bg-background", "shadow-sm");
    expect(summary).not.toHaveClass("h-10", "border-b-2", "border-primary");
  });

  it("renders each alert once in the docked tray, tabbed sections, and footer actions", () => {
    render(
      <DocumentPanelRenderer
        output={output}
        email={{
          from: "sender@example.com",
          subject: "Attached documents",
          receivedAt: "2026-06-01T12:00:00.000Z",
          bodyPreview: "Documents attached.",
        }}
      />,
    );

    expect(screen.getAllByText("Needs routing")).toHaveLength(1);
    expect(screen.getByTestId("document-resolve-tray")).toBeInTheDocument();
    expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent("To resolve 1");
    expect(screen.getByText("sender@example.com")).toBeInTheDocument();
    expect(screen.getByText("Attached documents")).toBeInTheDocument();
    expect(screen.getByText("Summary body")).toBeInTheDocument();
    expect(screen.getByText("Summary body")).toBeVisible();
    expect(screen.getByText("Workflow body")).not.toBeVisible();
    expect(document.getElementById("document-tabpanel-panel-workflow")).toHaveClass("hidden");
    expect(document.getElementById("document-tabpanel-panel-summary")).toHaveClass(motionStyles.documentTabBody);
    expect(screen.getByLabelText("1 workflow issue")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("tab", { name: /Workflow/i }));

    expect(screen.getByText("Workflow body")).toBeInTheDocument();
    expect(screen.getByText("Workflow body")).toBeVisible();
    expect(screen.getByText("Summary body")).not.toBeVisible();
    expect(document.getElementById("document-tabpanel-panel-summary")).toHaveClass("hidden");
    expect(document.getElementById("document-tabpanel-panel-workflow")).toHaveClass(motionStyles.documentTabBody);
    expect(screen.getByText("sender@example.com")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Shelve" })).toBeEnabled();
  });

  it("jumps from the resolve chip to the docked tray and preserves collapsed content in the DOM", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(<DocumentPanelRenderer documentId="doc-1" output={output} />);

    await user.click(screen.getByRole("button", { name: "1 unresolved alert" }));
    expect(scrollIntoView).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Collapse tray" }));
    expect(screen.getByText("Needs routing")).not.toBeVisible();
    expect(screen.getByText("Needs routing")).toBeInTheDocument();
  });

  it("moves configured secondary actions into the header dropdown", async () => {
    const user = userEvent.setup();
    const onSplit = vi.fn();

    render(
      <DocumentPanelRenderer
        output={{
          ...output,
          secondaryActions: [
            { id: "split-document", label: "Split Document", icon: Scissors, onClick: onSplit },
          ],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Shelve" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Split Document" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Split Document" }));

    expect(onSplit).toHaveBeenCalledTimes(1);
  });

  it("keeps checklist progress inside the checklist instead of the footer", () => {
    render(
      <DocumentPanelRenderer
        output={{
          header: { kindLabel: "Document", title: "Document" },
          preferredRenderer: "checklist",
          checklist: [
            { id: "done", label: "Done", state: "done" },
            { id: "todo", label: "Todo", state: "todo" },
          ],
          sections: [{ id: "todo", title: "Todo", children: "Todo body" }],
        }}
      />,
    );

    expect(screen.queryByText("1 item left")).not.toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("resets the active tab when the document identity changes", () => {
    const { rerender } = render(<DocumentPanelRenderer documentId="doc-1" output={output} />);

    fireEvent.click(screen.getByRole("tab", { name: /Workflow/i }));
    expect(screen.getByText("Workflow body")).toBeVisible();

    rerender(<DocumentPanelRenderer documentId="doc-2" output={output} />);

    expect(screen.getByText("Summary body")).toBeVisible();
    expect(screen.getByText("Workflow body")).not.toBeVisible();
  });

  it("adds the shared Details and Activity tabs with a numeric issue badge for routed scroll panels", () => {
    render(
      <DocumentPanelRenderer
        documentId="doc-1"
        output={{
          ...output,
          preferredRenderer: "scroll",
          tabs: undefined,
          alerts: [{ id: "route", tone: "warn", label: "Needs routing" }],
        }}
        email={{ from: "detail@example.com", subject: "Details only", receivedAt: "2026-06-01T12:00:00.000Z" }}
        emailSupplement={<p>Attachment controls</p>}
        auditEntries={[{ id: "audit-1", action: "file-document", actor: "person@example.com", changes: {}, createdAt: "2026-06-01T12:00:00.000Z" }]}
      />,
    );

    expect(screen.getByRole("tab", { name: /Details/ })).toBeInTheDocument();
    expect(screen.getByLabelText("1 details issue")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }));
    expect(screen.getByText("file document")).toBeVisible();
    expect(screen.getByText("person@example.com")).toBeVisible();
    expect(screen.getByText("detail@example.com")).not.toBeVisible();
    expect(screen.getByText("Attachment controls")).not.toBeVisible();
  });

  it("opens Activity when a Reply or Forward header request is made", async () => {
    render(
      <DocumentPanelRenderer
        documentId="doc-1"
        output={output}
        auditEntries={[]}
        canEmail
        email={{ messageId: "message-1", from: "sender@example.com", subject: "Source message", receivedAt: "2026-06-01T12:00:00.000Z" }}
      />,
    );

    requestCollaborationCompose("doc-1", "forward");

    await waitFor(() => expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true"));
  });

  it("moves between document tabs with arrow keys", () => {
    render(<DocumentPanelRenderer documentId="doc-1" output={output} />);

    const summaryTab = screen.getByRole("tab", { name: /Summary/i });
    const workflowTab = screen.getByRole("tab", { name: /Workflow/i });
    summaryTab.focus();
    fireEvent.keyDown(summaryTab, { key: "ArrowRight" });

    expect(workflowTab).toHaveFocus();
    expect(workflowTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(workflowTab, { key: "Home" });
    expect(summaryTab).toHaveFocus();
  });

  it("resets the expanded email when document identity changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DocumentPanelRenderer
        documentId="doc-1"
        output={output}
        email={{ from: "one@example.com", subject: "First", receivedAt: "2026-06-01T12:00:00.000Z", body: "First full body" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "View full email" }));
    expect(screen.getByText("First full body")).toBeVisible();

    rerender(
      <DocumentPanelRenderer
        documentId="doc-2"
        output={output}
        email={{ from: "two@example.com", subject: "Second", receivedAt: "2026-06-02T12:00:00.000Z", body: "Second full body" }}
      />,
    );

    expect(screen.queryByText("Second full body")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View full email" })).toBeInTheDocument();
  });

  describe("Review details", () => {
    const w9Record = {
      id: "w9-review", classification: "w9", confidence: 0.9, overallConfidence: 0.9, file: "w9-review.pdf",
      email: { from: "tax@example.com", subject: "material supply W-9", receivedAt: "2026-01-01T00:00:00Z" },
      status: "pending", queuedAt: "2026-01-01T00:00:00Z",
      extracted: { vendorName: "Acme LLC", vendorAddress: "123 Main St, Atlanta, GA 30336", invoiceNumber: null, invoiceDate: null, dueDate: null, amount: null, jobNumber: null, projectName: null, description: null, lineItems: [] },
      matching: null, splitFrom: null, duplicateOf: null, reason: null, error: null, reclassifiedFrom: null, reclassifiedAt: null,
    } satisfies Invoice;
    const original = HTMLElement.prototype.scrollIntoView;
    let scrolled: HTMLElement[] = [];
    function stubScroll() {
      scrolled = [];
      HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) { scrolled.push(this); };
    }
    afterEach(() => { HTMLElement.prototype.scrollIntoView = original; });
    const section = (id: string) => document.querySelector(`[data-document-section-id="${id}"]`);

    it("scrolls a W-9 card to Vendor Identity and focuses the field each alert names", async () => {
      const user = userEvent.setup();
      stubScroll();
      render(<DocumentPanel record={w9Record} spec={createW9DocumentSpec()} />);
      const vendorName = screen.getByRole("textbox", { name: /^Vendor name/ });
      fireEvent.change(vendorName, { target: { value: "" } });
      expect(screen.getByText(/Vendor name required/)).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Review details" }));
      // The field itself is scrolled (not just its section) so scroll-padding keeps it clear of the tray.
      expect(scrolled).toEqual([vendorName]);
      expect(document.activeElement).toBe(vendorName);

      await user.click(screen.getByRole("button", { name: "Next issue" }));
      expect(screen.getByText(/Tax ID required/)).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Review details" }));
      const taxId = screen.getByLabelText(/^Tax ID number/);
      expect(scrolled).toEqual([vendorName, taxId]);
      expect(document.activeElement).toBe(taxId);
    });

    it("returns to the Details tab from Activity before revealing a W-9 field (production tabs mode)", async () => {
      const user = userEvent.setup();
      stubScroll();
      const scrollTo = vi.fn();
      const originalScrollTo = HTMLElement.prototype.scrollTo;
      HTMLElement.prototype.scrollTo = scrollTo;
      try {
        render(<DocumentPanel record={w9Record} spec={createW9DocumentSpec()} auditEntries={[]} />);
        const vendorName = screen.getByRole("textbox", { name: /^Vendor name/ });
        fireEvent.change(vendorName, { target: { value: "" } });
        await user.click(screen.getByRole("tab", { name: /Activity/ }));
        expect(vendorName).not.toBeVisible();
        scrollTo.mockClear();

        await user.click(screen.getByRole("button", { name: "Review details" }));
        expect(screen.getByRole("tab", { name: /Details/ })).toHaveAttribute("aria-selected", "true");
        expect(vendorName).toBeVisible();
        expect(scrolled).toEqual([vendorName]);
        expect(document.activeElement).toBe(vendorName);
        // The reveal succeeded, so the pane's scroll-to-top fallback never ran [fix-6.7].
        expect(scrollTo).not.toHaveBeenCalled();
      } finally {
        HTMLElement.prototype.scrollTo = originalScrollTo;
      }
    });

    it("FIX67-1 switches to the first tab for a target section that has no tabId (where sectionsByTab renders it)", async () => {
      const user = userEvent.setup();
      stubScroll();
      const scrollTo = vi.fn();
      const originalScrollTo = HTMLElement.prototype.scrollTo;
      HTMLElement.prototype.scrollTo = scrollTo;
      try {
        render(<DocumentPanelRenderer documentId="doc-1" output={{
          ...output,
          alerts: [{ id: "untabbed", sectionId: "untabbed", tone: "warn", label: "Fix the untabbed section" }],
          sections: [...output.sections, { id: "untabbed", title: "Untabbed", children: <input aria-label="Untabbed field" aria-invalid="true" /> }],
        }} />);
        await user.click(screen.getByRole("tab", { name: /Workflow/ }));
        expect(screen.getByLabelText("Untabbed field")).not.toBeVisible();
        scrollTo.mockClear();

        await user.click(screen.getByRole("button", { name: "Review details" }));
        expect(screen.getByRole("tab", { name: /Summary/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByLabelText("Untabbed field")).toBeVisible();
        expect(document.activeElement).toBe(screen.getByLabelText("Untabbed field"));
        expect(scrollTo).not.toHaveBeenCalled();
      } finally {
        HTMLElement.prototype.scrollTo = originalScrollTo;
      }
    });

    it("switches to the alert's tab before revealing its section and focusing the heading", async () => {
      const user = userEvent.setup();
      stubScroll();
      render(<DocumentPanelRenderer documentId="doc-1" output={{ ...output, alerts: [{ id: "route", tabId: "workflow", sectionId: "workflow", tone: "warn", label: "Needs routing" }] }} />);
      expect(screen.getByText("Workflow body")).not.toBeVisible();

      await user.click(screen.getByRole("button", { name: "Review details" }));
      expect(screen.getByText("Workflow body")).toBeVisible();
      expect(scrolled).toEqual([section("workflow")]);
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Workflow" }));
    });

    it("scrolls to the top only when the alert has no rendered target", async () => {
      const user = userEvent.setup();
      stubScroll();
      const scrollTo = vi.fn();
      const originalScrollTo = HTMLElement.prototype.scrollTo;
      HTMLElement.prototype.scrollTo = scrollTo;
      try {
        render(<DocumentPanelRenderer documentId="doc-1" output={{ ...output, alerts: [{ id: "route", tabId: "workflow", sectionId: "missing", tone: "warn", label: "Needs routing" }] }} />);
        scrollTo.mockClear();
        await user.click(screen.getByRole("button", { name: "Review details" }));
        expect(scrolled).toEqual([]);
        expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
      } finally {
        HTMLElement.prototype.scrollTo = originalScrollTo;
      }
    });
  });

  describe("Dismiss", () => {
    const notice = { id: "bundle", tone: "info" as const, label: "Auto-link skipped", detail: "Bundle of 3 waivers" };
    const withAlerts = (alerts: DocumentSpecOutput["alerts"]): DocumentSpecOutput => ({ ...output, alerts });

    it("removes a no-target notification and drops the tray count, header pill and tab badge at once", async () => {
      const user = userEvent.setup();
      render(<DocumentPanelRenderer documentId="doc-1" output={withAlerts([output.alerts![0], notice])} />);
      expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent("To resolve 2");
      expect(screen.getByRole("button", { name: "2 unresolved alerts" })).toBeInTheDocument();
      expect(screen.getByLabelText("1 summary issue")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Next issue" }));
      expect(screen.getByText(/Auto-link skipped/)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Review details" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(screen.queryByText(/Auto-link skipped/)).not.toBeInTheDocument();
      expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent("To resolve 1");
      expect(screen.getByRole("button", { name: "1 unresolved alert" })).toBeInTheDocument();
      expect(screen.queryByLabelText("1 summary issue")).not.toBeInTheDocument();
      expect(screen.getByLabelText("1 workflow issue")).toBeInTheDocument();
    });

    it("hides the tray when every card is dismissed and shows the card again after a remount (reload)", async () => {
      const user = userEvent.setup();
      const view = render(<DocumentPanelRenderer documentId="doc-1" output={withAlerts([notice])} />);
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByTestId("document-resolve-tray")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /unresolved alert/ })).not.toBeInTheDocument();

      view.unmount();
      render(<DocumentPanelRenderer documentId="doc-1" output={withAlerts([notice])} />);
      expect(screen.getByText(/Auto-link skipped/)).toBeVisible();
      // fix-5: a notice-only tray reads "To review".
      expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent("To review 1");
    });

    it("stays dismissed while unchanged and returns when its detail changes or the document changes", async () => {
      const user = userEvent.setup();
      const view = render(<DocumentPanelRenderer documentId="doc-1" output={withAlerts([notice])} />);
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      view.rerender(<DocumentPanelRenderer documentId="doc-1" output={withAlerts([{ ...notice }])} />);
      expect(screen.queryByText(/Auto-link skipped/)).not.toBeInTheDocument();

      view.rerender(<DocumentPanelRenderer documentId="doc-1" output={withAlerts([{ ...notice, detail: "Bundle of 4 waivers" }])} />);
      expect(screen.getByText("Auto-link skipped — Bundle of 4 waivers")).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      view.rerender(<DocumentPanelRenderer documentId="doc-2" output={withAlerts([{ ...notice, detail: "Bundle of 4 waivers" }])} />);
      expect(screen.getByText("Auto-link skipped — Bundle of 4 waivers")).toBeVisible();
    });

    it("never offers Dismiss on any W-9 required-field card", async () => {
      const user = userEvent.setup();
      render(<DocumentPanel record={{ id: "w9-dismiss", classification: "w9", confidence: 0.9, overallConfidence: 0.9, file: "w9.pdf", email: { from: "tax@example.com", subject: "W-9", receivedAt: "2026-01-01T00:00:00Z" }, status: "pending", queuedAt: "2026-01-01T00:00:00Z", extracted: { vendorName: "", vendorAddress: null, invoiceNumber: null, invoiceDate: null, dueDate: null, amount: null, jobNumber: null, projectName: null, description: null, lineItems: [] }, matching: null, splitFrom: null, duplicateOf: null, reason: null, error: null, reclassifiedFrom: null, reclassifiedAt: null } satisfies Invoice} spec={createW9DocumentSpec()} />);
      const [vendorType, taxClass] = screen.getAllByRole("combobox");
      fireEvent.change(vendorType, { target: { value: "" } });
      fireEvent.change(taxClass, { target: { value: "" } });
      expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent("To resolve 4");
      for (const label of ["Vendor name required", "Vendor type required", "Tax classification required", "Tax ID required"]) {
        expect(screen.getByText(new RegExp(label))).toBeVisible();
        expect(screen.getByRole("button", { name: "Review details" })).toBeVisible();
        expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
        expect(screen.getByTestId("document-resolve-tray").querySelector("[data-tone]")).toHaveAttribute("data-tone", "blocking");
        expect(screen.getByText(new RegExp(label)).closest("[data-tone]")).toHaveAttribute("data-tone", "blocking");
        if (label !== "Tax ID required") await user.click(screen.getByRole("button", { name: "Next issue" }));
      }
    });
  });

  describe("status pill [fix-6.1]", () => {
    const bundle = { id: "multi-waiver-bundle", tone: "info" as const, label: "This PDF looks like a bundle of multiple waivers" };
    const blocker = { id: "route", tabId: "workflow", tone: "warn" as const, label: "Needs routing" };
    const panel = (alerts: DocumentSpecOutput["alerts"]) => <DocumentPanelRenderer documentId="doc-1" output={{ ...output, alerts }} />;
    const expectAmber = (count: number) => {
      const pill = screen.getByRole("button", { name: `${count} unresolved alert${count === 1 ? "" : "s"}` });
      expect(pill).toHaveTextContent(`${count} to resolve`);
      expect(pill).toHaveClass("border-amber-300", "bg-amber-50", "text-amber-800");
      expect(pill).not.toHaveAttribute("data-tone");
      expect(pill.querySelector(".lucide-triangle-alert")).not.toBeNull();
    };

    it("FIX61-1 a notice-only panel shows N to review in the neutral notice style and icon", () => {
      render(panel([bundle]));
      const pill = screen.getByRole("button", { name: "1 alert to review" });
      expect(pill).toHaveTextContent("1 to review");
      expect(pill).toHaveAttribute("data-tone", "info");
      expect(pill).toHaveClass("border-rc-line", "bg-rc-wash", "text-rc-ink");
      expect(pill).not.toHaveClass("bg-amber-50");
      expect(pill.querySelector(".lucide-info")).toHaveClass("text-rc-icon");
      expect(pill.querySelector(".lucide-triangle-alert")).toBeNull();
      expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent(/^To review 1$/);
    });

    it("FIX61-2 a mixed panel keeps the amber N to resolve pill", () => {
      render(panel([bundle, blocker]));
      expectAmber(2);
    });

    it("FIX61-3 a blocker-only panel keeps the amber N to resolve pill", () => {
      render(panel([blocker]));
      expectAmber(1);
    });

    it("FIX61-4 flips to the notice pill when the blocker disappears, and back when it returns", () => {
      const view = render(panel([bundle, blocker]));
      expectAmber(2);
      view.rerender(panel([bundle]));
      expect(screen.getByRole("button", { name: "1 alert to review" })).toHaveTextContent("1 to review");
      view.rerender(panel([bundle, blocker]));
      expectAmber(2);
    });
  });
});
