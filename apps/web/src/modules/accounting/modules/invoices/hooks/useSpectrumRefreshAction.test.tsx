import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpectrumRefreshStatus } from "@/modules/accounting/modules/invoices/types/api";

const M = vi.hoisted(() => ({
  allowed: true,
  isPending: false,
  status: { running: false, lastRefresh: null, lastResult: null } as SpectrumRefreshStatus | undefined,
  triggerRefresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => M.allowed,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useSpectrumRefreshStatus: vi.fn((_pollingInterval?: number, options?: { enabled?: boolean }) => ({
    data: options?.enabled === false ? undefined : M.status,
  })),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useRefreshSpectrum: () => ({ mutate: M.triggerRefresh, isPending: M.isPending }),
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: {
    success: M.toastSuccess,
    error: M.toastError,
  },
}));

import { DocumentActionsDropdown } from "@/modules/accounting/modules/invoices/components/documents/DocumentActionsDropdown";
import { useSpectrumRefreshAction } from "@/modules/accounting/modules/invoices/hooks/useSpectrumRefreshAction";
import { useSpectrumRefreshStatus } from "@/modules/accounting/modules/invoices/hooks/queries";

function SpectrumActionHarness({ enabled = true }: { enabled?: boolean }) {
  const action = useSpectrumRefreshAction({ enabled });
  return <DocumentActionsDropdown actions={action ? [action] : []} />;
}

function renderWithClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const view = render(
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>,
  );

  return { ...view, invalidateSpy, queryClient };
}

describe("useSpectrumRefreshAction", () => {
  beforeEach(() => {
    M.allowed = true;
    M.isPending = false;
    M.status = { running: false, lastRefresh: null, lastResult: null };
    M.triggerRefresh.mockReset();
    M.toastSuccess.mockReset();
    M.toastError.mockReset();
  });

  it("omits the action without the Spectrum submit permission", () => {
    M.allowed = false;

    renderWithClient(<SpectrumActionHarness />);

    expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
    expect(vi.mocked(useSpectrumRefreshStatus)).toHaveBeenLastCalledWith(undefined, { enabled: false });
  });

  it("omits the action and disables status fetching when the surface is not eligible", () => {
    renderWithClient(<SpectrumActionHarness enabled={false} />);

    expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
    expect(vi.mocked(useSpectrumRefreshStatus)).toHaveBeenLastCalledWith(undefined, { enabled: false });
  });

  it("triggers the Spectrum refresh mutation from the dropdown", async () => {
    const user = userEvent.setup();
    M.triggerRefresh.mockImplementation((_variables: unknown, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });

    renderWithClient(<SpectrumActionHarness />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Sync Spectrum" }));

    expect(M.triggerRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows pending state while the refresh mutation is running", async () => {
    const user = userEvent.setup();
    M.isPending = true;

    renderWithClient(<SpectrumActionHarness />);

    await user.click(screen.getByRole("button", { name: "Actions" }));

    expect(screen.getByRole("menuitem", { name: "Syncing Spectrum" })).toHaveAttribute("data-disabled");
  });

  it("toasts refresh failures from the dropdown action", async () => {
    const user = userEvent.setup();
    M.triggerRefresh.mockImplementation((
      _variables: unknown,
      options?: { onError?: (error: Error & { status?: number }) => void },
    ) => {
      options?.onError?.(new Error("Vendor service unavailable"));
    });

    renderWithClient(<SpectrumActionHarness />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Sync Spectrum" }));

    expect(M.toastError).toHaveBeenCalledWith("Spectrum sync failed", {
      description: "Vendor service unavailable",
    });
  });

  it("toasts completion, invalidates Spectrum-backed caches, and starts cooldown after polling finishes", async () => {
    const user = userEvent.setup();
    M.status = { running: true, lastRefresh: null, lastResult: null };
    const { rerender, invalidateSpy, queryClient } = renderWithClient(<SpectrumActionHarness />);

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Syncing Spectrum" })).toBeInTheDocument());
    await user.keyboard("{Escape}");

    M.status = {
      running: false,
      lastRefresh: "2026-07-02T12:00:00.000Z",
      lastResult: {
        vendors: 12,
        jobs: 34,
        subcontracts: 5,
        durationMs: 450,
      },
    };
    rerender(
      <QueryClientProvider client={queryClient}>
        <SpectrumActionHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(M.toastSuccess).toHaveBeenCalledWith("Spectrum sync complete", {
      description: "12 vendors · 34 jobs · 5 subcontracts",
    }));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["vendors"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["jobs"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["subcontracts"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["routingCodes"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["phaseCodes"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["phase-options"] });

    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem", { name: "Sync Spectrum (60s)" })).toHaveAttribute("data-disabled");
  });
});
