import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { LienWaiverPairingList } from "@/modules/accounting/modules/invoices/components/documents/LienWaiverPairingList";
import type { PairedWaiverDocumentSummary, WaiverCandidateSummary } from "@/modules/accounting/modules/invoices/types/api";
import { PanelNoticeOutlet, PanelNoticeProvider } from "./PanelNotice";

const candidates: WaiverCandidateSummary[] = [
  {
    id: "invoice-second-ranked",
    fileName: "second-ranked.pdf",
    vendorCode: "V200",
    vendorName: "Server Second",
    jobNumber: "24-002",
    amount: 200,
    invoiceNumber: "INV-2",
    status: "pending",
    receivedAt: "2026-07-02T12:00:00.000Z",
  },
  {
    id: "invoice-first-ranked",
    fileName: "first-ranked.pdf",
    vendorCode: "V100",
    vendorName: "Server First",
    jobNumber: "24-001",
    amount: 100,
    invoiceNumber: "INV-1",
    status: "pending",
    receivedAt: "2026-07-01T12:00:00.000Z",
  },
];

function renderList(overrides: Partial<ComponentProps<typeof LienWaiverPairingList>> = {}, withTray = false) {
  const props: ComponentProps<typeof LienWaiverPairingList> = {
    candidates,
    paired: null,
    loading: false,
    error: null,
    query: "",
    page: 1,
    total: candidates.length,
    limit: 10,
    onQueryChange: vi.fn(),
    onPageChange: vi.fn(),
    canUnlink: true,
    linkPendingId: null,
    unlinkPending: false,
    onLink: vi.fn(),
    onUnlink: vi.fn(),
    onViewCandidate: vi.fn(),
    onViewPaired: vi.fn(),
    linkingAvailable: true,
    ...overrides,
  };

  render(withTray ? <PanelNoticeProvider documentId="waiver-1"><div data-testid="inline-pairing"><LienWaiverPairingList {...props} /></div><PanelNoticeOutlet /></PanelNoticeProvider> : <LienWaiverPairingList {...props} />);
  return props;
}

describe("LienWaiverPairingList", () => {
  it("portals pairing errors while keeping candidate actions inline", async () => {
    const props = renderList({ error: "Synthetic pairing failure" }, true);
    expect(screen.getByTestId("panel-notice-outlet")).toContainElement(screen.getByText("Synthetic pairing failure"));
    const pair = screen.getByRole("button", { name: "Pair Server Second invoice INV-2" });
    expect(screen.getByTestId("inline-pairing")).toContainElement(pair);
    await userEvent.setup().click(pair);
    expect(props.onLink).toHaveBeenCalledWith("invoice-second-ranked");
  });

  it("retains paired success evidence and Preview/Change actions in the outlet", async () => {
    const paired = { ...candidates[0] };
    const props = renderList({ paired }, true);
    const outlet = screen.getByTestId("panel-notice-outlet");
    expect(screen.getByTestId("inline-pairing")).toBeEmptyDOMElement();
    expect(outlet).toContainElement(screen.getByLabelText("Paired invoice"));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(props.onViewPaired).toHaveBeenCalledWith(paired.id);
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(props.onUnlink).toHaveBeenCalledTimes(1);
  });
  it("renders server order without generic Candidate pills and keeps Pair and Preview actions distinct", async () => {
    const user = userEvent.setup();
    const onLink = vi.fn();
    const onViewCandidate = vi.fn();
    renderList({ onLink, onViewCandidate });

    expect(screen.queryByText("Candidate")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Server (Second|First)/).map((node) => node.textContent)).toEqual([
      "Server Second",
      "Server First",
    ]);

    await user.click(screen.getByRole("button", { name: "Pair Server Second invoice INV-2" }));
    expect(onLink).toHaveBeenCalledWith("invoice-second-ranked");
    expect(onViewCandidate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Preview invoice INV-2" }));
    expect(onViewCandidate).toHaveBeenCalledWith("invoice-second-ranked");
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it("keeps the server-provided paired state and its existing actions", async () => {
    const user = userEvent.setup();
    const paired: PairedWaiverDocumentSummary = {
      id: "paired-invoice",
      fileName: "paired.pdf",
      vendorCode: "V300",
      vendorName: "Paired Vendor",
      jobNumber: "24-003",
      amount: 300,
      invoiceNumber: "INV-3",
      status: "pending",
    };
    const onViewPaired = vi.fn();
    const onUnlink = vi.fn();
    renderList({ paired, onViewPaired, onUnlink });

    expect(screen.getByLabelText("Paired invoice")).toBeInTheDocument();
    expect(screen.queryByText("Server Second")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview" }));
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(onViewPaired).toHaveBeenCalledWith("paired-invoice");
    expect(onUnlink).toHaveBeenCalledOnce();
  });
});
