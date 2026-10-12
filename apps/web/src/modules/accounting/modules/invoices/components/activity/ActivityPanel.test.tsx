import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { useActivity as useActivityQuery } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { useCreateComment as useCreateCommentMutation } from "@/modules/accounting/modules/invoices/hooks/mutations";
import type { ActivityResponse } from "@/modules/accounting/modules/invoices/types/api";

type ActivityQueryMockResult = {
  data: ActivityResponse | undefined;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};
type CreateCommentVariables = Parameters<ReturnType<typeof useCreateCommentMutation>["mutateAsync"]>[0];
type CreateCommentResponse = Awaited<ReturnType<ReturnType<typeof useCreateCommentMutation>["mutateAsync"]>>;

const collaborationMocks = vi.hoisted(() => ({
  useActivity: vi.fn<(...args: Parameters<typeof useActivityQuery>) => ActivityQueryMockResult>(() => ({ data: { entries: [], pagination: { limit: 50, offset: 0, total: 0, hasMore: false } }, isFetching: false, refetch: vi.fn() })),
  useForwardDefaults: vi.fn(() => ({ data: { defaultRecipients: [{ userId: "default-user", name: "Default Recipient", email: "default@example.test" }] } })),
  useReplyRecipient: vi.fn(() => ({ data: undefined, isFetching: false, error: null })),
  useCollaborationDirectory: vi.fn(() => ({ data: [] })),
  useInboundAttachments: vi.fn(() => ({ data: undefined, isFetching: false, error: null })),
  useCreateComment: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMarkActivityViewed: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ priorActivityViewedAt: "2026-09-16T11:00:00.000Z", unreadReplies: 0, unreadComments: 0 }) })),
  useReplyToDocument: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useForwardDocument: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  usePromoteInboundAttachment: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined })),
  useAuth: vi.fn(() => ({ user: { userId: "current-user", name: "Current User" } })),
}));
const activityFeedMock = vi.hoisted(() => ({ ActivityFeed: vi.fn((props: unknown) => { void props; return null; }) }));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useActivity: collaborationMocks.useActivity,
  useForwardDefaults: collaborationMocks.useForwardDefaults,
  useReplyRecipient: collaborationMocks.useReplyRecipient,
  useCollaborationDirectory: collaborationMocks.useCollaborationDirectory,
  useInboundAttachments: collaborationMocks.useInboundAttachments,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useCreateComment: collaborationMocks.useCreateComment,
  useMarkActivityViewed: collaborationMocks.useMarkActivityViewed,
  useReplyToDocument: collaborationMocks.useReplyToDocument,
  useForwardDocument: collaborationMocks.useForwardDocument,
  usePromoteInboundAttachment: collaborationMocks.usePromoteInboundAttachment,
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: collaborationMocks.useAuth,
}));

vi.mock("./ActivityFeed", () => activityFeedMock);

import { ActivityPanel, collaborationActionsFor, requestCollaborationCompose } from "./ActivityPanel";
import type { InvoiceEmail } from "@/modules/accounting/modules/invoices/types/invoice";
import { expectDomOrder, expectNoPositiveTabIndex } from "../tabOrderAssertions";

