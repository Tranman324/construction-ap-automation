import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborationComposer } from "./CollaborationComposer";

const email = { messageId: "message-1", from: "vendor@example.com", subject: "Invoice", receivedAt: "2026-09-16T12:00:00Z" };
const defaultRecipient = { userId: "pm-1", name: "Sarah Chen", email: "sarah@example.com" };
const teammate = { userId: "eng-1", name: "Priya Raghavan", email: "priya@example.com" };

function renderComposer(overrides: Partial<React.ComponentProps<typeof CollaborationComposer>> = {}) {
  return render(
    <CollaborationComposer
      mode="comment"
      email={null}
      recipients={[]}
      canComment
      canEmail
      onModeChange={vi.fn()}
      onComment={vi.fn(async () => undefined)}
      onReply={vi.fn(async () => undefined)}
      onForward={vi.fn(async () => undefined)}
      {...overrides}
    />,
  );
}

describe("CollaborationComposer", () => {
  beforeEach(() => window.localStorage.clear());

  it("posts comments with Enter, preserves Shift+Enter, and leaves Command+Enter alone", async () => {
    const onComment = vi.fn(async () => undefined);
    renderComposer({ onComment });
    const input = screen.getByRole("textbox", { name: "Comment" });
    fireEvent.change(input, { target: { value: "Follow up" } });
    const shiftEnter = createEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent(input, shiftEnter);
    expect(onComment).not.toHaveBeenCalled();
    expect(shiftEnter.defaultPrevented).toBe(false);
    const commandEnter = createEvent.keyDown(input, { key: "Enter", metaKey: true });
    fireEvent(input, commandEnter);
    expect(onComment).not.toHaveBeenCalled();
    expect(commandEnter.defaultPrevented).toBe(false);
    const enter = createEvent.keyDown(input, { key: "Enter" });
    fireEvent(input, enter);
    expect(enter.defaultPrevented).toBe(true);
    await waitFor(() => expect(onComment).toHaveBeenCalledWith("Follow up"));
  });

  it("uses one bordered comment-entry row for the avatar, editor, shortcut, and submit button", () => {
    renderComposer({ currentUser: { name: "Avery Cole", image: "https://example.test/avery.png" } });

    const composer = screen.getByLabelText("Collaboration composer");
    const row = screen.getByTestId("comment-composer");
    expect(composer).toHaveClass("rounded-xl", "border");
    expect(composer).toContainElement(screen.getByRole("tab", { name: "Comment" }));
    expect(composer).toContainElement(row);
    expect(row).toHaveClass("rounded-lg", "border", "focus-within:border-ring", "focus-within:ring-[3px]");
    expect(screen.getByRole("img", { name: "Avery Cole" })).toBeInTheDocument();
    expect(row).toContainElement(screen.getByRole("img", { name: "Avery Cole" }));
    const input = screen.getByRole("textbox", { name: "Comment" });
    expect(row).toContainElement(input);
    expect(input).toHaveAttribute("rows", "1");
    expect(input).toHaveClass("min-h-0", "resize-none", "border-0");
    expect(row).toHaveTextContent("↵ post · ⇧↵ line");
    expect(row).toContainElement(screen.getByRole("button", { name: "Comment" }));
    expect(screen.queryByText(/0\/2000/)).not.toBeInTheDocument();
  });

  it("does not offer Reply as an active action when there is no source email", () => {
    renderComposer({ mode: null, canComment: false });
    expect(screen.getByRole("tab", { name: "Reply" })).toBeDisabled();
    expect(screen.getByText(/Commenting is unavailable/)).toBeInTheDocument();
  });

  it("visibly selects email modes and cancels back to the comment destination", () => {
    const onModeChange = vi.fn();
    const { rerender } = renderComposer({ mode: "reply", email, onModeChange });
    const replyTab = screen.getByRole("tab", { name: "Reply" });
    expect(replyTab).toHaveAttribute("aria-selected", "true");
    expect(replyTab).toHaveClass("bg-muted");

    fireEvent.change(screen.getByRole("textbox", { name: "Reply message" }), { target: { value: "Discard this reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onModeChange).toHaveBeenCalledWith("comment");

    rerender(<CollaborationComposer mode="comment" email={email} recipients={[]} canComment canEmail onModeChange={onModeChange} onComment={vi.fn(async () => undefined)} onReply={vi.fn(async () => undefined)} onForward={vi.fn(async () => undefined)} />);
    expect(screen.getByRole("tab", { name: "Comment" })).toHaveClass("bg-muted");
    rerender(<CollaborationComposer mode="reply" email={email} recipients={[]} canComment canEmail onModeChange={onModeChange} onComment={vi.fn(async () => undefined)} onReply={vi.fn(async () => undefined)} onForward={vi.fn(async () => undefined)} />);
    expect(screen.getByRole("textbox", { name: "Reply message" })).toHaveValue("");
  });

  it("uses a 2,000-character comment cap and a 5,000-character email cap", () => {
    const onComment = vi.fn(async () => undefined);
    const onReply = vi.fn(async () => undefined);
    const { rerender } = renderComposer({ onComment });
    const comment = screen.getByRole("textbox", { name: "Comment" });
    expect(comment).toHaveAttribute("maxLength", "2000");
    fireEvent.change(comment, { target: { value: "x".repeat(2_001) } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(onComment).not.toHaveBeenCalled();

    rerender(
      <CollaborationComposer
        mode="reply"
        email={email}
        recipients={[]}
        canComment
        canEmail
        onModeChange={vi.fn()}
        onComment={onComment}
        onReply={onReply}
        onForward={vi.fn(async () => undefined)}
      />,
    );
    const reply = screen.getByRole("textbox", { name: "Reply message" });
    expect(reply).toHaveAttribute("maxLength", "5000");
    fireEvent.change(reply, { target: { value: "x".repeat(5_001) } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(onReply).not.toHaveBeenCalled();
  });

  it("supports removable forward defaults and keyboard directory chips", () => {
    renderComposer({ mode: "forward", recipients: [defaultRecipient], directory: [defaultRecipient, teammate] });
    expect(screen.getByText("Sarah Chen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Sarah Chen" }));
    expect(screen.queryByText("Sarah Chen")).not.toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Forward to" });
    fireEvent.change(input, { target: { value: "Priya" } });
    expect(screen.getByRole("option", { name: /Priya Raghavan/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Priya Raghavan")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "No match" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
  });

  it("blocks an empty forward after removing the final recipient", () => {
    const onForward = vi.fn(async () => undefined);
    renderComposer({ mode: "forward", recipients: [defaultRecipient], onForward });

    fireEvent.click(screen.getByRole("button", { name: "Remove Sarah Chen" }));

    const submit = screen.getByRole("button", { name: "Forward" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onForward).not.toHaveBeenCalled();
  });

  it("sends replies only with Command+Shift+Enter and forwards only with Ctrl+Shift+Enter", async () => {
    const onReply = vi.fn(async () => undefined);
    const { rerender } = renderComposer({ mode: "reply", email, onReply });
    const reply = screen.getByRole("textbox", { name: "Reply message" });
    fireEvent.change(reply, { target: { value: "Reply body" } });
    fireEvent.keyDown(reply, { key: "Enter" });
    fireEvent.keyDown(reply, { key: "Enter", metaKey: true });
    fireEvent.keyDown(reply, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(reply, { key: "Enter", metaKey: true, shiftKey: true, altKey: true });
    expect(onReply).not.toHaveBeenCalled();
    fireEvent.keyDown(reply, { key: "Enter", metaKey: true, shiftKey: true });
    await waitFor(() => expect(onReply).toHaveBeenCalledWith("Reply body", expect.any(String)));
    expect(screen.getByText(/⌘⇧↵ \/ Ctrl⇧↵ to send/)).toBeInTheDocument();

    const onForward = vi.fn(async () => undefined);
    rerender(
      <CollaborationComposer
        mode="forward"
        email={email}
        recipients={[defaultRecipient]}
        canComment
        canEmail
        onModeChange={vi.fn()}
        onComment={vi.fn(async () => undefined)}
        onReply={onReply}
        onForward={onForward}
      />,
    );
    const forward = screen.getByRole("textbox", { name: "Forward message" });
    fireEvent.change(forward, { target: { value: "Forward body" } });
    fireEvent.keyDown(forward, { key: "Enter", ctrlKey: true });
    expect(onForward).not.toHaveBeenCalled();
    fireEvent.keyDown(forward, { key: "Enter", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(onForward).toHaveBeenCalledWith([defaultRecipient.userId], "Forward body", expect.any(String)));
  });

  it("defaults to the first candidate for a blocked reply sender and sends without an explicit pick", async () => {
    const onReply = vi.fn(async () => undefined);
    renderComposer({ mode: "reply", email, onReply, replyResolution: {
      recipientType: "parsed", directEmail: null, cachedVendorEmail: null, emailFrom: "documents@siteline.com",
      reason: "Billing platform (Siteline)", directoryContacts: [],
      candidates: [{ email: "sender@vendor.test", source: "sender" }, { email: "ap@vendor.test", source: "body" }],
    } });
    const message = screen.getByRole("textbox", { name: "Reply message" });
    fireEvent.change(message, { target: { value: "Please confirm" } });
    // First candidate (original sender) is preselected — send is enabled immediately
    expect(screen.getByRole("combobox", { name: "Reply recipient" })).toHaveValue("sender@vendor.test");
    expect(screen.getByRole("button", { name: "Send reply" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith("Please confirm", expect.any(String), "sender@vendor.test"));
  });

  it("still allows switching away from the default recipient", async () => {
    const onReply = vi.fn(async () => undefined);
    renderComposer({ mode: "reply", email, onReply, replyResolution: {
      recipientType: "parsed", directEmail: null, cachedVendorEmail: null, emailFrom: "documents@siteline.com",
      reason: "Billing platform (Siteline)", directoryContacts: [],
      candidates: [{ email: "sender@vendor.test", source: "sender" }, { email: "ap@vendor.test", source: "body" }],
    } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reply message" }), { target: { value: "Please confirm" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Reply recipient" }), { target: { value: "ap@vendor.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith("Please confirm", expect.any(String), "ap@vendor.test"));
  });

  it("lets the user type a manual email when the right recipient is not listed", async () => {
    const onReply = vi.fn(async () => undefined);
    renderComposer({ mode: "reply", email, onReply, replyResolution: {
      recipientType: "parsed", directEmail: null, cachedVendorEmail: null, emailFrom: "documents@siteline.com",
      reason: "Billing platform (Siteline)", directoryContacts: [],
      candidates: [{ email: "ap@vendor.test", source: "body" }],
    } });
    const message = screen.getByRole("textbox", { name: "Reply message" });
    fireEvent.change(message, { target: { value: "Manual please" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Reply recipient" }), { target: { value: "__manual__" } });
    const manual = screen.getByRole("textbox", { name: "Manual reply recipient" });
    const send = screen.getByRole("button", { name: "Send reply" });

    // Invalid input keeps send disabled and shows a hint
    fireEvent.change(manual, { target: { value: "not-an-email" } });
    expect(send).toBeDisabled();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();

    // Valid email enables send and is normalized to lowercase
    fireEvent.change(manual, { target: { value: " Erik@Partner.EXAMPLE " } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(onReply).toHaveBeenCalledWith("Manual please", expect.any(String), "erik@partner.example"));
  });

  it("backspace with an empty search removes the last forward chip", async () => {
    renderComposer({ mode: "forward", recipients: [defaultRecipient] });
    const input = screen.getByRole("textbox", { name: "Forward to" });
    // default recipient chip is present
    expect(screen.getByRole("button", { name: `Remove ${defaultRecipient.name}` })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.queryByRole("button", { name: `Remove ${defaultRecipient.name}` })).not.toBeInTheDocument();
  });

  it("shows the manual option even when the picker has no candidates", async () => {
    renderComposer({ mode: "reply", email, replyResolution: {
      recipientType: "manual", directEmail: null, cachedVendorEmail: null, emailFrom: null,
      reason: "Sender requires recipient confirmation", directoryContacts: [], candidates: [],
    } });
    fireEvent.change(screen.getByRole("combobox", { name: "Reply recipient" }), { target: { value: "__manual__" } });
    expect(screen.getByRole("textbox", { name: "Manual reply recipient" })).toBeInTheDocument();
  });

  it("allows an empty or whitespace-only forward when a recipient exists", async () => {
    const onForward = vi.fn(async () => undefined);
    renderComposer({ mode: "forward", recipients: [defaultRecipient], onForward });

    const submit = screen.getByRole("button", { name: "Forward" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onForward).toHaveBeenCalledWith([defaultRecipient.userId], "", expect.any(String)));

    const input = screen.getByRole("textbox", { name: "Forward message" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(submit);
    await waitFor(() => expect(onForward).toHaveBeenCalledTimes(2));
    expect(onForward).toHaveBeenLastCalledWith([defaultRecipient.userId], "", expect.any(String));
  });

  it("keeps the attachment fallback informational and removable", () => {
    renderComposer({ attachment: { name: "invoice.pdf", sizeLabel: "3.4 MB", oversize: true } });
    expect(screen.getByText(/PDF too large to attach/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
    expect(screen.queryByText(/PDF too large to attach/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Attachment: invoice.pdf/)).not.toBeInTheDocument();
  });

  it("preserves the failed destination draft and only retries after an explicit click", async () => {
    const onForward = vi.fn()
      .mockRejectedValueOnce({ status: 504, message: "Gateway timeout" })
      .mockResolvedValueOnce(undefined);
    renderComposer({ mode: "forward", recipients: [defaultRecipient], onForward });
    const input = screen.getByRole("textbox", { name: "Forward message" });
    fireEvent.change(input, { target: { value: "Keep this forward" } });
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(onForward).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue("Keep this forward");
    expect(screen.getByRole("alert")).toHaveTextContent("This may have sent");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(onForward).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "Edited after timeout" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onForward).toHaveBeenCalledTimes(2));
    expect(onForward.mock.calls[0]?.[2]).toBe(onForward.mock.calls[1]?.[2]);
    expect(input).toHaveValue("");
  });

  it("rotates the send token after a terminal email failure", async () => {
    const onReply = vi.fn().mockRejectedValueOnce({ status: 422, message: "Invalid recipient" }).mockResolvedValueOnce(undefined);
    renderComposer({ mode: "reply", email, onReply });
    const input = screen.getByRole("textbox", { name: "Reply message" });
    fireEvent.change(input, { target: { value: "Retry this reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(onReply).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onReply).toHaveBeenCalledTimes(2));
    expect(onReply.mock.calls[0]?.[1]).not.toBe(onReply.mock.calls[1]?.[1]);
  });

  it("starts a new logical send with a new token after success", async () => {
    const onReply = vi.fn().mockResolvedValue(undefined);
    renderComposer({ mode: "reply", email, onReply });
    const input = screen.getByRole("textbox", { name: "Reply message" });
    fireEvent.change(input, { target: { value: "First reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(onReply).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "Second reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(onReply).toHaveBeenCalledTimes(2));
    expect(onReply.mock.calls[0]?.[1]).not.toBe(onReply.mock.calls[1]?.[1]);
  });

  it("rehydrates only bounded string drafts and keeps each destination independent", () => {
    window.localStorage.setItem(
      "document-collaboration-draft:worker:doc-1",
      JSON.stringify({ comment: "c".repeat(2_500), reply: { unsafe: true }, forward: "forward draft" }),
    );
    const { rerender } = renderComposer({ documentId: "doc-1", draftOwner: "worker" });
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue("c".repeat(2_000));
    rerender(
      <CollaborationComposer
        documentId="doc-1"
        draftOwner="worker"
        mode="forward"
        recipients={[defaultRecipient]}
        canComment
        canEmail
        onModeChange={vi.fn()}
        onComment={vi.fn(async () => undefined)}
        onReply={vi.fn(async () => undefined)}
        onForward={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Forward message" })).toHaveValue("forward draft");
  });
});
