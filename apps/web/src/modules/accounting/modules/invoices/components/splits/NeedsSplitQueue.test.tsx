import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SplitDoc, SplitQueueResponse } from "@/modules/accounting/modules/invoices/types/api";

const mocks = vi.hoisted(() => ({
  data: undefined as SplitQueueResponse | undefined,
  isLoading: true,
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useSplitQueue: () => ({ data: mocks.data, isLoading: mocks.isLoading }),
}));

import { NeedsSplitQueue } from "@/modules/accounting/modules/invoices/components/splits/NeedsSplitQueue";

function makeDoc(id: string): SplitDoc {
  return {
    id,
    status: "needs-split",
    fileName: `${id}.pdf`,
    pageCount: 3,
    email: { messageId: `${id}-mail`, from: "vendor@example.com", subject: "Batch", receivedAt: "2026-09-01T12:00:00Z" },
    splitSuggestion: null,
    queuedAt: "2026-09-01T12:00:00Z",
  };
}

afterEach(() => {
  vi.useRealTimers();
  mocks.data = undefined;
  mocks.isLoading = true;
  mocks.push.mockReset();
});

describe("NeedsSplitQueue loading", () => {
  it("keeps six headers and shapes the filename, page count, status, and action cells", () => {
    const { container } = render(<NeedsSplitQueue />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    const cells = container.querySelectorAll("tbody tr:first-child td");
    expect(cells).toHaveLength(6);
    expect(cells[2].querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(cells[3].querySelector('[data-slot="skeleton"]')).toHaveClass("w-8");
    expect(cells[4].querySelector('[data-slot="skeleton"]')).toHaveClass("rounded-full");
    expect(cells[5].querySelector('[data-slot="skeleton"]')).toHaveClass("rounded-full");
  });

  it("arms actual rows on the first ready edge, then ignores later list refreshes", () => {
    vi.useFakeTimers();
    const { rerender } = render(<NeedsSplitQueue />);
    mocks.data = { items: [makeDoc("first"), makeDoc("second"), ...Array.from({ length: 12 }, (_, index) => makeDoc(`later-${index + 2}`))], total: 14, offset: 0, limit: 50 };
    mocks.isLoading = false;
    rerender(<NeedsSplitQueue />);

    const first = screen.getByText("first.pdf").closest("tr");
    const second = screen.getByText("second.pdf").closest("tr");
    expect(first).toHaveAttribute("data-arriving", "true");
    expect(first).toHaveAttribute("data-row-order", "0");
    expect(second).toHaveAttribute("data-row-order", "1");
    expect(screen.getByText("later-12.pdf").closest("tr")).toHaveAttribute("data-row-order", "12");
    // 707b9f10 removed the 13-row arrival cap: every row arrives, and the safety clear is (rows-1)*30+150+50 ms.
    expect(screen.getByText("later-13.pdf").closest("tr")).toHaveAttribute("data-arriving", "true");
    expect(screen.getByText("later-13.pdf").closest("tr")).toHaveAttribute("data-row-order", "13");
    act(() => vi.advanceTimersByTime(589));
    expect(first).toHaveAttribute("data-arriving", "true");
    act(() => vi.advanceTimersByTime(1));
    expect(first).not.toHaveAttribute("data-arriving");

    mocks.data = { ...mocks.data, items: [makeDoc("filtered")] };
    rerender(<NeedsSplitQueue />);
    expect(screen.getByText("filtered.pdf").closest("tr")).not.toHaveAttribute("data-arriving");
    mocks.isLoading = true;
    rerender(<NeedsSplitQueue />);
    mocks.isLoading = false;
    rerender(<NeedsSplitQueue />);
    expect(screen.getByText("filtered.pdf").closest("tr")).not.toHaveAttribute("data-arriving");
  });
});
