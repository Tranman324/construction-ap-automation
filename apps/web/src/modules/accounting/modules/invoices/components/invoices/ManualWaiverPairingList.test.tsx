import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ManualWaiverPairingList } from "@/modules/accounting/modules/invoices/components/invoices/ManualWaiverPairingList";
import type { WaiverCandidateSummary } from "@/modules/accounting/modules/invoices/types/api";
import { PanelNoticeProvider, PanelNoticeOutlet, PanelNoticeObserver } from "../documents/PanelNotice";

const APPROVED_REASON = "Approved invoices are locked — unapprove first to change waiver linkage.";

const candidate: WaiverCandidateSummary = {
  id: "candidate-1", fileName: "candidate.pdf", vendorName: "Apex", vendorCode: "V100",
  amount: 100, invoiceNumber: "INV-1", jobNumber: "24-017", status: "pending", receivedAt: "2026-07-01T12:00:00.000Z",
};

describe("ManualWaiverPairingList", () => {
  function emptyProps(): ComponentProps<typeof ManualWaiverPairingList> {
    return {
      candidates: [], paired: null, loading: false, error: null,
      candidateLabel: "Lien Waivers", pairedLabel: "Lien Waiver", query: "", page: 1, total: 0, limit: 10,
      onQueryChange: vi.fn(), onPageChange: vi.fn(), canUnlink: true, linkPendingId: null, unlinkPending: false,
      onLink: vi.fn(), onUnlink: vi.fn(), onViewCandidate: vi.fn(), onViewPaired: vi.fn(),
      unavailableMessage: "Lien waiver linking is not needed for this invoice.",
    };
  }

  it.each([true, false])("preserves inline informational markup without a provider (linkingAvailable=%s)", (linkingAvailable) => {
    const { container } = render(<ManualWaiverPairingList {...emptyProps()} linkingAvailable={linkingAvailable} />);
    expect(within(container).getByText(linkingAvailable
      ? "No unlinked lien waivers are available."
      : "Lien waiver linking is not needed for this invoice.")).toBeInTheDocument();
    expect(container.querySelector("[data-panel-notice]")).toBeNull();
    expect(within(container).queryByRole("searchbox") !== null).toBe(linkingAvailable);
  });

  it("portals not-needed guidance as resolved, preserving the existing unavailable precedence", () => {
    const onNotices = vi.fn();
    render(
      <PanelNoticeProvider documentId="inv-1">
        <div data-testid="pairing-source"><ManualWaiverPairingList {...emptyProps()} linkingAvailable={false} loading error="Hidden query error" /></div>
        <div data-testid="notice-target"><PanelNoticeOutlet /></div>
        <PanelNoticeObserver onChange={onNotices} />
      </PanelNoticeProvider>,
    );
    expect(within(screen.getByTestId("notice-target")).getByRole("status")).toHaveTextContent("Lien waiver linking is not needed for this invoice.");
    expect(screen.getByTestId("pairing-source")).toBeEmptyDOMElement();
    expect(screen.queryByText("Hidden query error")).not.toBeInTheDocument();
    expect(onNotices).toHaveBeenLastCalledWith([expect.objectContaining({ id: "manual-waiver-linking-not-needed", resolved: true })]);
  });

  it("portals empty guidance without adding a blocker or moving search and candidate actions", async () => {
    const props = emptyProps();
    const onNotices = vi.fn();
    const view = (candidates: readonly WaiverCandidateSummary[]) => (
      <PanelNoticeProvider documentId="inv-1">
        <div data-testid="pairing-source"><ManualWaiverPairingList {...props} candidates={candidates} total={candidates.length} /></div>
        <div data-testid="notice-target"><PanelNoticeOutlet /></div>
        <PanelNoticeObserver onChange={onNotices} />
      </PanelNoticeProvider>
    );
    const { rerender } = render(view([]));
    const source = within(screen.getByTestId("pairing-source"));
    const target = within(screen.getByTestId("notice-target"));
    expect(target.getByText("No unlinked lien waivers are available.")).toBeInTheDocument();
    expect(source.queryByText("No unlinked lien waivers are available.")).not.toBeInTheDocument();
    expect(target.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(onNotices).toHaveBeenLastCalledWith([expect.objectContaining({ id: "manual-waiver-empty-candidates", resolved: true })]);
    fireEvent.change(source.getByRole("searchbox"), { target: { value: "Apex" } });
    expect(props.onQueryChange).toHaveBeenCalledWith("Apex");
    expect(props.onLink).not.toHaveBeenCalled();
    rerender(view([candidate]));
    expect(target.queryByText("No unlinked lien waivers are available.")).not.toBeInTheDocument();
    expect(onNotices).toHaveBeenLastCalledWith([]);
    expect(source.getByText("candidate.pdf")).toBeInTheDocument();
    await userEvent.click(source.getByRole("button", { name: "View" }));
    await userEvent.click(source.getByRole("button", { name: "Link" }));
    expect(props.onViewCandidate).toHaveBeenCalledWith("candidate-1");
    expect(props.onLink).toHaveBeenCalledWith("candidate-1");
  });

  it("offers View and Link for server-supplied candidates", async () => {
    const user = userEvent.setup();
    const onLink = vi.fn();
    const onViewCandidate = vi.fn();
    render(
      <ManualWaiverPairingList
        candidates={[candidate]}
        paired={null}
        loading={false}
        error={null}
        candidateLabel="Lien Waivers"
        pairedLabel="Lien Waiver"
        query=""
        page={1}
        total={1}
        limit={10}
        onQueryChange={vi.fn()}
        onPageChange={vi.fn()}
        canUnlink
        linkPendingId={null}
        unlinkPending={false}
        onLink={onLink}
        onUnlink={vi.fn()}
        onViewCandidate={onViewCandidate}
        onViewPaired={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(screen.getByRole("button", { name: "Link" }));

    expect(onViewCandidate).toHaveBeenCalledWith("candidate-1");
    expect(onLink).toHaveBeenCalledWith("candidate-1");
    expect(screen.getByText(/Received Jul 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText("candidate.pdf").parentElement).toHaveClass("flex");
    expect(screen.getByText("candidate.pdf").parentElement).toHaveClass("min-w-0");
  });

  it("keeps an approved target candidate visible but disables Link with an accessible reason", async () => {
    const user = userEvent.setup();
    const onLink = vi.fn();
    render(
      <ManualWaiverPairingList
        candidates={[{ ...candidate, status: "approved" }]}
        paired={null}
        loading={false}
        error={null}
        candidateLabel="Invoices"
        pairedLabel="Invoice"
        query=""
        page={1}
        total={1}
        limit={10}
        onQueryChange={vi.fn()}
        onPageChange={vi.fn()}
        canUnlink
        linkPendingId={null}
        unlinkPending={false}
        onLink={onLink}
        onUnlink={vi.fn()}
        onViewCandidate={vi.fn()}
        onViewPaired={vi.fn()}
        linkDisabledReason={() => APPROVED_REASON}
      />,
    );

    const linkButton = screen.getByRole("button", { name: "Link" });
    expect(linkButton).toBeDisabled();
    await user.hover(linkButton.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(APPROVED_REASON);
    await user.click(linkButton);
    expect(onLink).not.toHaveBeenCalled();
  });

  it("keeps an approved paired target visible but disables Unlink with an accessible reason", async () => {
    const user = userEvent.setup();
    const onUnlink = vi.fn();
    render(
      <ManualWaiverPairingList
        candidates={[]}
        paired={{ id: "invoice-1", fileName: "invoice.pdf", vendorName: "Apex", vendorCode: "V100", jobNumber: "24-017", amount: 100, invoiceNumber: "INV-1", status: "approved" }}
        loading={false}
        error={null}
        candidateLabel="Invoices"
        pairedLabel="Invoice"
        query=""
        page={1}
        total={0}
        limit={10}
        onQueryChange={vi.fn()}
        onPageChange={vi.fn()}
        canUnlink
        linkPendingId={null}
        unlinkPending={false}
        onLink={vi.fn()}
        onUnlink={onUnlink}
        onViewCandidate={vi.fn()}
        onViewPaired={vi.fn()}
        unlinkDisabledReason={APPROVED_REASON}
      />,
    );

    const unlinkButton = screen.getByRole("button", { name: "Unlink" });
    expect(unlinkButton).toBeDisabled();
    await user.hover(unlinkButton.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(APPROVED_REASON);
    await user.click(unlinkButton);
    expect(onUnlink).not.toHaveBeenCalled();
  });
});
