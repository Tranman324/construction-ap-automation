import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useInvoiceFilters } from "@/modules/accounting/modules/invoices/hooks/useInvoiceFilters";

const FILTER_MOCKS = vi.hoisted(() => ({
  pathname: "/accounting/invoices",
  push: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => FILTER_MOCKS.pathname,
  useRouter: () => ({ push: FILTER_MOCKS.push }),
  useSearchParams: () => new URLSearchParams(FILTER_MOCKS.search),
}));

describe("useInvoiceFilters", () => {
  beforeEach(() => {
    FILTER_MOCKS.pathname = "/accounting/invoices";
    FILTER_MOCKS.push.mockReset();
    FILTER_MOCKS.search = "";
  });

  it("defaults the dashboard status filter to pending", () => {
    const { result } = renderHook(() => useInvoiceFilters());

    expect(result.current.filters.status).toBe("pending");
  });

  it("preserves explicit all status now that pending is the default", () => {
    FILTER_MOCKS.search = "status=all&job=25-401";
    const { result } = renderHook(() => useInvoiceFilters());

    expect(result.current.filters.status).toBe("all");

    act(() => result.current.setFilter("status", "all"));

    expect(FILTER_MOCKS.push).toHaveBeenCalledWith("/accounting/invoices?status=all&job=25-401");
  });

  it("still removes non-status all values from the URL", () => {
    FILTER_MOCKS.search = "status=approved&job=25-401";
    const { result } = renderHook(() => useInvoiceFilters());

    act(() => result.current.setFilter("job", "all"));

    expect(FILTER_MOCKS.push).toHaveBeenCalledWith("/accounting/invoices?status=approved");
  });

  it("accepts Documents as a dashboard status source of truth", () => {
    FILTER_MOCKS.search = "status=documents&docStatus=reviewed";
    const { result } = renderHook(() => useInvoiceFilters());

    expect(result.current.filters.status).toBe("documents");
  });

  it("preserves search when switching between dashboard tabs", () => {
    FILTER_MOCKS.search = "status=documents&panel=coi&search=acme";
    const { result } = renderHook(() => useInvoiceFilters());

    act(() => result.current.setFilter("status", "discarded"));

    expect(FILTER_MOCKS.push).toHaveBeenCalledWith(
      "/accounting/invoices?status=discarded&panel=coi&search=acme",
    );
  });

  it("migrates legacy Flagged links to a composable active-status filter", () => {
    FILTER_MOCKS.search = "status=flagged&search=acme";
    const { result } = renderHook(() => useInvoiceFilters());

    expect(result.current.filters.status).toBe("all");
    expect(result.current.filters.flagged).toBe(true);

    act(() => result.current.setFilter("flagged", undefined));

    expect(FILTER_MOCKS.push).toHaveBeenCalledWith(
      "/accounting/invoices?status=all&search=acme",
    );
  });

  it("serializes the Flagged control independently from the active status", () => {
    FILTER_MOCKS.search = "status=approved";
    const { result } = renderHook(() => useInvoiceFilters());

    act(() => result.current.setFilter("flagged", true));

    expect(FILTER_MOCKS.push).toHaveBeenCalledWith(
      "/accounting/invoices?status=approved&flagged=true",
    );
  });

  it("parses valid panel groups while retaining legacy classification links", () => {
    FILTER_MOCKS.search = "panel=lien-waiver&classification=custom-waiver";
    const { result } = renderHook(() => useInvoiceFilters());

    expect(result.current.filters.panel).toBe("lien-waiver");
    expect(result.current.filters.classification).toBe("custom-waiver");
  });

  it("ignores invalid panel groups", () => {
    FILTER_MOCKS.search = "panel=contract";
    const { result } = renderHook(() => useInvoiceFilters());

    expect(result.current.filters.panel).toBeUndefined();
  });
});
