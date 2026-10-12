import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrashDiscardSourcePill } from "@/modules/accounting/modules/invoices/components/trash/TrashDiscardSourcePill";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function invoice(discardSource: Invoice["discardSource"]): Invoice {
  return { discardSource } as Invoice;
}

describe("TrashDiscardSourcePill", () => {
  it("uses concise prototype-aligned source detail and treats null as manual", () => {
    const { rerender } = render(<TrashDiscardSourcePill invoice={invoice("manual")} />);
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Discarded manually")).toBeInTheDocument();

    rerender(<TrashDiscardSourcePill invoice={invoice(null)} />);
    expect(screen.getByText("Manual")).toBeInTheDocument();

    rerender(<TrashDiscardSourcePill invoice={invoice("auto-ai")} />);
    expect(screen.getByText("Junk filter")).toBeInTheDocument();
    expect(screen.getByText("Auto-filtered as junk")).toBeInTheDocument();

    rerender(<TrashDiscardSourcePill invoice={invoice("rule-filter")} />);
    expect(screen.getByText("Junk filter")).toBeInTheDocument();

    rerender(<TrashDiscardSourcePill invoice={invoice("junk-hash")} />);
    expect(screen.getByText("Junk filter")).toBeInTheDocument();
  });
});
