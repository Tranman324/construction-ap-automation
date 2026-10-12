import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const PM = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  status: { running: false, lastRun: null, lastResult: null } as {
    running: boolean;
    lastRun: string | null;
    lastResult: { processed: number; queued: number; errors: number; failed?: boolean } | null;
  },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  keepPolling: false,
}));

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useRunPipeline: () => ({
    mutate: PM.mutate,
    isPending: PM.isPending,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  usePipelineStatus: (_pollingInterval?: number, keepPolling?: boolean) => {
    PM.keepPolling = Boolean(keepPolling);
    return { data: PM.status };
  },
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: {
    success: PM.toastSuccess,
    error: PM.toastError,
  },
}));

import { PipelineRunButton } from "@/modules/accounting/modules/invoices/components/dashboard/PipelineRunButton";

describe("PipelineRunButton", () => {
  beforeEach(() => {
    PM.mutate.mockReset();
    PM.toastSuccess.mockReset();
    PM.toastError.mockReset();
    PM.isPending = false;
    PM.status = { running: false, lastRun: null, lastResult: null };
    PM.keepPolling = false;
  });

  it("triggers the manual pipeline mutation and shows success feedback", async () => {
    const user = userEvent.setup();
    PM.mutate.mockImplementationOnce((
      _variables: undefined,
      options?: { onSuccess?: () => void },
    ) => {
      options?.onSuccess?.();
    });

    render(<PipelineRunButton />);

    await user.click(screen.getByRole("button", { name: "Scan Now" }));

    expect(PM.mutate).toHaveBeenCalledWith(undefined, expect.any(Object));
    expect(PM.toastSuccess).toHaveBeenCalledWith(
      "Pipeline started",
      expect.objectContaining({ description: "Checking the invoice inbox now." }),
    );
  });

  it("disables the control while the pipeline is running", () => {
    PM.status = { running: true, lastRun: null, lastResult: null };

    render(<PipelineRunButton />);

    expect(screen.getByRole("button", { name: "Scanning..." })).toBeDisabled();
  });

  it("treats a 409 as an already-running server run", async () => {
    const user = userEvent.setup();
    PM.mutate.mockImplementationOnce((_variables, options) => {
      options?.onError?.({ status: 409, message: "Pipeline is already running" });
    });

    const { rerender } = render(<PipelineRunButton />);
    await user.click(screen.getByRole("button", { name: "Scan Now" }));

    expect(PM.toastError).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Scanning..." })).toBeDisabled();

    PM.status = { running: true, lastRun: "run-1", lastResult: null };
    rerender(<PipelineRunButton />);
    expect(screen.getByRole("button", { name: "Scanning..." })).toBeDisabled();
  });

  it("refreshes once and announces the served result in a toast after running completes", async () => {
    const user = userEvent.setup();
    const onCompleted = vi.fn();
    PM.mutate.mockImplementationOnce((_variables, options) => {
      options?.onSuccess?.();
    });

    const { rerender } = render(<PipelineRunButton onCompleted={onCompleted} />);
    await user.click(screen.getByRole("button", { name: "Scan Now" }));

    PM.status = { running: true, lastRun: "run-2", lastResult: null };
    rerender(<PipelineRunButton onCompleted={onCompleted} />);

    PM.status = {
      running: false,
      lastRun: "run-2",
      lastResult: { processed: 31, queued: 33, errors: 0 },
    };
    rerender(<PipelineRunButton onCompleted={onCompleted} />);
    rerender(<PipelineRunButton onCompleted={onCompleted} />);

    expect(onCompleted).toHaveBeenCalledOnce();
    expect(PM.toastSuccess).toHaveBeenLastCalledWith(
      "Inbox scan complete",
      { description: "Processed 31 · queued 33 · errors 0" },
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan Now" })).toBeEnabled();
    expect(PM.keepPolling).toBe(false);
  });

  it("completes a fast run when lastRun changes before polling observes running", async () => {
    const user = userEvent.setup();
    const onCompleted = vi.fn();
    PM.status = {
      running: false,
      lastRun: "old-run",
      lastResult: { processed: 4, queued: 0, errors: 0 },
    };
    PM.mutate.mockImplementationOnce((_variables, options) => {
      options?.onSuccess?.();
    });

    const { rerender } = render(<PipelineRunButton onCompleted={onCompleted} />);
    await user.click(screen.getByRole("button", { name: "Scan Now" }));

    PM.status = {
      running: false,
      lastRun: "fast-run",
      lastResult: { processed: 0, queued: 0, errors: 0 },
    };
    rerender(<PipelineRunButton onCompleted={onCompleted} />);

    expect(onCompleted).toHaveBeenCalledOnce();
    expect(PM.toastSuccess).toHaveBeenLastCalledWith(
      "Inbox scan complete",
      { description: "Processed 0 · queued 0 · errors 0" },
    );
    expect(screen.getByRole("button", { name: "Scan Now" })).toBeEnabled();
    expect(PM.keepPolling).toBe(false);
  });

  it("shows an error toast when the run completes with a failed result", async () => {
    const user = userEvent.setup();
    const onCompleted = vi.fn();
    PM.mutate.mockImplementationOnce((_variables, options) => {
      options?.onSuccess?.();
    });

    const { rerender } = render(<PipelineRunButton onCompleted={onCompleted} />);
    await user.click(screen.getByRole("button", { name: "Scan Now" }));

    PM.status = {
      running: false,
      lastRun: "failed-run",
      lastResult: { processed: 0, queued: 0, errors: 0, failed: true },
    };
    rerender(<PipelineRunButton onCompleted={onCompleted} />);

    expect(PM.toastError).toHaveBeenCalledWith(
      "Inbox scan failed",
      expect.objectContaining({ description: expect.stringContaining("did not finish cleanly") }),
    );
    // "Pipeline started" toast only — no completion success toast.
    expect(PM.toastSuccess).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Scan Now" })).toBeEnabled();
    expect(PM.keepPolling).toBe(false);
  });

  it("completes after a 409 without observing running, once the concurrent run lands (A-7)", async () => {
    const user = userEvent.setup();
    const onCompleted = vi.fn();
    PM.status = {
      running: false,
      lastRun: "old-run",
      lastResult: { processed: 9, queued: 9, errors: 0 },
    };
    PM.mutate.mockImplementationOnce((_variables, options) => {
      options?.onError?.({ status: 409, message: "Pipeline is already running" });
    });

    const { rerender } = render(<PipelineRunButton onCompleted={onCompleted} />);
    await user.click(screen.getByRole("button", { name: "Scan Now" }));

    // The cached (pre-run) snapshot must not satisfy completion.
    expect(onCompleted).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Scanning..." })).toBeDisabled();

    // Concurrent run finishes before any poll observes running:true.
    PM.status = {
      running: false,
      lastRun: "concurrent-run",
      lastResult: { processed: 3, queued: 1, errors: 0 },
    };
    rerender(<PipelineRunButton onCompleted={onCompleted} />);

    expect(onCompleted).toHaveBeenCalledOnce();
    expect(PM.toastSuccess).toHaveBeenLastCalledWith(
      "Inbox scan complete",
      { description: "Processed 3 · queued 1 · errors 0" },
    );
    expect(screen.getByRole("button", { name: "Scan Now" })).toBeEnabled();
    expect(PM.keepPolling).toBe(false);
  });

  it("does not fabricate completion when status polling has not observed a running state", async () => {
    const user = userEvent.setup();
    const onCompleted = vi.fn();
    PM.mutate.mockImplementationOnce((_variables, options) => {
      options?.onSuccess?.();
    });

    PM.status = {
      running: false,
      lastRun: "old-run",
      lastResult: { processed: 99, queued: 99, errors: 1 },
    };
    const { rerender } = render(<PipelineRunButton onCompleted={onCompleted} />);
    await user.click(screen.getByRole("button", { name: "Scan Now" }));

    PM.status = {
      running: false,
      lastRun: "old-run",
      lastResult: { processed: 99, queued: 99, errors: 1 },
    };
    rerender(<PipelineRunButton onCompleted={onCompleted} />);

    expect(onCompleted).not.toHaveBeenCalled();
    expect(PM.toastSuccess).toHaveBeenCalledTimes(1);
  });
});
