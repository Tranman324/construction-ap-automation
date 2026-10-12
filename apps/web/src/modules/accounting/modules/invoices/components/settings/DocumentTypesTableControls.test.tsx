import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  DestinationCell,
  StatusControl,
} from "@/modules/accounting/modules/invoices/components/settings/DocumentTypesTableControls";
import type { ClassificationAssociation, ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";

const associations: ClassificationAssociation[] = [
  { key: "invoice", label: "Invoice Workflow", description: "Approval and Spectrum workflow." },
  { key: "receipt", label: "Receipt Panel", description: "Receipt review destination." },
  { key: "other", label: "Generic Panel", description: "Fallback review destination." },
];

const invoiceBuiltIn: ClassificationInfo = {
  name: "invoice",
  label: "Invoice",
  opensAs: "invoice",
  action: "extract-match",
  builtIn: true,
  status: "active",
};

const receiptBuiltIn: ClassificationInfo = {
  name: "receipt",
  label: "Receipt",
  opensAs: "receipt",
  action: "extract-match",
  builtIn: true,
  status: "active",
};

const custom: ClassificationInfo = {
  name: "custom-doc",
  label: "Custom Doc",
  opensAs: "other",
  action: "view-only",
  builtIn: false,
  status: "active",
};

describe("DocumentTypesTableControls", () => {
  it("locks the invoice destination with an explanatory tooltip", () => {
    render(<DestinationCell row={invoiceBuiltIn} associations={associations} pending={false} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Invoice opens as" })).toHaveAttribute(
      "title",
      "Invoice must use Invoice Workflow for Spectrum submission.",
    );
    expect(screen.getByText("Invoice Workflow")).toBeInTheDocument();
  });

  it("lets non-invoice built-in rows choose a different destination", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DestinationCell row={receiptBuiltIn} associations={associations} pending={false} onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Receipt opens as" }));
    await user.click(screen.getByRole("option", { name: /Generic Panel/ }));

    expect(onChange).toHaveBeenCalledWith("other");
  });

  it("toggles custom status controls", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<StatusControl row={custom} pending={false} onToggle={onToggle} />);

    await user.click(screen.getByRole("button", { name: "Custom Doc status" }));

    expect(onToggle).toHaveBeenCalledOnce();
  });

});
