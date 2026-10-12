import type { ActivityEntry } from "@/modules/accounting/modules/invoices/types/api";

export const ACTIVITY_PAGE_SIZE = 50;

export type ActivityViewer = string | { userId?: string | null; name?: string | null } | null | undefined;

export interface FoldedActivityGroup {
  entries: ActivityEntry[];
  foldedSystem: boolean;
}

/** Client-only reconciliation metadata; it is never rendered or sent to the API. */
export type ClientReconciledActivityEntry = ActivityEntry & {
  clientReconciliationId?: string;
};

export function activityTimestamp(entry: ActivityEntry): string {
  return entry.timestamp ?? entry.createdAt ?? entry.arrivalTimestamp ?? "";
}

export function activityArrivalTimestamp(entry: ActivityEntry): string {
  return entry.arrivalTimestamp ?? entry.createdAt ?? entry.timestamp ?? "";
}

export function activityEntryKey(entry: ActivityEntry): string {
  return `${entry.kind}:${entry.messageId ?? entry.id}`;
}

export function activityActorKey(entry: ActivityEntry): string {
  // Delivery reports are a distinct visual unit even if their actor happens to
  // use the generic System label. The key stays client-only and is never exposed.
  if (entry.emailKind === "ndr") return `ndr:${activityEntryKey(entry)}`;

  const actor = entry.actor;
  const stableIdentity = actor?.userId?.trim() || actor?.azureId?.trim() || actor?.azure_id?.trim();
  if (stableIdentity) return `actor:${stableIdentity}`;

  const name = actor?.name?.trim();
  const isExternal = actor?.role === "external";
  const unresolvedInternal = !isExternal && name?.toLowerCase() === "former user";
  // A literal fallback label is not identity. Without safe server identity, force
  // separate groups so legacy people never collapse into one apparent actor.
  if (unresolvedInternal) return `unresolved:${activityEntryKey(entry)}`;
  return name ?? "system";
}

export function activityActorLabel(entry: ActivityEntry): string {
  return entry.actor?.name ?? entry.actor?.userId ?? "System";
}

function viewerMatchesActor(entry: ActivityEntry, viewer: ActivityViewer): boolean {
  if (!viewer) return entry.actor?.userId === "current-user" || entry.actor?.name?.toLowerCase() === "you";
  if (typeof viewer === "string") return entry.actor?.userId === viewer || entry.actor?.name === viewer;
  return Boolean((viewer.userId && entry.actor?.userId === viewer.userId) || (viewer.name && entry.actor?.name === viewer.name));
}

function isInboundReply(entry: ActivityEntry): boolean {
  if (entry.kind !== "email" || entry.emailKind === "ndr") return false;
  if (entry.direction === "out") return false;
  return entry.direction === "in" || entry.emailKind === "inbound" || entry.emailKind === "reply";
}

export function isUnreadActivity(entry: ActivityEntry, cutoff: string | null | undefined, viewer?: ActivityViewer): boolean {
  if (!cutoff || entry.kind === "event" || viewerMatchesActor(entry, viewer)) return false;
  if (entry.kind !== "comment" && !isInboundReply(entry)) return false;
  const entryTime = Date.parse(activityArrivalTimestamp(entry));
  const cutoffTime = Date.parse(cutoff);
  return Number.isFinite(entryTime) && Number.isFinite(cutoffTime) && entryTime > cutoffTime;
}

export function mergeActivityEntries(
  serverEntries: readonly ClientReconciledActivityEntry[],
  optimisticEntries: readonly ClientReconciledActivityEntry[] = [],
): ClientReconciledActivityEntry[] {
  const reconciledOptimisticIds = new Set(
    serverEntries.flatMap((entry) => entry.clientReconciliationId ? [entry.clientReconciliationId] : []),
  );
  const byId = new Map<string, ClientReconciledActivityEntry>();
  for (const entry of optimisticEntries) {
    if (!reconciledOptimisticIds.has(entry.id)) byId.set(activityEntryKey(entry), entry);
  }
  for (const entry of serverEntries) byId.set(activityEntryKey(entry), entry);
  return suppressDuplicatedEmailAuditEvents([...byId.values()]).sort(compareActivityEntries);
}

