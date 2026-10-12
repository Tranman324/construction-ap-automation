import { fireEvent, render, screen } from "@testing-library/react";
import { FileText } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import {
  DocumentAlertBanners,
  DocumentChecklistCard,
  DocumentKeyValueRows,
  DocumentMatchPill,
  DocumentSection,
  DocumentStatPill,
} from "@/modules/accounting/modules/invoices/components/documents/DocumentAtoms";

describe("DocumentAtoms", () => {
  it("renders sections and key value rows with icon labels", () => {
    render(
      <DocumentSection
        section={{
          id: "summary",
          title: "Summary",
          icon: FileText,
          children: <DocumentKeyValueRows rows={[{ label: "Vendor", value: "Acme" }]} />,
        }}
      />,
    );

    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("renders status, match, alert, and checklist states", () => {
    const onJump = vi.fn();
    render(
      <>
        <DocumentStatPill tone="ok" label="Ready" pulse />
        <DocumentMatchPill state="diff" />
        <DocumentAlertBanners
          alerts={[{ id: "missing", tone: "warn", label: "Needs routing", detail: "Select a folder" }]}
        />
        <DocumentChecklistCard
          items={[
            { id: "done", label: "Vendor matched", state: "done" },
            { id: "route", label: "Route selected", state: "todo", sectionId: "routing" },
          ]}
          onJump={onJump}
        />
      </>,
    );

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Amount differs")).toBeInTheDocument();
    expect(screen.getByText("Needs routing")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Route selected/i }));
    expect(onJump).toHaveBeenCalledWith("routing");
  });
});
