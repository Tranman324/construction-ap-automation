import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityFeed } from "./ActivityFeed";
import type { ActivityEntry } from "@/modules/accounting/modules/invoices/types/api";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";

const entries: ActivityEntry[] = [
  {
    id: "new",
    kind: "comment",
    timestamp: "2026-09-15T12:01:00Z",
    actor: { name: "Dana Moreno", role: "AP" },
    body: "<script>plain text</script>",
  },
  {
    id: "old",
    kind: "event",
    timestamp: "2026-09-15T11:00:00Z",
    actor: { name: "System" },
    action: "Invoice edited",
    changes: { amount: ["1", "2"], job: ["1", "2"], code: ["1", "2"] },
  },
];

describe("ActivityFeed", () => {
  afterEach(() => vi.useRealTimers());

  it("places the New marker between newer unread activity and older read history", () => {
    render(
      <ActivityFeed entries={entries} unreadCutoff="2026-09-15T12:00:00Z" />
    );
    const newerUnread = screen.getByText("“<script>plain text</script>”");
    const newMarker = screen.getByText("New");
    const olderRead = screen.getByText("Invoice edited");
    expect(newMarker).toBeInTheDocument();
    expect(
      newerUnread.compareDocumentPosition(newMarker) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      newMarker.compareDocumentPosition(olderRead) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getAllByText("1 → 2")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /fields changed/i })).not.toBeInTheDocument();
  });

  it("animates only confirmed new comment IDs and does not replay existing activity on polling", () => {
    const view = render(<ActivityFeed entries={entries} newEntryIds={new Set(["new"])} />);
    const newCommentRow = screen.getByText("“<script>plain text</script>”").closest("[class*='grid-cols-']");
    const oldEventRow = screen.getByText("Invoice edited").closest("[class*='grid-cols-']");

    expect(newCommentRow).toHaveClass(motionStyles.newActivityEntry);
    expect(oldEventRow).not.toHaveClass(motionStyles.newActivityEntry);

    view.rerender(<ActivityFeed entries={[...entries, { ...entries[1], id: "polled", timestamp: "2026-09-15T10:00:00Z" }]} newEntryIds={new Set(["new"])} />);
    expect(document.querySelectorAll(`.${motionStyles.newActivityEntry}`)).toHaveLength(1);
  });

  it("renders type-based event labels and their summaries", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "spectrum-submitted",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "System" },
            type: "invoice.submitted_spectrum",
            summary: "Submitted to Spectrum for processing.",
          },
        ]}
      />
    );

    expect(screen.getByText("Submitted to Spectrum")).toBeInTheDocument();
    expect(
      screen.getByText("Submitted to Spectrum for processing.")
    ).toBeInTheDocument();
  });

  it("formats typed actions, filters flag metadata, and keeps useful event summaries", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "typed-edit",
            kind: "event",
            timestamp: "2026-09-15T12:00:00Z",
            actor: { name: "Alex Morgan" },
            type: "invoice.edited",
            documentClassification: "invoice",
            summary: "Invoice edited",
            changes: {
              invoiceDate: ["2026-08-31T00:00:00.000Z", "2026-09-01"],
              flag_reason: ["Needs review", "Needs review"],
              flagReason: ["Internal note", "Internal note"],
            },
          },
          {
            id: "flagged",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "Alex Morgan" },
            type: "invoice.flagged",
            documentClassification: "invoice",
            summary: "Flagged for review",
          },
          {
            id: "approved",
            kind: "event",
            timestamp: "2026-09-15T10:00:00Z",
            actor: { name: "Alex Morgan" },
            type: "invoice.approved",
            documentClassification: "invoice",
            summary: "Approval was recorded by the controller.",
          },
        ]}
      />
    );

    expect(screen.getByText("Edited – Invoice")).toHaveClass("font-semibold");
    expect(screen.getByText("Flagged")).toHaveClass("font-semibold");
    expect(screen.getByText("Approved")).toHaveClass("font-semibold");
    expect(screen.queryByText("Invoice edited")).not.toBeInTheDocument();
    expect(screen.queryByText("Flagged for review")).not.toBeInTheDocument();
    expect(
      screen.getByText("Approval was recorded by the controller.")
    ).toBeInTheDocument();

    expect(screen.getByText("Sep 1, 2026")).toBeInTheDocument();
    const expectedInvoiceDate = new Date("2026-08-31T00:00:00.000Z").toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
    expect(screen.getByText(expectedInvoiceDate)).toBeInTheDocument();
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
    expect(screen.queryByText("Internal note")).not.toBeInTheDocument();
  });

  it("labels canonical non-invoice classifications and suppresses real redundant summaries", () => {
    render(
      <ActivityFeed
        entries={[
          { id: "pay-app", kind: "event", timestamp: "2026-09-16T12:00:00Z", actor: { name: "Alex Morgan" }, type: "invoice.edited", documentClassification: "pay-application", summary: "Invoice marked filed" },
          { id: "waiver", kind: "event", timestamp: "2026-09-16T11:00:00Z", actor: { name: "Alex Morgan" }, type: "document.waiver_linked", documentClassification: "lien-waiver", summary: "Flag removed" },
          { id: "purchase-order", kind: "event", timestamp: "2026-09-16T10:00:00Z", actor: { name: "Alex Morgan" }, type: "invoice.filed", documentClassification: "purchase-order", summary: "Invoice review undone" },
          { id: "credit-memo", kind: "event", timestamp: "2026-09-16T09:00:00Z", actor: { name: "Alex Morgan" }, type: "invoice.edited", documentClassification: "credit-memo", summary: "Matched to the project" },
          { id: "permit", kind: "event", timestamp: "2026-09-16T08:00:00Z", actor: { name: "Alex Morgan" }, type: "invoice.edited", documentClassification: "building-permit" },
        ]}
      />
    );

    expect(screen.getByText("Edited – Pay Application")).toBeInTheDocument();
    expect(screen.getByText("Waiver linked – Lien Waiver")).toBeInTheDocument();
    expect(screen.getByText("Filed – Purchase Order")).toBeInTheDocument();
    expect(screen.getByText("Edited – Credit Memo")).toBeInTheDocument();
    expect(screen.getByText("Edited – Building Permit")).toBeInTheDocument();
    expect(screen.queryByText("Invoice marked filed")).not.toBeInTheDocument();
    expect(screen.queryByText("Flag removed")).not.toBeInTheDocument();
    expect(screen.queryByText("Invoice review undone")).not.toBeInTheDocument();
    expect(screen.getByText("Matched to the project")).toBeInTheDocument();
  });

  it("keeps a single activity entry's header time and renders its line timestamp", () => {
    const timestamp = "2026-09-15T12:00:00Z";
    const expectedTime = new Intl.DateTimeFormat(undefined, {
      timeStyle: "short",
    }).format(new Date(timestamp));
    render(
      <ActivityFeed
        entries={[
          {
            id: "single-entry",
            kind: "event",
            timestamp,
            actor: { name: "Alex Morgan" },
            type: "invoice.edited",
          },
        ]}
      />
    );

    expect(document.querySelector("time.ml-auto")).toHaveClass(
      "font-mono",
      "tabular-nums"
    );
    const lineTimestamp = document.querySelector("time.text-right");
    expect(lineTimestamp).toHaveTextContent(expectedTime);
    expect(document.querySelectorAll("time.text-right")).toHaveLength(1);
    expect(document.querySelector("time.ml-auto")).toHaveTextContent(
      expectedTime
    );
  });

  it("strips document prefixes before humanizing event labels", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "split-confirmed",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "System" },
            type: "document.split_confirmed",
          },
        ]}
      />
    );

    expect(screen.getByText("Split confirmed")).toBeInTheDocument();
  });

  it("falls back to legacy event fields when type or summary is missing", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "legacy",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "System" },
            action: "invoice_edited",
            bodyPreview: "Legacy event detail",
          },
          {
            id: "unknown",
            kind: "event",
            timestamp: "2026-09-15T10:00:00Z",
            actor: { name: "System" },
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "2 system events" }));
    expect(screen.getByText("invoice edited")).toBeInTheDocument();
    expect(screen.getByText("Legacy event detail")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
  });

  it("preserves the casing of human-readable legacy event actions", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "legacy-file",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "System" },
            action: "file document",
          },
        ]}
      />
    );

    expect(screen.getByText("file document")).toBeInTheDocument();
  });

  it("renders tuple, scalar, boolean, ISO timestamp, and JSON change values safely", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "mixed-changes",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "System" },
            action: "Invoice edited",
            changes: {
              amount: ["1", "2"],
              sharePointUpload: true,
              reason: "manual review",
              total: 42,
              cleared: null,
              metadata: { source: "import", verified: true },
              tags: ["one", "two", "three"],
              reviewedAt: "2026-09-14T11:00:00Z",
            },
          },
        ]}
      />
    );

    expect(screen.getByText("1 → 2")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("manual review")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.getByText('{"source":"import","verified":true}')
    ).toBeInTheDocument();
    expect(screen.getByText('["one","two","three"]')).toBeInTheDocument();
    expect(screen.getByText("SharePoint Upload")).toBeInTheDocument();
    expect(screen.getByText(/Sep 14, 2026/)).toBeInTheDocument();
  });

  it("renders statement attribute audits as plain values and sources", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "statement-attributes",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "Alex Morgan" },
            type: "document.statement_attributes_updated",
            documentClassification: "statement",
            changes: {
              statementAttributes: [
                {
                  manual: {},
                  resolved: {
                    balance: { value: 79830, source: "extracted" },
                    statementPeriod: { value: "2026-08-31", source: "extracted" },
                  },
                },
                {
                  manual: {
                    balance: {
                      value: 80000,
                      setAt: "2026-09-14T18:23:16.246Z",
                      setBy: "amorgan@northwindcg.example",
                    },
                  },
                  resolved: {
                    balance: { value: 80000, source: "manual" },
                    statementPeriod: { value: null, source: null },
                  },
                },
              ],
            },
          },
        ]}
      />
    );

    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("Balance Source")).toBeInTheDocument();
    expect(screen.getByText("Statement Period")).toBeInTheDocument();
    expect(screen.getByText("Statement Period Source")).toBeInTheDocument();
    expect(screen.getByText("79830")).toHaveClass("line-through");
    expect(screen.getByText("80000")).toHaveClass("font-semibold");
    expect(screen.getAllByText("Cleared")).toHaveLength(2);
    expect(screen.queryByText(/setAt/)).not.toBeInTheDocument();
    expect(screen.queryByText(/amorgan@northwindcg.example/)).not.toBeInTheDocument();
    expect(screen.queryByText(/statementAttributes/)).not.toBeInTheDocument();
    expect(screen.queryByText("Statement attributes updated")).not.toBeInTheDocument();
  });

  it("filters activity metadata noise case-insensitively and counts only visible changes", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "visible-changes",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "System" },
            changes: {
              emailMessageId: "email-123",
              requestConversationId: "request-123",
              conversationId: "conversation-123",
              CORRELATIONID: "correlation-123",
              outgoingMessageID: "outgoing-123",
              sourceAttachmentId: "attachment-123",
              status: ["pending", "approved"],
              approvedBy: "Dana",
            },
          },
        ]}
      />
    );

    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Approved By")).toBeInTheDocument();
    [
      "email-123",
      "request-123",
      "conversation-123",
      "correlation-123",
      "outgoing-123",
      "attachment-123",
    ].forEach((value) =>
      expect(screen.queryByText(value)).not.toBeInTheDocument()
    );
  });

  it("shows only recipient and original sender details for waiver-request actions", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "waiver-request",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "Alex Morgan" },
            type: "invoice.waiver_requested",
            changes: {
              sentTo: "vendor@example.com",
              original_email_from: "billing@example.com",
              method: "email-reply",
              re_send: false,
              mailBox: "invoices@example.com",
              emailSubject: "Lien waiver request",
            },
          },
          {
            id: "ordinary-edit",
            kind: "event",
            timestamp: "2026-09-15T10:00:00Z",
            actor: { name: "Alex Morgan" },
            action: "invoice-edited",
            changes: {
              sent_to: "keep@example.com",
              originalEmailFrom: "original@example.com",
              method: "email-reply",
              resend: false,
              mailbox: "invoices@example.com",
              subject: "Keep this subject",
            },
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Sent To")).toHaveLength(2);
    expect(screen.getAllByText("Original Email From")).toHaveLength(2);
    expect(screen.getByText("vendor@example.com")).toBeInTheDocument();
    expect(screen.getByText("billing@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("Method")).toHaveLength(1);
    expect(screen.getAllByText("Resend")).toHaveLength(1);
    expect(screen.getAllByText("Mailbox")).toHaveLength(1);
    expect(screen.queryByText("Email Subject")).not.toBeInTheDocument();

    ["Method", "Resend", "Mailbox", "Subject"].forEach((field) => {
      expect(screen.getByText(field)).toBeInTheDocument();
    });
    expect(screen.getByText("Keep this subject")).toBeInTheDocument();
  });

  it("applies waiver detail filtering to legacy waiver-requested actions", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "legacy-waiver-request",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "Alex Morgan" },
            action: "waiver-requested",
            changes: {
              sentTo: "vendor@example.com",
              originalEmailFrom: "billing@example.com",
              method: "email-reply",
              resend: false,
              mailbox: "invoices@example.com",
              subject: "Lien waiver request",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("Sent To")).toBeInTheDocument();
    expect(screen.getByText("Original Email From")).toBeInTheDocument();
    expect(screen.getByText("vendor@example.com")).toBeInTheDocument();
    expect(screen.getByText("billing@example.com")).toBeInTheDocument();
    ["Method", "Resend", "Mailbox", "Subject"].forEach((field) => {
      expect(screen.queryByText(field)).not.toBeInTheDocument();
    });
  });

  it("hides the change expander when every change is activity metadata noise", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "noise-only",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "System" },
            changes: {
              emailMessageId: "email-123",
              requestConversationId: "request-123",
              conversationId: "conversation-123",
              correlationId: "correlation-123",
              anyMessageId: "any-123",
            },
          },
        ]}
      />
    );

    expect(
      screen.queryByRole("button", { name: /fields changed/i })
    ).not.toBeInTheDocument();
  });

  it("keeps useful business identifier changes while hiding only transport metadata", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "business-changes",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "System" },
            changes: {
              checkId: "CHK-001",
              conversationId: "transport-only",
            },
          },
        ]}
      />
    );

    expect(screen.getByText("Check ID")).toBeInTheDocument();
    expect(screen.getByText("CHK-001")).toBeInTheDocument();
    expect(screen.queryByText("transport-only")).not.toBeInTheDocument();
  });

  it("redacts opaque transport identifiers in event summaries and previews while preserving human text", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "summary",
            kind: "event",
            timestamp: "2026-09-15T12:00:00Z",
            actor: { userId: "dana", name: "Dana" },
            action: "Processed",
            summary:
              "Processed invoice 550e8400-e29b-41d4-a716-446655440000 successfully",
          },
          {
            id: "preview",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { userId: "dana", name: "Dana" },
            action: "Imported",
            bodyPreview:
              "Imported message AAMkAGI2THJYAAABBBcccDDDeeeFFf111222333444 for review",
          },
        ]}
      />
    );

    expect(
      screen.getByText("Processed invoice [redacted] successfully")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Imported message [redacted] for review")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/550e8400-e29b-41d4-a716-446655440000/)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/AAMkAGI2THJYAAABBBcccDDDeeeFFf111222333444/)
    ).not.toBeInTheDocument();
  });

  it("marks undone events in the label", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "undone",
            kind: "event",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { name: "System" },
            type: "invoice.file_undo",
            undoneAt: "2026-09-15T12:00:00Z",
          },
        ]}
      />
    );

    expect(screen.getByText("Filing undone (undone)")).toBeInTheDocument();
  });

  it("renders calendar labels, folds system rows, and shows email safety badges", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T16:00:00Z"));
    render(
      <ActivityFeed
        entries={[
          {
            id: "attachment",
            kind: "email",
            timestamp: "2026-09-16T15:00:00Z",
            actor: { name: "Vendor" },
            direction: "in",
            emailKind: "inbound",
            bodyPreview: "See attached.",
            hasAttachments: true,
            verifiedParticipant: false,
          },
          {
            id: "ndr",
            kind: "email",
            timestamp: "2026-09-15T15:00:00Z",
            actor: { name: "Mail" },
            direction: "in",
            emailKind: "ndr",
            bodyPreview: "Rejected",
          },
          {
            id: "system-1",
            kind: "event",
            timestamp: "2026-09-15T14:00:00Z",
            actor: { name: "System" },
            action: "Indexed",
          },
          {
            id: "system-2",
            kind: "event",
            timestamp: "2026-09-15T13:00:00Z",
            actor: { name: "System" },
            action: "Classified",
          },
        ]}
      />
    );
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(screen.getByText("Unverified sender")).toBeInTheDocument();
    expect(
      screen.getByText(/Attachment received for review/)
    ).toBeInTheDocument();
    expect(screen.getByText("Delivery failed")).toBeInTheDocument();
    expect(screen.getByText("NDR")).toBeInTheDocument();
    const systemRun = screen.getByRole("button", { name: "2 system events" });
    expect(systemRun).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Indexed · Classified")).toHaveClass(
      "font-semibold"
    );
    fireEvent.click(systemRun);
    expect(systemRun).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("system-activity-group")).toHaveTextContent(
      "Indexed"
    );
  });

  it("keeps comments unboxed while reserving cards for inbound mail and delivery failures", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "comment",
            kind: "comment",
            timestamp: "2026-09-16T15:00:00Z",
            actor: { name: "Dana" },
            body: "Please review",
          },
          {
            id: "email",
            kind: "email",
            timestamp: "2026-09-16T14:00:00Z",
            actor: { name: "Vendor" },
            direction: "in",
            emailKind: "inbound",
            subject: "Invoice",
          },
          {
            id: "ndr",
            kind: "email",
            timestamp: "2026-09-16T13:00:00Z",
            actor: { name: "Mail" },
            direction: "in",
            emailKind: "ndr",
            bodyPreview: "Rejected",
          },
        ]}
      />
    );

    const comment = screen.getByText("“Please review”");
    expect(comment).toHaveClass("italic");
    expect(comment.tagName).toBe("BLOCKQUOTE");
    expect(screen.queryByText("Comment")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Inbound email")).toHaveTextContent("Invoice");
    expect(screen.getByLabelText("Delivery failed")).toHaveClass(
      "border-amber-300"
    );
  });

  it("renders one actor header and time labels for a same-day conversation run", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "dana-3",
            kind: "comment",
            timestamp: "2026-09-16T12:00:00Z",
            actor: { userId: "dana", name: "Dana Moreno", role: "AP" },
            body: "Latest note",
          },
          {
            id: "dana-2",
            kind: "comment",
            timestamp: "2026-09-16T11:30:00Z",
            actor: { userId: "dana", name: "Dana Moreno", role: "AP" },
            body: "Second note",
          },
          {
            id: "dana-1",
            kind: "comment",
            timestamp: "2026-09-16T11:00:00Z",
            actor: { userId: "dana", name: "Dana Moreno", role: "AP" },
            body: "First note",
          },
        ]}
      />
    );

    expect(screen.getAllByText("Dana Moreno")).toHaveLength(1);
    expect(screen.getAllByText(/AM|PM/)).toHaveLength(4);
  });

  it("uses canonical and stale platform identities with the shared avatar resolver", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "platform-actor",
            kind: "comment",
            timestamp: "2026-09-16T12:00:00Z",
            actor: {
              userId: "toolbox-user",
              azureId: "azure-user",
              name: "Dana Moreno",
              avatarUrl: "/api/users/azure-user/photo",
            },
            body: "Platform comment",
          },
          {
            id: "stale-platform-actor",
            kind: "comment",
            timestamp: "2026-09-16T11:00:00Z",
            actor: { userId: "retired-user", name: "retired@example.test" },
            body: "Historical comment",
          },
          {
            id: "explicit-former-user",
            kind: "comment",
            timestamp: "2026-09-16T10:00:00Z",
            actor: { userId: "former-user", name: "Former user" },
            body: "Unresolved historical comment",
          },
        ]}
      />
    );

    expect(screen.getByRole("img", { name: "Dana Moreno" })).toHaveAttribute(
      "src",
      "/api/backend/users/azure-user/photo"
    );
    expect(screen.getByText("retired@example.test")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "retired@example.test" })).toHaveAttribute(
      "src",
      "/api/backend/users/retired-user/photo"
    );
    expect(screen.getByText("Former user")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Former user" })
    ).not.toBeInTheDocument();
  });

  it("renders unresolved legacy actors as Former user without coalescing their groups or exposing identifiers", () => {
    render(
      <ActivityFeed
        entries={[
          { id: "legacy-a", kind: "comment", timestamp: "2026-09-16T12:00:00Z", actor: { name: "Former user" }, body: "First historical comment" },
          { id: "legacy-b", kind: "comment", timestamp: "2026-09-16T11:00:00Z", actor: { name: "Former user" }, body: "Second historical comment" },
        ]}
      />
    );

    expect(screen.getAllByText("Former user")).toHaveLength(2);
    expect(screen.queryByText("legacy-a")).not.toBeInTheDocument();
    expect(screen.queryByText("legacy-b")).not.toBeInTheDocument();
  });

  it("uses generic NDR wording and discloses only the activity entry's recorded message", async () => {
    const user = userEvent.setup();
    render(
      <ActivityFeed
        entries={[
          { id: "ndr-1", kind: "email", timestamp: "2026-09-16T12:00:00Z", actor: { name: "Mail delivery", role: "external" }, direction: "in", emailKind: "ndr", to: ["vendor@example.test"], subject: "Invoice 42", bodyPreview: "Mailbox rejected the message." },
        ]}
      />
    );

    expect(screen.getByText("The mail system reported the message was undeliverable.")).toBeInTheDocument();
    expect(screen.queryByText("vendor@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing arrived on the vendor/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Mailbox rejected the message.")).not.toBeInTheDocument();
    const disclosure = screen.getByRole("button", { name: "Show the message that failed" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(disclosure).toHaveAttribute("aria-controls");

    await user.click(disclosure);

    expect(screen.getByRole("button", { name: "Hide the message that failed" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Invoice 42")).toBeInTheDocument();
    expect(screen.getByText("Mailbox rejected the message.")).toBeInTheDocument();
  });

  it("keeps an NDR separate from an adjacent generic System audit row without exposing entry IDs", () => {
    render(
      <ActivityFeed
        entries={[
          { id: "ndr-private-id", kind: "email", timestamp: "2026-09-16T12:00:00Z", actor: { name: "System" }, direction: "in", emailKind: "ndr" },
          { id: "audit-private-id", kind: "event", timestamp: "2026-09-16T11:00:00Z", actor: { name: "System" }, action: "Indexed" },
        ]}
      />
    );

    expect(screen.getAllByText("System")).toHaveLength(2);
    expect(screen.queryByText("ndr-private-id")).not.toBeInTheDocument();
    expect(screen.queryByText("audit-private-id")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ndr-private-id|audit-private-id/i)).not.toBeInTheDocument();
  });

  it("keeps external, System, and NDR identities outside the platform avatar resolver", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "vendor",
            kind: "email",
            timestamp: "2026-09-16T12:00:00Z",
            actor: {
              name: "Acme Vendor",
              role: "external",
              userId: "external-user",
              azureId: "external-azure",
              avatarUrl: "/api/users/external-azure/photo",
            },
            direction: "in",
            emailKind: "inbound",
            from: "ap@acme.test",
          },
          {
            id: "system-with-identity",
            kind: "event",
            timestamp: "2026-09-16T11:30:00Z",
            actor: {
              name: "System",
              userId: "system-user",
              azureId: "system-azure",
              avatarUrl: "/api/users/system-azure/photo",
            },
            action: "Indexed",
          },
          {
            id: "delivery-failure",
            kind: "email",
            timestamp: "2026-09-16T11:00:00Z",
            actor: {
              name: "Mail delivery",
              userId: "ndr-user",
              azureId: "ndr-azure",
              avatarUrl: "/api/users/ndr-azure/photo",
            },
            direction: "in",
            emailKind: "ndr",
          },
        ]}
      />
    );

    expect(screen.getByText("Acme Vendor")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Acme Vendor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "System" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Mail delivery" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("System")).toBeInTheDocument();
    expect(screen.getByLabelText("Delivery failed")).toBeInTheDocument();
  });

  it("renders compact grouped time columns and a mono right-aligned group timestamp", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "group-2",
            kind: "comment",
            timestamp: "2026-09-16T12:00:00Z",
            actor: { userId: "dana", name: "Dana Moreno" },
            body: "Later comment",
          },
          {
            id: "group-1",
            kind: "comment",
            timestamp: "2026-09-16T11:00:00Z",
            actor: { userId: "dana", name: "Dana Moreno" },
            body: "Earlier comment",
          },
        ]}
      />
    );

    const times = Array.from(document.querySelectorAll("time"));
    const groupTimestamp = times.find((time) =>
      time.classList.contains("ml-auto")
    );
    const lineTimestamps = times.filter((time) =>
      time.classList.contains("text-right")
    );
    expect(groupTimestamp).toHaveClass("font-mono", "tabular-nums", "ml-auto");
    expect(lineTimestamps).toHaveLength(2);
    lineTimestamps.forEach((time) =>
      expect(time).toHaveClass("font-mono", "tabular-nums", "text-right")
    );
  });

  it("renders change details immediately in a bordered two-column grid for tuple and scalar values", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "change-grid",
            kind: "event",
            timestamp: "2026-09-16T12:00:00Z",
            actor: { name: "System" },
            action: "Invoice edited",
            changes: {
              status: ["pending", "approved"],
              reviewed: true,
              sourceAttachmentId: "opaque-source-id",
            },
          },
        ]}
      />
    );

    const grid = screen.getByText("Status").closest("dl");
    expect(grid).toHaveClass("rounded-md", "border");
    expect(grid?.querySelector("div")).toHaveClass("grid");
    expect(grid).toHaveTextContent("pending → approved");
    expect(grid).toHaveTextContent("ReviewedYes");
    expect(screen.queryByText("opaque-source-id")).not.toBeInTheDocument();
  });

  it("uses shared activity formatting for actions, changes, cleared values, and actor names", () => {
    render(
      <ActivityFeed
        entries={[
          {
            id: "formatted-event",
            kind: "event",
            timestamp: "2026-09-16T12:00:00Z",
            actor: { name: "Alex Morgan", role: "admin" },
            type: "invoice.edited",
            changes: {
              costType: ["S", "O"],
              phaseCode: ["01002", null],
              glAccount: ["5450", ""],
              literalNull: ["before", "null"],
            },
          },
          {
            id: "formatted-action",
            kind: "event",
            timestamp: "2026-09-16T11:00:00Z",
            actor: { name: "Dana Moreno", role: "AP" },
            type: "document.waiver_linked",
          },
        ]}
      />
    );

    expect(screen.getByText("Edited")).toHaveClass("font-semibold");
    expect(screen.getByText("Waiver linked")).toHaveClass("font-semibold");
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
    expect(screen.queryByText("AP")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /fields changed/i })).not.toBeInTheDocument();

    expect(screen.getByText("S")).toHaveClass("line-through");
    expect(screen.getByText("O")).toHaveClass("font-semibold");
    const clearedValues = screen.getAllByText("Cleared");
    expect(clearedValues).toHaveLength(2);
    clearedValues.forEach((value) =>
      expect(value).toHaveClass("font-semibold")
    );
    expect(screen.getByText("null")).toHaveClass("font-semibold");
  });

  it("renders inbound and outbound cards with source-backed address, subject, preview, and New state", () => {
    render(
      <ActivityFeed
        unreadCutoff="2026-09-16T10:00:00Z"
        entries={[
          {
            id: "inbound",
            kind: "email",
            timestamp: "2026-09-16T12:00:00Z",
            arrivalTimestamp: "2026-09-16T12:00:00Z",
            actor: { name: "Acme Vendor" },
            direction: "in",
            emailKind: "inbound",
            from: "ap@acme.test",
            subject: "Invoice question",
            bodyPreview: "Could you confirm the total?",
          },
          {
            id: "outbound",
            kind: "email",
            timestamp: "2026-09-16T11:00:00Z",
            actor: { userId: "dana", name: "Dana Moreno" },
            direction: "out",
            emailKind: "reply",
            to: ["ap@acme.test"],
            subject: "Re: Invoice question",
            bodyPreview: "The total is confirmed.",
          },
        ]}
      />
    );

    expect(screen.getByLabelText("Inbound email")).toHaveTextContent(
      "ap@acme.test"
    );
    expect(screen.getByLabelText("Inbound email")).toHaveTextContent(
      "Invoice question"
    );
    expect(screen.getByLabelText("Inbound email")).toHaveTextContent(
      "Could you confirm the total?"
    );
    expect(screen.getByLabelText("Inbound email")).toHaveTextContent("New");
    expect(screen.getByLabelText("Outbound email")).toHaveTextContent(
      "To ap@acme.test"
    );
  });

  it("keeps inbound HTML inert until expanded and labels an unverified sender", async () => {
    const user = userEvent.setup();
    render(
      <ActivityFeed
        entries={[{
          id: "inbound-html",
          kind: "email",
          timestamp: "2026-09-16T12:00:00Z",
          actor: { name: "Outside sender", role: "external" },
          direction: "in",
          emailKind: "inbound",
          from: "outside@example.test",
          subject: "Please review",
          bodyPreview: "Please see attached.",
          sanitizedBodyHtml: '<p>Safe body</p><script>alert("xss")</script>',
          verifiedParticipant: false,
        }]}
      />,
    );

    expect(screen.getByText("Unverified sender")).toBeInTheDocument();
    expect(screen.queryByTitle("Inbound email body")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View full message" }));
    const frame = screen.getByTitle("Inbound email body");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("Safe body"));
    expect(frame).toHaveAttribute("srcdoc", expect.not.stringContaining("script"));
  });

  it("expands the original NDR message inside a sandbox", async () => {
    const user = userEvent.setup();
    render(
      <ActivityFeed
        entries={[{
          id: "ndr",
          kind: "email",
          emailKind: "ndr",
          timestamp: "2026-09-16T12:00:00Z",
          actor: { name: "System", role: "external" },
          direction: "in",
          subject: "Delivery Status Notification",
          sanitizedBodyHtml: "<p>The vendor mailbox rejected the message.</p>",
        }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Show the message that failed" }));
    expect(screen.getByTitle("Original delivery-failure message")).toHaveAttribute("sandbox", "");
  });

  it("requires review before allowing attachment promotion and preserves the source on failure", async () => {
    const user = userEvent.setup();
    const promote = vi.fn().mockRejectedValue(new Error("Mailbox source unavailable"));
    render(
      <ActivityFeed
        documentId="doc-1"
        entries={[{
          id: "inbound-attachment",
          kind: "email",
          timestamp: "2026-09-16T12:00:00Z",
          actor: { name: "Vendor", role: "external" },
          direction: "in",
          emailKind: "inbound",
          from: "vendor@example.test",
          hasAttachments: true,
          attachmentReviewed: false,
        }]}
        inboundAttachments={[{
          attachmentId: "attachment-1",
          name: "invoice.pdf",
          contentType: "application/pdf",
          sizeBytes: 2048,
          isInline: false,
          eligible: true,
        }]}
        onPromoteAttachment={promote}
      />,
    );

    expect(screen.getByText("Attachment received for review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create as new document" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByTitle("Preview invoice.pdf")).toHaveAttribute("sandbox", "");
    await user.click(screen.getByRole("button", { name: "Create as new document" }));
    await waitFor(() => expect(promote).toHaveBeenCalledWith("attachment-1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mailbox source unavailable");
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
    expect(screen.getByText("Attachment received for review")).toBeInTheDocument();
  });

  it("shows a successful attachment promotion without removing the source message", async () => {
    const user = userEvent.setup();
    const promote = vi.fn().mockResolvedValue({
      promoted: true,
      duplicate: false,
      documentId: "new-doc",
      sourceDocumentId: "doc-1",
      sourceEmailMessageId: "message-1",
    });
    render(
      <ActivityFeed
        documentId="doc-1"
        entries={[{
          id: "inbound-attachment-success",
          kind: "email",
          timestamp: "2026-09-16T12:00:00Z",
          actor: { name: "Vendor", role: "external" },
          direction: "in",
          emailKind: "inbound",
          hasAttachments: true,
        }]}
        inboundAttachments={[{
          attachmentId: "attachment-2",
          name: "statement.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
          isInline: false,
          eligible: true,
        }]}
        onPromoteAttachment={promote}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Create as new document" }));
    expect(await screen.findByText("Created as new document")).toBeInTheDocument();
    expect(screen.getByText("Attachment received for review")).toBeInTheDocument();
    expect(screen.getByText("statement.pdf")).toBeInTheDocument();
  });

  it("folds older email rows in a three-message conversation until opened", async () => {
    const user = userEvent.setup();
    render(
      <ActivityFeed
        entries={[
          {
            id: "mail-3",
            kind: "email",
            timestamp: "2026-09-16T12:00:00Z",
            actor: { userId: "dana", name: "Dana Moreno" },
            direction: "out",
            emailKind: "reply",
            to: ["vendor@example.test"],
            subject: "Latest",
            bodyPreview: "Latest preview",
          },
          {
            id: "mail-2",
            kind: "email",
            timestamp: "2026-09-16T11:00:00Z",
            actor: { userId: "dana", name: "Dana Moreno" },
            direction: "out",
            emailKind: "reply",
            to: ["vendor@example.test"],
            subject: "Older",
            bodyPreview: "Older preview",
          },
          {
            id: "mail-1",
            kind: "email",
            timestamp: "2026-09-16T10:00:00Z",
            actor: { userId: "dana", name: "Dana Moreno" },
            direction: "out",
            emailKind: "reply",
            to: ["vendor@example.test"],
            subject: "Oldest",
            bodyPreview: "Oldest preview",
          },
        ]}
      />
    );

    expect(screen.queryByText("Older preview")).not.toBeInTheDocument();
    const foldedReplyLabel = screen.getAllByText("Sent a reply")[0];
    expect(foldedReplyLabel).toHaveClass(
      "font-semibold"
    );
    await user.click(foldedReplyLabel);
    expect(screen.getByText("Older preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fold" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("uses a source-backed empty state without promising a comment to a view-only user", () => {
    const { rerender } = render(<ActivityFeed entries={[]} />);
    expect(
      screen.getByText("No activity on this document yet.")
    ).toBeInTheDocument();

    rerender(<ActivityFeed entries={[]} canComment />);
    expect(
      screen.getByText(
        "No activity on this document yet. Your comment will be the first."
      )
    ).toBeInTheDocument();
  });

  it("does not mark or split the current user's same-day entries at the unread cutoff", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T16:00:00Z"));
    render(
      <ActivityFeed
        currentUser="me"
        unreadCutoff="2026-09-15T12:00:00Z"
        entries={[
          {
            id: "mine-new",
            kind: "comment",
            timestamp: "2026-09-15T13:00:00Z",
            actor: { userId: "me", name: "Dana" },
            body: "new note",
          },
          {
            id: "mine-old",
            kind: "comment",
            timestamp: "2026-09-15T11:00:00Z",
            actor: { userId: "me", name: "Dana" },
            body: "old note",
          },
        ]}
      />
    );
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.getAllByText("Dana")).toHaveLength(1);
  });
});