function emailAuditAttemptId(entry: ActivityEntry): string | null {
  const eventType = entry.type ?? entry.action;
  if (entry.kind !== "event" || !eventType?.match(/^(?:invoice|document)\.email_(?:replied|forwarded)$/)) return null;
  const value = entry.changes?.attemptId;
  return typeof value === "string" && value ? value : null;
}

function normalizedReceivedAt(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function inboundEmailAuditReceivedAt(entry: ActivityEntry): number | null {
  const eventType = entry.type ?? entry.action;
  if (entry.kind !== "event" || !eventType?.match(/^(?:invoice|document)\.email_reply_received$/)) return null;
  return normalizedReceivedAt(entry.changes?.receivedAt);
}

function suppressDuplicatedEmailAuditEvents(entries: readonly ClientReconciledActivityEntry[]): ClientReconciledActivityEntry[] {
  const confirmedEmailIds = new Set(entries.filter((entry) => entry.kind === "email" && entry.direction === "out" && entry.status === "confirmed").map((entry) => entry.id));
  const inboundEmailReceivedAt = new Set(entries.flatMap((entry) => entry.kind === "email" && entry.direction === "in" ? [normalizedReceivedAt(entry.receivedAt)] : []).filter((receivedAt): receivedAt is number => receivedAt !== null));
  return entries.filter((entry) => {
    const attemptId = emailAuditAttemptId(entry);
    const receivedAt = inboundEmailAuditReceivedAt(entry);
    return (!attemptId || !confirmedEmailIds.has(attemptId)) && (!receivedAt || !inboundEmailReceivedAt.has(receivedAt));
  });
}

function compareActivityEntries(a: ActivityEntry, b: ActivityEntry): number {
  const aTime = Date.parse(activityArrivalTimestamp(a));
  const bTime = Date.parse(activityArrivalTimestamp(b));
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
  if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(bTime) ? 1 : -1;
  const arrivalTie = activityArrivalTimestamp(b).localeCompare(activityArrivalTimestamp(a));
  if (arrivalTie !== 0) return arrivalTie;
  return b.id.localeCompare(a.id);
}

export function isAfterActivityCutoff(entry: ActivityEntry, cutoff: string | null | undefined): boolean {
  if (!cutoff) return false;
  const entryTime = Date.parse(activityArrivalTimestamp(entry));
  const cutoffTime = Date.parse(cutoff);
  return Number.isFinite(entryTime) && Number.isFinite(cutoffTime) && entryTime > cutoffTime;
}

export function shouldStartActorGroup(previous: ActivityEntry | undefined, entry: ActivityEntry, _cutoff?: string | null, _viewer?: ActivityViewer): boolean {
  if (!previous) return true;
  const previousDate = new Date(activityTimestamp(previous)).toDateString();
  const entryDate = new Date(activityTimestamp(entry)).toDateString();
  return activityActorKey(previous) !== activityActorKey(entry)
    || previousDate !== entryDate
    || isUnreadActivity(previous, _cutoff, _viewer) !== isUnreadActivity(entry, _cutoff, _viewer);
}

export function activityDayLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
  if (dateKey === todayKey) return "Today";
  if (dateKey === yesterdayKey) return "Yesterday";
  return date.toLocaleDateString([], { dateStyle: "medium" });
}

function isSystemActivity(entry: ActivityEntry): boolean {
  if (entry.kind !== "event" || entry.actor?.userId) return false;
  const actorName = entry.actor?.name?.trim().toLowerCase();
  return !actorName || actorName === "system" || actorName.startsWith("system ") || actorName === "mail intake" || actorName === "mail delivery";
}

export function foldConsecutiveSystemEntries(entries: readonly ActivityEntry[]): FoldedActivityGroup[] {
  const groups: FoldedActivityGroup[] = [];
  for (const entry of entries) {
    const previous = groups[groups.length - 1];
    const previousEntry = previous?.entries[previous.entries.length - 1];
    const previousDate = Date.parse(activityTimestamp(previousEntry ?? entry));
    const entryDate = Date.parse(activityTimestamp(entry));
    const sameDay = previousEntry && Number.isFinite(previousDate) && Number.isFinite(entryDate)
      && new Date(previousDate).toDateString() === new Date(entryDate).toDateString();
    if (previous && isSystemActivity(entry) && previousEntry && isSystemActivity(previousEntry) && sameDay) {
      previous.entries.push(entry);
      previous.foldedSystem = true;
      continue;
    }
    groups.push({ entries: [entry], foldedSystem: false });
  }
  return groups;
}
