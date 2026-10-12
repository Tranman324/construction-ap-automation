import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelState } from "./PanelState";

describe("PanelState", () => {
  it("renders children for ready and stale phases", () => {
    const { rerender } = render(<PanelState phase="ready"><p>Panel content</p></PanelState>);
    expect(screen.getByText("Panel content")).toBeInTheDocument();
    rerender(<PanelState phase="stale"><p>Panel content</p></PanelState>);
    expect(screen.getByText("Showing cached data")).toBeInTheDocument();
    expect(screen.getByText("Panel content")).toBeInTheDocument();
  });

  it.each([
    ["error", "Something went wrong"],
    ["not-found", "Invoice not found"],
    ["unauthorized", "You don't have access"],
    ["offline", "You're offline"],
    ["timeout", "Request timed out"],
  ] as const)("renders the %s state", (phase, copy) => {
    render(<PanelState phase={phase} onRetry={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it("renders the retrying overlay over last-known content", () => {
    render(<PanelState phase="retrying" retryingLoaderSize={112}><p>Last content</p></PanelState>);
    expect(screen.getByText("Last content")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Retrying" })).toBeInTheDocument();
    expect(screen.getByTestId("retrying-loader")).toHaveAttribute("data-size", "112");
  });

  it("renders an empty slot for the empty phase", () => {
    render(<PanelState phase="empty" emptySlot={<p>No attachments</p>} />);
    expect(screen.getByText("No attachments")).toBeInTheDocument();
  });

  it("shows errorDetail on error and timeout states", () => {
    const { rerender } = render(<PanelState phase="error" errorDetail="Invoice service is unavailable" onRetry={vi.fn()} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Invoice service is unavailable")).toBeInTheDocument();
    rerender(<PanelState phase="timeout" errorDetail="GET /api/invoices/123 timed out after 30s" onRetry={vi.fn()} />);
    expect(screen.getByText("Request timed out")).toBeInTheDocument();
    expect(screen.getByText("GET /api/invoices/123 timed out after 30s")).toBeInTheDocument();
  });

  it("omits detail line when errorDetail is null", () => {
    render(<PanelState phase="error" onRetry={vi.fn()} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText(/service|unavailable|timed out/i)).not.toBeInTheDocument();
  });
});
