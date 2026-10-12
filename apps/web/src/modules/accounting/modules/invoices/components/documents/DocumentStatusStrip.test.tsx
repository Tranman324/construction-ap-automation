import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocumentStatusStrip } from "@/modules/accounting/modules/invoices/components/documents/DocumentStatusStrip";

describe("DocumentStatusStrip", () => {
  it("shows the document kind and workflow status", () => {
    render(
      <DocumentStatusStrip
        header={{
          kindLabel: "COI",
          title: "Certificate",
          statusLabel: "Compliant",
          statusTone: "ok",
        }}
        alertCount={0}
      />,
    );

    expect(screen.getByText("COI")).toBeInTheDocument();
    expect(screen.getByText("Compliant")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("shows external save status as its own pill", () => {
    render(
      <DocumentStatusStrip
        header={{
          kindLabel: "Receipt",
          title: "Receipt",
          statusLabel: "Shelved",
          statusTone: "ok",
          externalStatusLabel: "Filed to SP",
          externalStatusTone: "ok",
        }}
        alertCount={0}
      />,
    );

    expect(screen.getByText("Shelved")).toBeInTheDocument();
    expect(screen.getByText("Filed to SP")).toBeInTheDocument();
  });

  it("summarizes unresolved alerts", () => {
    const onResolveClick = vi.fn();
    render(
      <DocumentStatusStrip
        header={{ kindLabel: "Document", title: "Document" }}
        alertCount={2}
        onResolveClick={onResolveClick}
      />,
    );

    expect(screen.getByLabelText("2 unresolved alerts")).toHaveTextContent("2 to resolve");
    fireEvent.click(screen.getByLabelText("2 unresolved alerts"));
    expect(onResolveClick).toHaveBeenCalledTimes(1);
  });

  it("renders optional panel actions", () => {
    render(
      <DocumentStatusStrip
        header={{ kindLabel: "Document", title: "Document" }}
        alertCount={0}
        actions={<button type="button">Actions</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
  });
});
