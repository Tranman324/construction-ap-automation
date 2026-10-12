import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Scissors } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { DocumentActionsDropdown } from "@/modules/accounting/modules/invoices/components/documents/DocumentActionsDropdown";

describe("DocumentActionsDropdown", () => {
  it("renders document actions in a reusable menu", async () => {
    const user = userEvent.setup();
    const onSplit = vi.fn();

    render(
      <DocumentActionsDropdown
        actions={[
          { id: "split-document", label: "Split Document", icon: Scissors, onClick: onSplit },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Split Document" }));

    expect(onSplit).toHaveBeenCalledTimes(1);
  });

  it("does not render an empty menu trigger", () => {
    render(<DocumentActionsDropdown actions={[]} />);

    expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
  });

  it("wires shortcut hints for comment, reply, and forward menu owners", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/accounting/modules/invoices/components/documents/DocumentActionsDropdown.tsx"), "utf8");
    expect(source).toContain('action.id === "add-comment" ? shortcuts.comment');
    expect(source).toContain('action.id === "reply" ? shortcuts.reply');
    expect(source).toContain('action.id === "forward" ? shortcuts.forward');
    expect(source).toContain("formatShortcutTooltip(action.label, shortcut)");
  });

  it("keeps disabled actions discoverable through their tooltip reason", async () => {
    const user = userEvent.setup();
    const onUnlink = vi.fn();
    const reason = "Approved invoices are locked — unapprove first to change waiver linkage.";

    render(
      <DocumentActionsDropdown
        actions={[{ id: "unlink-waiver", label: "Unlink Waiver", onClick: onUnlink, disabled: true, disabledReason: reason }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    const action = screen.getByRole("menuitem", { name: "Unlink Waiver" });
    expect(action).toHaveAttribute("aria-disabled", "true");
    await user.hover(action.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(reason);
    expect(onUnlink).not.toHaveBeenCalled();
  });

  it("keeps former standalone action trigger sites out of the rendered surfaces", () => {
    const appRoot = process.cwd();
    const invoiceRoute = readFileSync(resolve(appRoot, "src/app/(dashboard)/accounting/invoices/[id]/page.tsx"), "utf8");
    const invoiceForm = readFileSync(
      resolve(appRoot, "src/modules/accounting/modules/invoices/components/invoices/InvoiceDetailForm.tsx"),
      "utf8",
    );
    const coiSpec = readFileSync(
      resolve(appRoot, "src/modules/accounting/modules/invoices/components/documents/coiDocumentSpec.tsx"),
      "utf8",
    );

    expect(invoiceRoute).not.toContain("<CreateRuleFromInvoice");
    expect(invoiceForm).not.toContain("SpectrumRefreshButton");
    expect(coiSpec).not.toContain("syncSpectrum");
    expect(coiSpec).not.toContain("RotateCw");
  });

  it("keeps filing route handlers async so returned undo actions are remembered", () => {
    const appRoot = process.cwd();
    const invoiceRoute = readFileSync(resolve(appRoot, "src/app/(dashboard)/accounting/invoices/[id]/page.tsx"), "utf8");
    const documentRoute = readFileSync(resolve(appRoot, "src/app/(dashboard)/accounting/documents/[id]/page.tsx"), "utf8");

    expect(invoiceRoute).toContain("await fileDocument.mutateAsync({ id: record.id, ...meta })");
    expect(invoiceRoute).toContain("rememberRecentUndoAction(");
    expect(invoiceRoute).toContain('meta?.uploadToSharePoint ? "File to Project" : "Shelve"');
    expect(invoiceRoute).toContain("data.sharePoint?.uploaded !== false");
    expect(invoiceRoute).toContain("if (!meta?.uploadToSharePoint || data.sharePoint?.uploaded !== false) {");
    expect(invoiceRoute).toContain("return data;");
    expect(documentRoute).toContain("await fileDocument.mutateAsync({ id: record.id, ...meta })");
    expect(documentRoute).toContain("if (data.sharePoint?.uploaded !== false) {");
    expect(documentRoute).toContain("if (!meta?.uploadToSharePoint || data.sharePoint?.uploaded !== false) {");
    expect(documentRoute).toContain("return data;");
  });
});
