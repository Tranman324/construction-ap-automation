import { fireEvent, render, screen } from "@testing-library/react";
import { Activity, FileText } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { DocumentPanelTabs } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelTabs";

const tabs = [
  { id: "details", label: "Details", icon: FileText },
  { id: "activity", label: "Activity", icon: Activity },
];

describe("DocumentPanelTabs", () => {
  it("shows numeric per-tab issue counts and selects a clicked tab", () => {
    const onTabChange = vi.fn();
    render(
      <DocumentPanelTabs
        documentId="doc-1"
        tabs={tabs}
        alerts={[{ id: "issue", tone: "warn", label: "Needs review" }]}
        activeTabId="details"
        invoiceDetailStyle
        onTabChange={onTabChange}
      />,
    );

    expect(screen.getByLabelText("1 details issue")).toHaveTextContent("1");
    expect(screen.queryByLabelText(/activity issue/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(onTabChange).toHaveBeenCalledWith("activity");
  });

  it("supports wrapped arrow-key navigation", () => {
    const onTabChange = vi.fn();
    render(
      <DocumentPanelTabs
        documentId="doc-1"
        tabs={tabs}
        alerts={[]}
        activeTabId="details"
        invoiceDetailStyle
        onTabChange={onTabChange}
      />,
    );

    const details = screen.getByRole("tab", { name: "Details" });
    details.focus();
    fireEvent.keyDown(details, { key: "ArrowLeft" });
    expect(onTabChange).toHaveBeenCalledWith("activity");
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveFocus();
  });
});