describe("ActivityPanel collaboration entry points", () => {
  describe("Activity composer tab order", () => {
    it("keeps mode tabs before the comment composer and send action", () => {
      const { container } = render(<ActivityPanel documentId="doc-1" active serverBacked canComment canEmail email={{ messageId: "msg-1", from: "sender@example.test", subject: "Subject", receivedAt: "2026-09-01T12:00:00.000Z" }} />);
      const order = [
        screen.getByRole("tab", { name: "Comment" }),
        screen.getByRole("tab", { name: "Reply" }),
        screen.getByRole("tab", { name: "Forward" }),
        screen.getByRole("textbox", { name: "Comment" }),
        screen.getByRole("button", { name: "Comment" }),
      ];
      expectDomOrder(order);
      expectNoPositiveTabIndex(container);
    });
  });

  beforeEach(() => {
    window.localStorage.clear();
    activityFeedMock.ActivityFeed.mockClear();
    collaborationMocks.useActivity.mockReturnValue({ data: { entries: [], pagination: { limit: 50, offset: 0, total: 0, hasMore: false } }, isFetching: false, refetch: vi.fn() });
    collaborationMocks.useCreateComment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    collaborationMocks.useInboundAttachments.mockReturnValue({ data: undefined, isFetching: false, error: null });
    collaborationMocks.usePromoteInboundAttachment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, variables: undefined });
    collaborationMocks.useAuth.mockClear();
    collaborationMocks.useAuth.mockImplementation(() => ({ user: { userId: "current-user", name: "Current User" } }));
  });

  it("renders the legacy fallback without requiring an auth context", () => {
    collaborationMocks.useAuth.mockImplementation(() => {
      throw new Error("fallback ActivityPanel must not read auth");
    });

    expect(() => render(<ActivityPanel documentId="doc-1" active={false} fallbackEntries={[]} />)).not.toThrow();
    expect(collaborationMocks.useAuth).not.toHaveBeenCalled();
  });

  it("keeps only an unobtrusive view-only hint when no collaboration action is permitted", () => {
    render(<ActivityPanel documentId="doc-1" active={false} fallbackEntries={[]} readOnly />);

    expect(screen.queryByRole("heading", { name: "Activity" })).not.toBeInTheDocument();
    expect(screen.getByText("Activity is view only.")).toBeInTheDocument();
  });

  it("keeps Reply and Forward in the Actions menu and disables reply without source mail", () => {
    const actions = collaborationActionsFor("doc-1", null);
    expect(actions.map((action) => action.label)).toEqual(["Reply", "Forward"]);
    expect(actions[0]?.disabled).toBe(true);
  });

  it("scopes compose requests to a document", () => {
    const listener = vi.fn();
    window.addEventListener("document-collaboration-compose", listener);
    requestCollaborationCompose("doc-1", "forward");
    window.removeEventListener("document-collaboration-compose", listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ documentId: "doc-1", mode: "forward" });
  });

  it("passes the declared document family through viewed and comment calls", async () => {
    const markViewed = vi.fn().mockResolvedValue({ priorActivityViewedAt: "2026-09-16T11:00:00.000Z", unreadReplies: 0, unreadComments: 0 });
    const createComment = vi.fn().mockResolvedValue({ comment: { kind: "comment", id: "comment-1", documentId: "doc-1", body: "Hello", timestamp: "2026-09-16T12:00:00.000Z", actor: { name: "You" } } });
    collaborationMocks.useMarkActivityViewed.mockReturnValue({ mutateAsync: markViewed });
    collaborationMocks.useCreateComment.mockReturnValue({ mutateAsync: createComment, isPending: false });

    const user = userEvent.setup();
    render(<ActivityPanel documentId="doc-1" active serverBacked canComment routeFamily="document" />);

    await waitFor(() => expect(markViewed).toHaveBeenCalledWith({ id: "doc-1", routeFamily: "document" }));
    expect(collaborationMocks.useActivity).toHaveBeenCalledWith("doc-1", { offset: 0, routeFamily: "document" });
    await user.type(screen.getByRole("textbox", { name: "Comment" }), "Hello");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => expect(createComment).toHaveBeenCalledWith({ id: "doc-1", routeFamily: "document", payload: { body: "Hello" } }));
  });

  it.each(["invoice", "document"] as const)("does not render the legacy %s audit fallback while canonical Activity data is loading", (routeFamily) => {
    const legacyEntry = { id: "legacy-entry", action: "invoice.commented", actor: "legacy@example.test", createdAt: "2026-09-16T12:00:00.000Z", changes: {} };
    collaborationMocks.useActivity.mockReturnValue({ data: undefined, isFetching: true, refetch: vi.fn() });

    const { rerender } = render(<ActivityPanel documentId="doc-1" active serverBacked canComment routeFamily={routeFamily} fallbackEntries={[legacyEntry]} />);

    expect(screen.getByRole("status", { name: "Loading activity" })).toBeInTheDocument();
    expect(activityFeedMock.ActivityFeed).not.toHaveBeenCalled();

    const canonical = { kind: "comment" as const, id: "comment-1", documentId: "doc-1", body: "Canonical comment", timestamp: "2026-09-16T12:00:01.000Z", actor: { name: "Canonical User" } };
    collaborationMocks.useActivity.mockReturnValue({ data: { entries: [canonical], pagination: { limit: 50, offset: 0, total: 1, hasMore: false } }, isFetching: false, refetch: vi.fn() });
    rerender(<ActivityPanel documentId="doc-1" active serverBacked canComment routeFamily={routeFamily} fallbackEntries={[legacyEntry]} />);

    expect(screen.queryByRole("status", { name: "Loading activity" })).not.toBeInTheDocument();
    const props = activityFeedMock.ActivityFeed.mock.calls.at(-1)?.[0] as { entries: typeof canonical[] };
    expect(props.entries).toEqual([canonical]);
    expect(props.entries).not.toContainEqual(expect.objectContaining({ id: "legacy-entry" }));
  });

  it.each(["invoice", "document"] as const)("keeps a posting %s comment in the composer until the canonical response arrives", async (routeFamily) => {
    let resolveComment: ((value: CreateCommentResponse) => void) | undefined;
    const createComment = vi.fn<(variables: CreateCommentVariables) => Promise<CreateCommentResponse>>(() => new Promise<CreateCommentResponse>((resolve) => { resolveComment = resolve; }));
    const commentMutation = { mutateAsync: createComment, isPending: false };
    collaborationMocks.useCreateComment.mockReturnValue(commentMutation);

    const user = userEvent.setup();
    const { rerender } = render(<ActivityPanel documentId="doc-1" active serverBacked canComment routeFamily={routeFamily} />);
    await user.type(screen.getByRole("textbox", { name: "Comment" }), "Hello");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    commentMutation.isPending = true;

    await waitFor(() => {
      rerender(<ActivityPanel documentId="doc-1" active serverBacked canComment routeFamily={routeFamily} />);
      const props = activityFeedMock.ActivityFeed.mock.calls.at(-1)?.[0] as { entries: Array<{ body?: string; actor?: { name?: string } }>; optimisticEntries?: unknown };
      expect(props.entries).not.toContainEqual(expect.objectContaining({ body: "Hello" }));
      expect(props.optimisticEntries).toBeUndefined();
      expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue("Hello");
      expect(screen.getByRole("button", { name: "Posting…" })).toBeInTheDocument();
    });
    const canonical = { kind: "comment" as const, id: "comment-1", documentId: "doc-1", body: "Hello", timestamp: "2026-09-16T12:00:01.000Z", actor: { userId: "canonical-user", name: "Dana Canonical", avatarUrl: "/avatar" } };
    resolveComment?.({ comment: canonical });
    commentMutation.isPending = false;
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue(""));
    collaborationMocks.useActivity.mockReturnValue({ data: { entries: [canonical], pagination: { limit: 50, offset: 0, total: 1, hasMore: false } }, isFetching: false, refetch: vi.fn() });
    rerender(<ActivityPanel documentId="doc-1" active serverBacked canComment routeFamily={routeFamily} />);

    await waitFor(() => {
      const props = activityFeedMock.ActivityFeed.mock.calls.at(-1)?.[0] as { entries: typeof canonical[]; newEntryIds?: ReadonlySet<string> };
      const canonicalRows = props.entries.filter((entry) => entry.id === "comment-1" && entry.actor.name === "Dana Canonical");
      expect(canonicalRows).toHaveLength(1);
      expect(props.newEntryIds).toEqual(new Set(["comment-1"]));
    });
    expect(createComment).toHaveBeenCalledWith({ id: "doc-1", routeFamily, payload: { body: "Hello" } });
  });

  it("keeps the comment draft when the server rejects it", async () => {
    const createComment = vi.fn().mockRejectedValue({ status: 422, message: "Comment rejected" });
    collaborationMocks.useCreateComment.mockReturnValue({ mutateAsync: createComment, isPending: false });
    const user = userEvent.setup();
    render(<ActivityPanel documentId="doc-1" active serverBacked canComment routeFamily="document" />);

    await user.type(screen.getByRole("textbox", { name: "Comment" }), "Hello");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Your text is still here.");
      expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue("Hello");
    });
  });

  it.each(["invoice", "document"] as const)("disables every %s composer action when the panel is read-only or in Trash", (routeFamily) => {
    render(<ActivityPanel documentId="doc-1" active serverBacked canComment canEmail readOnly isTrash routeFamily={routeFamily} />);

    expect(screen.queryByRole("tab", { name: "Comment" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Reply" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Forward" })).toBeDisabled();
    expect(screen.getByText("Activity is view only.")).toBeInTheDocument();
  });

  it("removes Reply and Forward from Actions when collaboration is locked", () => {
    expect(collaborationActionsFor("doc-1", null, { canEmail: true, readOnly: true })).toEqual([]);
    expect(collaborationActionsFor("doc-1", null, { canEmail: true, isTrash: true })).toEqual([]);
  });

  it("opens the requested email composer mode when the Activity panel mounts after a header action", async () => {
    const email: InvoiceEmail = { messageId: "message-1", from: "sender@example.test", subject: "Synthetic subject", receivedAt: "2026-09-16T12:00:00.000Z" };
    render(<ActivityPanel documentId="doc-1" active serverBacked canEmail email={email} composeRequest={{ mode: "forward", sequence: 1 }} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: "Forward" })).toHaveAttribute("aria-selected", "true"));
  });

  it("passes the authenticated user to ActivityFeed for unread ownership", async () => {
    render(<ActivityPanel documentId="doc-1" active serverBacked />);

    await waitFor(() => expect(activityFeedMock.ActivityFeed.mock.calls.some(([props]) => (props as { currentUser?: { userId?: string } } | undefined)?.currentUser?.userId === "current-user")).toBe(true));
  });

  it.each(["invoice", "document"] as const)("passes the declared %s family through email defaults and mutations", async (routeFamily) => {
    const markViewed = vi.fn().mockResolvedValue({ priorActivityViewedAt: "2026-09-16T11:00:00.000Z", unreadReplies: 0, unreadComments: 0 });
    const refetch = vi.fn();
    const reply = vi.fn().mockResolvedValue({ sent: true });
    const forward = vi.fn().mockResolvedValue({ sent: true });
    collaborationMocks.useMarkActivityViewed.mockReturnValue({ mutateAsync: markViewed });
    collaborationMocks.useForwardDefaults.mockReturnValue({ data: { defaultRecipients: [{ userId: "user-1", name: "Synthetic Recipient", email: "recipient@example.test" }] } });
    collaborationMocks.useReplyToDocument.mockReturnValue({ mutateAsync: reply, isPending: false });
    collaborationMocks.useForwardDocument.mockReturnValue({ mutateAsync: forward, isPending: false });
    collaborationMocks.useActivity.mockReturnValue({ data: { entries: [], pagination: { limit: 50, offset: 0, total: 0, hasMore: false } }, isFetching: false, refetch });

    const user = userEvent.setup();
    const email: InvoiceEmail = { messageId: "message-1", from: "sender@example.test", subject: "Synthetic subject", receivedAt: "2026-09-16T12:00:00.000Z" };
    render(<ActivityPanel documentId="doc-1" active serverBacked canEmail routeFamily={routeFamily} email={email} />);

    await waitFor(() => expect(collaborationMocks.useForwardDefaults).toHaveBeenCalledWith("doc-1", { enabled: false, routeFamily }));
    await user.click(screen.getByRole("tab", { name: "Reply" }));
    await user.type(screen.getByRole("textbox", { name: "Reply message" }), "Reply");
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(reply).toHaveBeenCalledWith({ id: "doc-1", routeFamily, payload: { body: "Reply" } }));

    await user.click(screen.getByRole("tab", { name: "Forward" }));
    await user.type(screen.getByRole("textbox", { name: "Forward message" }), "Forward");
    await user.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(forward).toHaveBeenCalledWith({ id: "doc-1", routeFamily, payload: { recipients: ["user-1"], body: "Forward" } }));
  });
});
