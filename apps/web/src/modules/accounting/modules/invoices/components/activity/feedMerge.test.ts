import { describe, expect, it } from "vitest";
import { ACTIVITY_PAGE_SIZE, activityActorKey, activityDayLabel, foldConsecutiveSystemEntries, isAfterActivityCutoff, isUnreadActivity, mergeActivityEntries, shouldStartActorGroup } from "./feedMerge";
import type { ActivityEntry } from "@/modules/accounting/modules/invoices/types/api";

const entry = (id: string, timestamp: string, name = "Dana"): ActivityEntry => ({ id, kind: "comment", timestamp, actor: { userId: name, name }, body: id });

describe("activity feed merge", () => {
  it("deduplicates optimistic/server reconciliation while retaining distinct events", () => {
    const merged = mergeActivityEntries([entry("same", "2026-09-15T12:00:00Z"), entry("other", "2026-09-15T11:00:00Z")], [entry("same", "2026-09-15T12:01:00Z")]);
    expect(merged.map((item) => item.id)).toEqual(["same", "other"]);
  });

  it("replaces a temporary comment with its canonical server actor during reconciliation", () => {
    const optimistic = { ...entry("optimistic-comment", "2026-09-15T12:00:00Z", "You"), body: "Comment" };
    const canonical = {
      ...entry("comment-1", "2026-09-15T12:00:01Z", "Dana Canonical"),
      body: "Comment",
      clientReconciliationId: "optimistic-comment",
    };

    const merged = mergeActivityEntries([canonical], [optimistic]);

    expect(merged).toEqual([canonical]);
    expect(merged[0]?.actor.name).toBe("Dana Canonical");
  });

  it("keeps the server cutoff authoritative for unread and grouping boundaries", () => {
    const cutoff = "2026-09-15T12:00:00Z";
    expect(isAfterActivityCutoff(entry("new", "2026-09-15T12:01:00Z"), cutoff)).toBe(true);
    expect(shouldStartActorGroup(entry("old", "2026-09-15T11:59:00Z"), entry("new", "2026-09-15T12:01:00Z"), cutoff)).toBe(true);
  });

  it("uses server arrival order and an ID tie-break while retaining older appended pages", () => {
    const newest = Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, index) => entry(`page-${index}`, `2026-09-15T12:${String(49 - index).padStart(2, "0")}:00Z`));
    const older = [
      { ...entry("older-b", "2026-09-14T09:00:00Z"), arrivalTimestamp: "2026-09-14T10:00:00Z" },
      { ...entry("older-a", "2026-09-14T09:00:00Z"), arrivalTimestamp: "2026-09-14T10:00:00Z" },
    ];
    const merged = mergeActivityEntries([...newest, ...older]);
    expect(merged).toHaveLength(52);
    expect(merged.slice(-2).map((item) => item.id)).toEqual(["older-b", "older-a"]);
    expect(mergeActivityEntries([{ ...entry("arrival", "2026-09-15T13:00:00Z"), arrivalTimestamp: "2026-09-15T11:00:00Z" }, { ...entry("display", "2026-09-15T12:00:00Z"), arrivalTimestamp: "2026-09-15T12:00:00Z" }]).map((item) => item.id)).toEqual(["display", "arrival"]);
  });

  it("only deduplicates stable identities, never same-type content lookalikes", () => {
    const first = entry("comment-a", "2026-09-15T12:00:00Z");
    const second = { ...first, id: "comment-b", timestamp: "2026-09-15T12:00:01Z" };
    expect(mergeActivityEntries([first, second])).toHaveLength(2);
    expect(mergeActivityEntries([first], [{ ...first, body: "optimistic copy" }])).toEqual([first]);
  });

  it("keeps the confirmed email card and suppresses only its matching server reply audit receipt", () => {
    const email: ActivityEntry = {
      id: "attempt-1", kind: "email", direction: "out", emailKind: "reply", status: "confirmed",
      timestamp: "2026-09-18T12:00:00Z", actor: { name: "Dana" }, to: ["vendor@example.test"], subject: "RE: Invoice",
    };
    const audit: ActivityEntry = {
      id: "audit-1", kind: "event", type: "invoice.email_replied", timestamp: "2026-09-18T12:00:01Z",
      actor: { name: "Dana" }, changes: { attemptId: "attempt-1", subject: "RE: Invoice" },
    };

    expect(mergeActivityEntries([audit, email])).toEqual([email]);
  });

  it("retains an email audit receipt when its confirmed email card is unavailable", () => {
    const audit: ActivityEntry = {
      id: "audit-1", kind: "event", action: "invoice.email_forwarded", timestamp: "2026-09-18T12:00:01Z",
      actor: { name: "Dana" }, changes: { attemptId: "attempt-not-in-feed" },
    };

    expect(mergeActivityEntries([audit])).toEqual([audit]);
  });

  it("keeps the inbound email card and suppresses its matching serialized reply receipt", () => {
    const emailReceivedAt = "2026-09-18T19:35:32.000Z";
    const auditReceivedAt = "2026-09-18T19:35:32Z";
    const email: ActivityEntry = {
      id: "inbound-1", kind: "email", direction: "in", emailKind: "inbound", receivedAt: emailReceivedAt,
      timestamp: emailReceivedAt, actor: { name: "Vendor" }, subject: "RE: Invoice",
    };
    const audit: ActivityEntry = {
      id: "audit-1", kind: "event", type: "invoice.email_reply_received", timestamp: "2026-09-18T12:00:01.000Z",
      actor: { name: "Vendor" }, changes: { subject: "RE: Invoice", receivedAt: auditReceivedAt, hasAttachments: false, verifiedParticipant: true },
    };

    expect(mergeActivityEntries([audit, email])).toEqual([email]);
  });

  it("retains an inbound email receipt when its email card is unavailable", () => {
    const audit: ActivityEntry = {
      id: "audit-1", kind: "event", type: "document.email_reply_received", timestamp: "2026-09-18T12:00:01.000Z",
      actor: { name: "Vendor" }, changes: { receivedAt: "2026-09-18T12:00:00.000Z" },
    };

    expect(mergeActivityEntries([audit])).toEqual([audit]);
  });

  it("suppresses the delivery-failure receipt when its inbound NDR card is present", () => {
    const emailReceivedAt = "2026-09-18T19:35:32.000Z";
    const auditReceivedAt = "2026-09-18T19:35:32Z";
    const ndr: ActivityEntry = {
      id: "ndr-1", kind: "email", direction: "in", emailKind: "ndr", receivedAt: emailReceivedAt,
      timestamp: emailReceivedAt, actor: { name: "System" }, subject: "Email delivery failed",
    };
    const audit: ActivityEntry = {
      id: "audit-ndr", kind: "event", type: "invoice.email_reply_received", timestamp: "2026-09-18T12:00:01.000Z",
      actor: { name: "System" }, summary: "Email delivery failed", changes: { receivedAt: auditReceivedAt },
    };

    expect(mergeActivityEntries([audit, ndr])).toEqual([ndr]);
  });

  it("retains receipts with invalid received-at values", () => {
    const email: ActivityEntry = {
      id: "inbound-invalid", kind: "email", direction: "in", emailKind: "inbound", receivedAt: "not-a-date",
      timestamp: "2026-09-18T19:35:32.000Z", actor: { name: "Vendor" },
    };
    const audit: ActivityEntry = {
      id: "audit-invalid", kind: "event", type: "invoice.email_reply_received", timestamp: "2026-09-18T19:35:33.000Z",
      actor: { name: "Vendor" }, changes: { receivedAt: "not-a-date" },
    };

    expect(mergeActivityEntries([audit, email])).toHaveLength(2);
  });

  it("limits unread state to inbound replies and comments from other users", () => {
    const cutoff = "2026-09-15T12:00:00Z";
    expect(isUnreadActivity(entry("comment", "2026-09-15T12:01:00Z"), cutoff, "other-user")).toBe(true);
    expect(isUnreadActivity({ ...entry("mine", "2026-09-15T12:01:00Z", "me"), actor: { userId: "me", name: "Me" } }, cutoff, "me")).toBe(false);
    expect(isUnreadActivity({ ...entry("out", "2026-09-15T12:01:00Z"), kind: "email", direction: "out" }, cutoff, "other-user")).toBe(false);
    expect(isUnreadActivity({ ...entry("out-reply", "2026-09-15T12:01:00Z"), kind: "email", direction: "out", emailKind: "reply" }, cutoff, "other-user")).toBe(false);
    expect(isUnreadActivity({ ...entry("in", "2026-09-15T12:01:00Z"), kind: "email", direction: "in", emailKind: "reply" }, cutoff, "other-user")).toBe(true);
    expect(isUnreadActivity({ ...entry("ndr", "2026-09-15T12:01:00Z"), kind: "email", direction: "in", emailKind: "ndr" }, cutoff, "other-user")).toBe(false);
    expect(isUnreadActivity({ ...entry("system", "2026-09-15T12:01:00Z"), kind: "event" }, cutoff, "other-user")).toBe(false);
  });

  it("folds only consecutive same-day system events", () => {
    const groups = foldConsecutiveSystemEntries([
      { ...entry("system-1", "2026-09-15T12:00:00Z"), kind: "event", actor: { name: "System" } },
      { ...entry("system-2", "2026-09-15T11:59:00Z"), kind: "event", actor: { name: "System" } },
      { ...entry("human-event", "2026-09-15T11:58:30Z"), kind: "event", actor: { name: "Dana" } },
      entry("human", "2026-09-15T11:58:00Z"),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ foldedSystem: true, entries: [{ id: "system-1" }, { id: "system-2" }] });
    expect(groups[1]?.entries.map((item) => item.id)).toEqual(["human-event"]);
    expect(groups[2]?.entries.map((item) => item.id)).toEqual(["human"]);
  });

  it("labels calendar days as Today and Yesterday", () => {
    const now = new Date("2026-09-16T16:00:00Z");
    expect(activityDayLabel("2026-09-16T12:00:00Z", now)).toBe("Today");
    expect(activityDayLabel("2026-09-15T12:00:00Z", now)).toBe("Yesterday");
  });

  it("keeps the viewer's own entries in one actor group across the unread cutoff", () => {
    const cutoff = "2026-09-15T12:00:00Z";
    const before = entry("mine-before", "2026-09-15T11:59:00Z", "me");
    const after = entry("mine-after", "2026-09-15T12:01:00Z", "me");
    expect(shouldStartActorGroup(before, after, cutoff, "me")).toBe(false);
    expect(shouldStartActorGroup(before, after, cutoff)).toBe(true);
  });

  it("never groups two unresolved former users from their shared display label", () => {
    const first = { ...entry("legacy-a", "2026-09-15T12:00:00Z"), actor: { name: "Former user" } };
    const second = { ...entry("legacy-b", "2026-09-15T11:59:00Z"), actor: { name: "Former user" } };

    expect(activityActorKey(first)).not.toBe(activityActorKey(second));
    expect(shouldStartActorGroup(first, second)).toBe(true);
  });

  it("never groups an NDR with a generic System audit row", () => {
    const ndr = { ...entry("ndr-private-id", "2026-09-15T12:00:00Z"), kind: "email" as const, emailKind: "ndr" as const, actor: { name: "System" } };
    const audit = { ...entry("audit-private-id", "2026-09-15T11:59:00Z"), kind: "event" as const, actor: { name: "System" } };

    expect(activityActorKey(ndr)).not.toBe(activityActorKey(audit));
    expect(shouldStartActorGroup(ndr, audit)).toBe(true);
  });

  it("does not fold across a human row, day, invalid date, or identified actor", () => {
    const groups = foldConsecutiveSystemEntries([
      { ...entry("system-1", "2026-09-15T12:00:00Z"), kind: "event", actor: { name: "System" } },
      entry("human", "2026-09-15T11:59:00Z"),
      { ...entry("system-2", "2026-09-15T11:58:00Z"), kind: "event", actor: { name: "System" } },
      { ...entry("system-next-day", "2026-09-14T11:57:00Z"), kind: "event", actor: { name: "System" } },
      { ...entry("invalid-a", "not-a-date"), kind: "event", actor: { name: "System" } },
      { ...entry("invalid-b", "not-a-date"), kind: "event", actor: { name: "System" } },
      { ...entry("identified", "2026-09-14T11:56:00Z"), kind: "event", actor: { userId: "system-service", name: "System" } },
    ]);
    expect(groups).toHaveLength(7);
    expect(groups.every((group) => group.entries.length === 1)).toBe(true);
  });

  it("does not deduplicate same-content entries across kinds", () => {
    const comment = entry("comment", "2026-09-15T12:00:00Z");
    const event: ActivityEntry = { id: "event", kind: "event", timestamp: comment.timestamp, actor: { name: "System" }, action: comment.body ?? "" };
    expect(mergeActivityEntries([comment, event])).toHaveLength(2);
  });
});
