import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocumentResolveTray } from "@/modules/accounting/modules/invoices/components/documents/DocumentResolveTray";

describe("DocumentResolveTray", () => {
  it("guards two clicks in the same event batch and retains an unresolved card", async () => {
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<DocumentResolveTray alerts={[{ id: "retry", label: "Retry needed", tone: "warn", action: { id: "retry", label: "Retry", onClick: run } }]} />);
    const button = screen.getByRole("button", { name: "Retry" });
    act(() => { button.click(); button.click(); });
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByText("Retry needed")).toBeVisible();
  });

  it("reviews an actionless blocker without acknowledging or hiding server state", () => {
    const review = vi.fn();
    render(<DocumentResolveTray onReview={review} onDismiss={vi.fn()} alerts={[{ id: "waiting", label: "Waiting", tone: "info", waiting: true, sectionId: "details" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review details" }));
    expect(review).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1 of 1")).toBeVisible();
    expect(screen.queryByText("Acknowledged")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("offers Dismiss, never Review details, for an alert with no action and no target", () => {
    const review = vi.fn();
    const dismiss = vi.fn();
    const alert = { id: "bundle", label: "Auto-link skipped", tone: "info" as const };
    render(<DocumentResolveTray onReview={review} onDismiss={dismiss} alerts={[alert]} />);
    expect(screen.queryByRole("button", { name: "Review details" })).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Dismiss" });
    expect(button).toHaveAttribute("data-variant", "outline");
    fireEvent.click(button);
    expect(dismiss).toHaveBeenCalledWith(alert);
    expect(review).not.toHaveBeenCalled();
  });

  it("keeps Review details beside Dismiss for an opted-in informational alert, and never adds Dismiss to an action card", () => {
    const run = vi.fn();
    render(<DocumentResolveTray onReview={vi.fn()} onDismiss={vi.fn()} alerts={[
      { id: "info", label: "Heads up", tone: "info", sectionId: "details", dismissible: true },
      { id: "retry", label: "Retry needed", tone: "warn", action: { id: "retry", label: "Retry", onClick: run } },
    ]} />);
    expect(screen.getByRole("button", { name: "Review details" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    // ByRole skips the hidden first card, so only the visible action card is queried.
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });
  it("lets users reach later issue actions without resolving the first card", async () => {
    const run = vi.fn();
    render(<DocumentResolveTray alerts={[
      { id: "waiting", tone: "info", label: "Waiting on server", waiting: true },
      { id: "retry", tone: "warn", label: "Upload failed", action: { id: "retry-action", label: "Retry upload", onClick: run } },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent("To resolve 2");
    fireEvent.click(screen.getByRole("button", { name: "Previous issue" }));
    expect(screen.getByText("Waiting on server")).toBeVisible();
  });
  it("uses one visible card, waiting count, and front-card action", async () => {
    const onClick = vi.fn();
    render(
      <DocumentResolveTray
        documentId="doc-1"
        alerts={[
          { id: "match", tone: "warn", label: "No card match", detail: "Match this receipt.", action: { id: "match-action", label: "Match card", onClick } },
          { id: "waiver", tone: "info", label: "Waiting for waiver", waiting: true },
        ]}
      />,
    );

    expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent("To resolve 2");
    expect(screen.getByText("1 waiting")).toBeVisible();
    expect(screen.getByText("Waiting for waiver")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Match card" }));
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    const message = screen.getByText("No card match — Match this receipt.");
    expect(message).toBeVisible();
    expect(message.className).toContain("truncate");
    expect(message).toHaveAttribute("aria-label", "No card match: Match this receipt.");
    expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent("To resolve 2");
  });

  it("keeps a controlled issue at the front when its action rejects", async () => {
    const onClick = vi.fn().mockRejectedValue(new Error("Server refused"));
    render(
      <DocumentResolveTray
        alerts={[
          { id: "server-owned", tone: "warn", label: "Server-owned blocker", action: { id: "resolve", label: "Resolve", onClick } },
          { id: "next", tone: "warn", label: "Next blocker" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Server-owned blocker")).toBeVisible();
    expect(screen.getByText("Next blocker")).not.toBeVisible();
    expect(screen.getByTestId("document-resolve-tray-header")).toHaveTextContent("To resolve 2");
  });

  it("does not dismiss or invoke a disabled action", () => {
    const onClick = vi.fn();
    render(
      <DocumentResolveTray
        alerts={[{ id: "blocked", tone: "warn", label: "Blocked", action: { id: "blocked-action", label: "Resolve", disabled: true, onClick } }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByText("Blocked")).toBeVisible();
  });

  describe("tone [fix-3]", () => {
    const bundle = { id: "multi-waiver-bundle", tone: "info" as const, label: "This PDF looks like a bundle of multiple waivers" };
    const blocker = { id: "w9-tax-id", sectionId: "identity", tone: "warn" as const, label: "Tax ID required" };
    const trayTone = () => screen.getByTestId("document-resolve-tray").querySelector("[data-tone]")?.getAttribute("data-tone");
    const cardTone = (text: RegExp) => screen.getByText(text).closest("[data-tone]")?.getAttribute("data-tone");

    it("gives a notice-only front card the info tone on the tray and on the card", () => {
      render(<DocumentResolveTray onReview={vi.fn()} onDismiss={vi.fn()} alerts={[bundle]} />);
      expect(trayTone()).toBe("info");
      expect(cardTone(/bundle of multiple waivers/)).toBe("info");
      const card = screen.getByText(/bundle of multiple waivers/).closest("[data-tone]");
      expect(card?.querySelector(".lucide-info")).toHaveClass("text-rc-icon");
      expect(card?.querySelector(".lucide-triangle-alert")).toBeNull();
    });

    it("keeps a blocker front card blocking and flips the tone as the carousel moves", () => {
      render(<DocumentResolveTray onReview={vi.fn()} onDismiss={vi.fn()} alerts={[bundle, blocker]} />);
      expect(trayTone()).toBe("info");
      fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
      expect(trayTone()).toBe("blocking");
      expect(cardTone(/Tax ID required/)).toBe("blocking");
      fireEvent.click(screen.getByRole("button", { name: "Previous issue" }));
      expect(trayTone()).toBe("info");
    });

    it("never treats an action card, a targeted card or a waiting row as a notice", () => {
      render(<DocumentResolveTray onReview={vi.fn()} onDismiss={vi.fn()} alerts={[
        { ...bundle, action: { id: "split", label: "Split document", onClick: vi.fn() } },
        { ...bundle, id: "targeted", sectionId: "details", label: "Targeted info" },
        { id: "waiting", tone: "info", label: "Waiting row", waiting: true },
      ]} />);
      expect(trayTone()).toBe("blocking");
      fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
      expect(trayTone()).toBe("blocking");
      fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
      expect(trayTone()).toBe("blocking");
    });
  });

  describe("header label [fix-5]", () => {
    const bundle = { id: "multi-waiver-bundle", tone: "info" as const, label: "This PDF looks like a bundle of multiple waivers" };
    const blocker = { id: "dirty", sectionId: "details", tone: "warn" as const, label: "Unsaved details" };
    const header = () => screen.getByTestId("document-resolve-tray-header");
    const tray = (alerts: Parameters<typeof DocumentResolveTray>[0]["alerts"]) => <DocumentResolveTray onReview={vi.fn()} onDismiss={vi.fn()} alerts={alerts} />;

    it("FIX5-1 a notice-only tray reads To review 1", () => {
      render(tray([bundle]));
      expect(header()).toHaveTextContent(/^To review 1$/);
      expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("1");
    });

    it("FIX5-2 a mixed tray reads To resolve 2 whichever card is in front", () => {
      render(tray([bundle, blocker]));
      expect(header()).toHaveTextContent(/^To resolve 2$/);
      fireEvent.click(screen.getByRole("button", { name: "Next issue" }));
      expect(header()).toHaveTextContent(/^To resolve 2$/);
    });

    it("FIX5-3 a blocker-only W-9 tray reads To resolve N", () => {
      render(tray([
        { id: "w9-vendor-name", sectionId: "identity", fieldId: "vendor-name", tone: "warn", label: "Vendor name required" },
        { id: "w9-tax-id", sectionId: "identity", fieldId: "tax-id", tone: "warn", label: "Tax ID required" },
      ]));
      expect(header()).toHaveTextContent(/^To resolve 2$/);
    });

    it("FIX5-5 flips to To review when the blocker goes away, and back when a blocker returns", () => {
      const view = render(tray([bundle, blocker]));
      expect(header()).toHaveTextContent(/^To resolve 2$/);
      view.rerender(tray([bundle]));
      expect(header()).toHaveTextContent(/^To review 1$/);
      view.rerender(tray([{ ...bundle, sectionId: "details" }]));
      expect(header()).toHaveTextContent(/^To resolve 1$/);
    });
  });
});
