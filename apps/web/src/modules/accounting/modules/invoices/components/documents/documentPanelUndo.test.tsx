import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeInvoice, makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";
import type { InvoiceUndoableAction } from "@/modules/accounting/modules/invoices/types/api";

const TM = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/modules/shared/lib/api", () => ({
  api: TM.api,
  isApiError: (error: unknown) => (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "message" in error
  ),
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: TM.toast,
}));

import {
  __resetRecentDocumentUndoTargetsForTests,
  getCurrentUndoableAction,
  isUndoTargetExpired,
  UNDO_WINDOW_MS,
  useDocumentPanelUndo,
  useRecentDocumentUndo,
} from "@/modules/accounting/modules/invoices/components/documents/documentPanelUndo";

const NOW = new Date("2026-07-03T12:05:00.000Z");

function isoMsAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function makeAction(overrides: Partial<InvoiceUndoableAction>): InvoiceUndoableAction {
  return {
    id: "action-1",
    type: "invoice.filed",
    timestamp: new Date().toISOString(),
    actor: { userId: "user-1", name: "Dana", role: "controller" },
    target: { type: "document", id: "doc-1", label: "Document" },
    undoable: true,
    undoneAt: null,
    undoneBy: null,
    summary: "Filed document",
    module: "invoices",
    severity: "info",
    ...overrides,
  };
}

beforeEach(() => {
  __resetRecentDocumentUndoTargetsForTests();
  TM.api.get.mockReset();
  TM.api.post.mockReset();
  TM.toast.error.mockReset();
  TM.toast.success.mockReset();
  TM.toast.warning.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("document panel undo", () => {
  it("selects the newest undoable action that has not already been undone", () => {
    const newest = makeAction({ id: "newest", timestamp: isoMsAgo(60_000) });
    const selected = getCurrentUndoableAction([
      makeAction({ id: "older", timestamp: isoMsAgo(120_000) }),
      makeAction({ id: "undone-newer", timestamp: isoMsAgo(10_000), undoneAt: isoMsAgo(5_000) }),
      makeAction({ id: "not-undoable", timestamp: isoMsAgo(5_000), undoable: false }),
      newest,
    ]);

    expect(selected).toBe(newest);
  });

  it("skips expired undoable actions when selecting the current action", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fresh = makeAction({ id: "fresh", timestamp: isoMsAgo(60_000) });
    const selected = getCurrentUndoableAction([
      makeAction({ id: "expired-newer", timestamp: isoMsAgo(UNDO_WINDOW_MS + 1_000) }),
      fresh,
    ]);

    expect(selected).toBe(fresh);
  });

  it("treats null and unparseable timestamps as not expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    expect(isUndoTargetExpired(null)).toBe(false);
    expect(isUndoTargetExpired("not-a-date")).toBe(false);
  });

  it("uses a strict 300 second undo boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    expect(isUndoTargetExpired(isoMsAgo(UNDO_WINDOW_MS - 1_000))).toBe(false);
    expect(isUndoTargetExpired(isoMsAgo(UNDO_WINDOW_MS))).toBe(false);
    expect(isUndoTargetExpired(isoMsAgo(UNDO_WINDOW_MS + 1_000))).toBe(true);
  });

  it("disables current undo affordance with an expired tooltip when only expired actions remain", async () => {
    TM.api.get.mockResolvedValueOnce({
      actions: [makeAction({ id: "expired-action", timestamp: isoMsAgo(UNDO_WINDOW_MS + 1_000) })],
    });
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useDocumentPanelUndo("doc-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.tooltip).toBe("Undo window expired."));

    expect(result.current.disabled).toBe(true);
    expect(result.current.onUndo).toBeUndefined();
  });

  it("keeps fresh current undo affordance enabled", async () => {
    TM.api.get.mockResolvedValueOnce({
      actions: [makeAction({ id: "fresh-action", timestamp: isoMsAgo(UNDO_WINDOW_MS - 1_000) })],
    });
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useDocumentPanelUndo("doc-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.disabled).toBe(false));

    expect(result.current.tooltip).toBe("Undo: Shelve");
  });

  it("labels current approval undo as Undo Approve", async () => {
    TM.api.get.mockResolvedValueOnce({
      actions: [makeAction({ id: "approve-action", type: "invoice.approved", timestamp: isoMsAgo(60_000) })],
    });
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useDocumentPanelUndo("doc-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.disabled).toBe(false));

    expect(result.current.label).toBe("Undo Approve");
    expect(result.current.tooltip).toBe("Revert to pending.");
  });

  it("keeps expired approval undo labeled while disabled", async () => {
    TM.api.get.mockResolvedValueOnce({
      actions: [makeAction({ id: "approve-action", type: "invoice.approved", timestamp: isoMsAgo(UNDO_WINDOW_MS + 1_000) })],
    });
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useDocumentPanelUndo("doc-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.tooltip).toBe("Undo window expired."));

    expect(result.current.label).toBe("Undo Approve");
    expect(result.current.disabled).toBe(true);
  });

  it("invokes the undo mutation and surfaces SharePoint cleanup warnings", async () => {
    TM.api.get.mockResolvedValueOnce({
      actions: [makeAction({ id: "file-action", summary: "Shelved" })],
    });
    TM.api.post.mockResolvedValueOnce({
      invoice: makeInvoice("doc-1", "Vendor"),
      undoneActionId: "file-action",
      sharePoint: {
        deleted: false,
        itemId: "sp-item-1",
        driveId: "drive-1",
        warning: "SharePoint copy could not be deleted.",
      },
    });
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useDocumentPanelUndo("doc-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.disabled).toBe(false));

    act(() => {
      result.current.onUndo?.();
    });

    await waitFor(() => {
      expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/doc-1/actions/file-action/undo");
    });
    expect(TM.toast.success).toHaveBeenCalledWith("Shelve undone", {
      description: "Document was returned to the queue.",
    });
    expect(TM.toast.warning).toHaveBeenCalledWith("SharePoint cleanup warning", {
      description: "SharePoint copy could not be deleted.",
    });
  });

  it("returns a disabled footer control when no current undoable action exists", async () => {
    TM.api.get.mockResolvedValueOnce({
      actions: [makeAction({ undoable: false })],
    });
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useDocumentPanelUndo("doc-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.tooltip).toBe("There is nothing to undo."));

    expect(result.current.disabled).toBe(true);
    expect(result.current.onUndo).toBeUndefined();
  });

  it("keeps a recent discard undo target available after moving to another document", async () => {
    TM.api.post.mockResolvedValueOnce({
      invoice: makeInvoice("discarded-doc", "Vendor"),
      undoneActionId: "discard-action",
    });
    const disabledControl = {
      disabled: true,
      pending: false,
      tooltip: "There is nothing to undo.",
    };
    const onUndoSuccess = vi.fn();
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(
      () => useRecentDocumentUndo(disabledControl, { onUndoSuccess }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.rememberAction(
        "discarded-doc",
        {
          actionId: "discard-action",
          type: "discard",
          undoable: true,
          timestamp: isoMsAgo(60_000),
          undoEndpoint: "/api/invoices/discarded-doc/undiscard",
        },
        "Discard",
        "discarded.pdf",
      );
    });

    expect(result.current.undoControl.disabled).toBe(false);
    expect(result.current.undoControl.tooltip).toBe("Undo: Discard");

    act(() => {
      result.current.undoControl.onUndo?.();
    });

    await waitFor(() => {
      expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/discarded-doc/actions/discard-action/undo");
    });
    expect(TM.toast.success).toHaveBeenCalledWith("Discard undone", {
      description: "discarded.pdf was restored.",
    });
    expect(onUndoSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: "discarded-doc", actionId: "discard-action" }),
      expect.objectContaining({ undoneActionId: "discard-action" }),
    );
  });

  it("keeps a recent discard undo target available after the route remounts", () => {
    const disabledControl = {
      disabled: true,
      pending: false,
      tooltip: "There is nothing to undo.",
    };
    const { Wrapper } = makeMutationWrapper();
    const firstRoute = renderHook(
      () => useRecentDocumentUndo(disabledControl),
      { wrapper: Wrapper },
    );

    act(() => {
      firstRoute.result.current.rememberAction(
        "discarded-doc",
        {
          actionId: "discard-action",
          type: "discard",
          undoable: true,
          timestamp: isoMsAgo(60_000),
          undoEndpoint: "/api/invoices/discarded-doc/undiscard",
        },
        "Discard",
      );
    });

    firstRoute.unmount();

    const secondRoute = renderHook(
      () => useRecentDocumentUndo(disabledControl),
      { wrapper: Wrapper },
    );

    expect(secondRoute.result.current.undoControl.disabled).toBe(false);
    expect(secondRoute.result.current.undoControl.tooltip).toBe("Undo: Discard");
  });

  it("does not offer expired recent undo targets and prunes them from the shared store", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const disabledControl = {
      disabled: true,
      pending: false,
      tooltip: "There is nothing to undo.",
    };
    const { Wrapper } = makeMutationWrapper();
    const firstRoute = renderHook(
      () => useRecentDocumentUndo(disabledControl),
      { wrapper: Wrapper },
    );

    act(() => {
      firstRoute.result.current.rememberAction(
        "expired-doc",
        {
          actionId: "expired-action",
          type: "discard",
          undoable: true,
          timestamp: isoMsAgo(UNDO_WINDOW_MS + 1_000),
        },
        "Discard",
      );
    });

    expect(firstRoute.result.current.undoControl.disabled).toBe(true);
    expect(firstRoute.result.current.undoControl.tooltip).toBe("There is nothing to undo.");

    firstRoute.unmount();
    const secondRoute = renderHook(
      () => useRecentDocumentUndo(disabledControl),
      { wrapper: Wrapper },
    );

    expect(secondRoute.result.current.undoControl.disabled).toBe(true);
    expect(secondRoute.result.current.undoControl.tooltip).toBe("There is nothing to undo.");
  });

  it("offers recent undo targets inside the undo window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const disabledControl = {
      disabled: true,
      pending: false,
      tooltip: "There is nothing to undo.",
    };
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(
      () => useRecentDocumentUndo(disabledControl),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.rememberAction(
        "fresh-doc",
        {
          actionId: "fresh-action",
          type: "discard",
          undoable: true,
          timestamp: isoMsAgo(UNDO_WINDOW_MS - 1_000),
        },
        "Discard",
      );
    });

    expect(result.current.undoControl.disabled).toBe(false);
    expect(result.current.undoControl.tooltip).toBe("Undo: Discard");
  });

  it("does not remember non-undoable action metadata", () => {
    const disabledControl = {
      disabled: true,
      pending: false,
      tooltip: "There is nothing to undo.",
    };
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(
      () => useRecentDocumentUndo(disabledControl),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.rememberAction(
        "noop-edit-doc",
        {
          actionId: null,
          type: "edit",
          undoable: false,
        },
        "Invoice edited",
      );
    });

    expect(result.current.undoControl.disabled).toBe(true);
    expect(result.current.undoControl.tooltip).toBe("There is nothing to undo.");
  });

  it("keeps earlier discarded documents available after undoing the latest discard", async () => {
    TM.api.post
      .mockResolvedValueOnce({
        invoice: makeInvoice("second-discarded-doc", "Vendor"),
        undoneActionId: "second-discard-action",
      })
      .mockResolvedValueOnce({
        invoice: makeInvoice("first-discarded-doc", "Vendor"),
        undoneActionId: "first-discard-action",
      });
    const disabledControl = {
      disabled: true,
      pending: false,
      tooltip: "There is nothing to undo.",
    };
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(
      () => useRecentDocumentUndo(disabledControl),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.rememberAction(
        "first-discarded-doc",
        {
          actionId: "first-discard-action",
          type: "discard",
          undoable: true,
          timestamp: isoMsAgo(120_000),
        },
        "Discard",
      );
      result.current.rememberAction(
        "second-discarded-doc",
        {
          actionId: "second-discard-action",
          type: "discard",
          undoable: true,
          timestamp: isoMsAgo(60_000),
        },
        "Discard",
      );
    });

    act(() => {
      result.current.undoControl.onUndo?.();
    });

    await waitFor(() => {
      expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/second-discarded-doc/actions/second-discard-action/undo");
    });

    act(() => {
      result.current.undoControl.onUndo?.();
    });

    await waitFor(() => {
      expect(TM.api.post).toHaveBeenCalledWith("/api/invoices/first-discarded-doc/actions/first-discard-action/undo");
    });
  });

  it.each([
    {
      error: { message: "Expired", status: 410, code: "UNDO_WINDOW_EXPIRED" },
      title: "Undo window expired",
      description: "Footer undo is available for five minutes after the action.",
    },
    {
      error: { message: "Stale", status: 409, code: "STATE_CHANGED_SINCE_ACTION" },
      title: "Undo no longer safe",
      description: "The document changed since that action, so undo is no longer safe.",
    },
  ])("shows the $error.code toast path", async ({ error, title, description }) => {
    TM.api.get.mockResolvedValueOnce({
      actions: [makeAction({ id: "file-action" })],
    });
    TM.api.post.mockRejectedValueOnce(error);
    const { Wrapper } = makeMutationWrapper();
    const { result } = renderHook(() => useDocumentPanelUndo("doc-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.disabled).toBe(false));

    act(() => {
      result.current.onUndo?.();
    });

    await waitFor(() => {
      expect(TM.toast.error).toHaveBeenCalledWith(title, { description });
    });
  });
});
