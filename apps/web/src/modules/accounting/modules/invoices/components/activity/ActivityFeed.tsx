"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  Download,
  Eye,
  LoaderCircle,
  Mail,
  Paperclip,
  Settings2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { UserAvatar } from "@/modules/shared/components/UserAvatar";
import { cn } from "@/modules/shared/lib/utils";
import { resolvePlatformUserPhotoUrl } from "@/modules/shared/lib/userProfile";
import type {
  ActivityEntry,
  InboundAttachment,
  InboundPromotionResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import { prepareDocumentEmailHtmlForFrame } from "@/modules/accounting/modules/invoices/components/documents/DocumentEmailSection";
import {
  activityActorLabel,
  activityDayLabel,
  activityTimestamp,
  foldConsecutiveSystemEntries,
  isUnreadActivity,
  mergeActivityEntries,
  shouldStartActorGroup,
  type ActivityViewer,
} from "./feedMerge";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";

interface ActivityFeedProps {
  entries: readonly ActivityEntry[];
  optimisticEntries?: readonly ActivityEntry[];
  unreadCutoff?: string | null;
  hasMore?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
  showJump?: boolean;
  onJump?: () => void;
  unreadCount?: number;
  currentUser?: ActivityViewer;
  canComment?: boolean;
  documentId?: string;
  inboundAttachments?: readonly InboundAttachment[];
  inboundAttachmentsLoading?: boolean;
  inboundAttachmentsError?: string | null;
  onPromoteAttachment?: (attachmentId: string) => Promise<InboundPromotionResponse>;
  promotingAttachmentId?: string | null;
  newEntryIds?: ReadonlySet<string>;
}
interface FeedGroup {
  entries: ActivityEntry[];
  foldedSystem: boolean;
}

const eventTypeLabels: Record<string, string> = {
  file_undo: "Filing undone",
  permanently_deleted: "Permanently deleted",
  submitted_spectrum: "Submitted to Spectrum",
  submitted_to_spectrum: "Submitted to Spectrum",
};

const classificationLabels: Record<string, string> = {
  invoice: "Invoice",
  coi: "COI",
  "pay-application": "Pay Application",
  "lien-waiver": "Lien Waiver",
  "purchase-order": "Purchase Order",
  "credit-memo": "Credit Memo",
  "building-permit": "Building Permit",
  lien_waiver: "Lien Waiver",
  receipt: "Receipt",
  w9: "W-9",
  warranty: "Warranty",
  statement: "Statement",
  subcontract: "Subcontract",
  other: "Document",
};

const universalEventTypes = new Set([
  "flagged",
  "unflagged",
  "commented",
  "intake",
  "queued",
  "permanently_deleted",
  "restored",
  "discarded",
  "undiscarded",
  "action_undone",
  "split_created",
  "approved",
  "unapproved",
]);

const boilerplateSummaries = new Set([
  "invoice edited",
  "flagged for review",
  "unflagged",
  "invoice approved",
  "invoice unapproved",
  "invoice discarded",
  "invoice undiscarded",
  "invoice filed",
  "invoice unfiled",
  "invoice rejected",
  "invoice reconciled",
  "invoice unreconciled",
  "invoice restored",
  "invoice marked filed",
  "flag removed",
  "invoice review undone",
  "statement attributes updated",
]);

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { timeStyle: "short" });
}
function humanizeWords(value: string, titleCase = false): string {
  const words = value
    .replace(/sharePoint/g, "sharepoint")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const format = (word: string) => {
    const lower = word.toLowerCase();
    if (["id", "url", "api", "pdf", "ndr"].includes(lower))
      return lower.toUpperCase();
    if (lower === "sharepoint") return "SharePoint";
    if (lower === "spectrum") return "Spectrum";
    return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
  };
  return words
    .map((word, index) =>
      titleCase || index === 0 ? format(word) : word.toLowerCase()
    )
    .join(" ");
}
function eventLabel(entry: ActivityEntry): string {
  const type = entry.type?.trim().replace(/^(?:invoice|document)\./i, "");
  const baseLabel = type
    ? (eventTypeLabels[type] ?? humanizeWords(type))
    : entry.action?.trim()
      ? entry.action.replace(/[-_]/g, " ")
      : "Activity";
  const label = entry.undoneAt ? `${baseLabel} (undone)` : baseLabel;
  const normalizedType = type?.toLowerCase().replace(/-/g, "_");
  const classification = classificationLabels[entry.documentClassification ?? ""];
  return normalizedType && !universalEventTypes.has(normalizedType) && classification
    ? `${label} – ${classification}`
    : label;
}
function redactOpaqueText(value: string): string {
  return value
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[redacted]"
    )
    .replace(/\b(?:AAMk|AQMk|AAQk)[A-Za-z0-9_-]{24,}\b/g, "[redacted]");
}
function isIsoTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    ) && !Number.isNaN(new Date(value).getTime())
  );
}
function isDateOnly(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00`).getTime())
  );
}
function formatChangeValue(value: unknown, absentLabel = "—"): string {
  if (value == null || value === "") return absentLabel;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string")
    return isIsoTimestamp(value)
      ? new Date(value).toLocaleString([], {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : isDateOnly(value)
        ? new Date(`${value}T00:00:00`).toLocaleDateString([], {
            dateStyle: "medium",
          })
      : redactOpaqueText(value);
  if (typeof value === "object") {
    try {
      return redactOpaqueText(JSON.stringify(value) ?? "—");
    } catch {
      return "—";
    }
  }
  return String(value);
}
function isActivityMetadataField(field: string): boolean {
  const normalized = field.replace(/[_-]/g, "").toLowerCase();
  return (
    normalized === "requestconversationid" ||
    normalized === "conversationid" ||
    normalized === "correlationid" ||
    normalized === "sourceattachmentid" ||
    normalized === "flagreason" ||
    normalized.endsWith("messageid")
  );
}

function normalizedActivityIdentifier(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/[.\s-]+/g, "_") ?? "";
}

function isWaiverRequestEvent(entry: ActivityEntry): boolean {
  return [entry.type, entry.action].some((value) => {
    const normalized = normalizedActivityIdentifier(value);
    return normalized === "request_waiver" || normalized.endsWith("waiver_requested");
  });
}

function isWaiverRequestDisplayField(field: string): boolean {
  return ["method", "resend", "mailbox", "subject", "emailsubject"].includes(
    field.replace(/[_-]/g, "").toLowerCase(),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStatementAttributeUpdateEvent(entry: ActivityEntry): boolean {
  return [entry.type, entry.action].some(
    (value) => normalizedActivityIdentifier(value)?.endsWith("statement_attributes_updated")
  );
}

function statementAttributeValue(
  state: unknown,
  field: "balance" | "statementPeriod"
): { value: unknown; source: string | null } | null {
  const resolved = isRecord(state) && isRecord(state.resolved)
    ? state.resolved
    : null;
  const attribute = resolved && isRecord(resolved[field])
    ? resolved[field]
    : null;
  if (!attribute) return null;
  return {
    value: attribute.value ?? null,
    source:
      typeof attribute.source === "string" && attribute.source.trim()
        ? humanizeWords(attribute.source)
        : null,
  };
}

function statementAttributeChangeFields(
  changes: Record<string, unknown>,
  entry?: ActivityEntry
): [string, unknown][] | null {
  if (!entry || !isStatementAttributeUpdateEvent(entry)) return null;
  const states = changes.statementAttributes;
  if (!Array.isArray(states) || states.length !== 2) return null;

  const fields: [string, unknown][] = [];
  let recognized = false;
  for (const [field, label] of [
    ["balance", "Balance"],
    ["statementPeriod", "Statement Period"],
  ] as const) {
    const before = statementAttributeValue(states[0], field);
    const after = statementAttributeValue(states[1], field);
    if (!before && !after) continue;
    recognized = true;

    if (before?.value !== after?.value) {
      fields.push([label, [before?.value ?? null, after?.value ?? null]]);
    }
    if (before?.source !== after?.source) {
      fields.push([`${label} Source`, [before?.source ?? null, after?.source ?? null]]);
    }
  }
  return recognized ? fields : null;
}

function visibleChangeFields(changes: Record<string, unknown>, entry?: ActivityEntry) {
  const statementFields = statementAttributeChangeFields(changes, entry);
  if (statementFields) return statementFields;
  return Object.entries(changes).filter(
    ([field]) =>
      !isActivityMetadataField(field) &&
      !(entry && isWaiverRequestEvent(entry) && isWaiverRequestDisplayField(field))
  );
}

function readActorText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function looksLikeEmail(value: string | null): boolean {
  return value?.includes("@") ?? false;
}

function actorDisplay(entry: ActivityEntry) {
  const actor = entry.actor;
  const name = readActorText(actor?.name);
  const userId = readActorText(actor?.userId);
  const azureId = readActorText(actor?.azureId ?? actor?.azure_id);
  const avatarUrl = readActorText(actor?.avatarUrl ?? actor?.avatar_url);
  const actorName = name?.toLowerCase();
  const nonPlatformActor =
    actor?.role === "external" ||
    entry.emailKind === "ndr" ||
    actorName === "system" ||
    actorName === "mail intake" ||
    actorName === "mail delivery" ||
    userId?.toLowerCase() === "system";
  const unresolvedInternal =
    !nonPlatformActor &&
    actorName === "former user";
  const platformActor = !nonPlatformActor && Boolean(userId || azureId || avatarUrl);
  const trustworthyName = name && !looksLikeEmail(name) ? name : null;
  const displayName = unresolvedInternal
    ? "Former user"
    : platformActor
    ? (trustworthyName ?? name ?? "Former user")
    : (name ?? activityActorLabel(entry));
  const photoUrl =
    platformActor && !unresolvedInternal
      ? resolvePlatformUserPhotoUrl({
          id: userId ?? azureId ?? "",
          azure_id: azureId ?? userId,
          avatar_url: avatarUrl,
          name: displayName,
        })
      : null;

  return { displayName, photoUrl };
}

function isSystemActor(entry: ActivityEntry, displayName: string): boolean {
  const actorName = displayName.toLowerCase();
  return (
    entry.emailKind === "ndr" ||
    (entry.kind === "event" &&
      !entry.actor?.userId &&
      !entry.actor?.azureId &&
      (!entry.actor?.name ||
        actorName.startsWith("system") ||
        actorName === "mail intake" ||
        actorName === "mail delivery"))
  );
}

function groupTime(entries: readonly ActivityEntry[]): string {
  const newest = entries[0];
  const oldest = entries.at(-1);
  if (!newest || !oldest) return "";
  const newestTime = formatTime(activityTimestamp(newest));
  const oldestTime = formatTime(activityTimestamp(oldest));
  return newestTime === oldestTime ? newestTime : `${oldestTime}–${newestTime}`;
}

function DiffDetails({
  changes,
  entry,
}: {
  changes: Record<string, unknown>;
  entry: ActivityEntry;
}) {
  const fields = visibleChangeFields(changes, entry);
  if (!fields.length) return null;
  return (
    <dl className="mt-1.5 rounded-md border border-border bg-muted/20 p-2 text-2xs">
      {fields.map(([field, value]) => (
        <div
          key={field}
          className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-2 py-0.5"
        >
          <dt className="font-medium text-foreground">
            {humanizeWords(field, true)}
          </dt>
          <dd className="min-w-0 text-muted-foreground">
            {Array.isArray(value) && value.length === 2 ? (
              <>
                <span
                  className="flex min-w-0 items-center gap-1"
                  aria-hidden="true"
                >
                  <span className="min-w-0 break-words text-muted-foreground line-through">
                    {formatChangeValue(value[0])}
                  </span>
                  <ChevronRight
                    className="h-3 w-3 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 break-words font-semibold text-foreground">
                    {formatChangeValue(value[1], "Cleared")}
                  </span>
                </span>
                <span className="sr-only">
                  {`${formatChangeValue(value[0])} → ${formatChangeValue(value[1], "Cleared")}`}
                </span>
              </>
            ) : (
              <span className="break-words">{formatChangeValue(value)}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function emailPreview(entry: ActivityEntry): string {
  return entry.bodyPreview ?? entry.subject ?? "";
}

function attachmentUrl(documentId: string, attachmentId: string, action: "preview" | "download"): string {
  const base = typeof window === "undefined" ? "/api/documents" : "/api/backend/documents";
  return `${base}/${encodeURIComponent(documentId)}/inbound-attachments/${encodeURIComponent(attachmentId)}/${action}`;
}

function attachmentSize(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function canPreviewAttachment(contentType: string): boolean {
  return /^(?:application\/pdf|image\/(?:gif|jpe?g|png|tiff?))$/i.test(contentType);
}

function AttachmentReview({
  documentId,
  attachments,
  loading,
  error,
  onPromote,
  promotingAttachmentId,
}: {
  documentId?: string;
  attachments: readonly InboundAttachment[];
  loading?: boolean;
  error?: string | null;
  onPromote?: (attachmentId: string) => Promise<InboundPromotionResponse>;
  promotingAttachmentId?: string | null;
}) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<Record<string, string>>({});
  const [promotionError, setPromotionError] = useState<string | null>(null);

  async function promote(attachmentId: string) {
    if (!onPromote) return;
    setPromotionError(null);
    try {
      const response = await onPromote(attachmentId);
      setPromoted((current) => ({ ...current, [attachmentId]: response.documentId }));
    } catch (cause) {
      setPromotionError(cause instanceof Error ? cause.message : "This attachment could not be created as a new document.");
    }
  }

  return (
    <div className="mt-2 rounded border border-border bg-background/70 p-2" data-testid="inbound-attachment-review">
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <Paperclip className="h-3 w-3" aria-hidden="true" />
        Attachment received for review
      </p>
      {loading && (
        <p className="mt-1 flex items-center gap-1 text-muted-foreground">
          <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading attachment details…
        </p>
      )}
      {error && <p className="mt-1 text-destructive">{error}</p>}
      {promotionError && <p className="mt-1 text-destructive" role="alert">{promotionError}</p>}
      {!loading && !error && attachments.length === 0 && (
        <p className="mt-1 text-muted-foreground">The attachment is no longer available in the mailbox.</p>
      )}
      <div className="mt-1.5 space-y-2">
        {attachments.map((attachment) => {
          const isReviewing = reviewingId === attachment.attachmentId;
          const resultDocumentId = promoted[attachment.attachmentId];
          const previewable = canPreviewAttachment(attachment.contentType);
          return (
            <div key={attachment.attachmentId} className="rounded border border-border/70 p-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 break-words font-medium text-foreground">{attachment.name}</span>
                {attachmentSize(attachment.sizeBytes) && (
                  <span className="text-3xs text-muted-foreground">{attachmentSize(attachment.sizeBytes)}</span>
                )}
                {resultDocumentId ? (
                  <span className="inline-flex items-center gap-1 text-3xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Created as new document
                  </span>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline"
                    onClick={() => setReviewingId(isReviewing ? null : attachment.attachmentId)}
                    aria-expanded={isReviewing}
                  >
                    <Eye className="h-3 w-3" aria-hidden="true" /> {isReviewing ? "Close review" : "Review"}
                  </button>
                )}
              </div>
              {isReviewing && documentId && (
                <div className="mt-2 space-y-2">
                  {previewable ? (
                    <iframe
                      src={attachmentUrl(documentId, attachment.attachmentId, "preview")}
                      sandbox=""
                      className="h-56 w-full rounded border border-border bg-white"
                      title={`Preview ${attachment.name}`}
                    />
                  ) : (
                    <p className="text-2xs text-muted-foreground">This file type cannot be shown here, but you can download it to review it.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={attachmentUrl(documentId, attachment.attachmentId, "download")}
                      className="inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline"
                      download
                    >
                      <Download className="h-3 w-3" aria-hidden="true" /> Download
                    </a>
                    {onPromote && (
                      <button
                        type="button"
                        className="rounded bg-primary px-2 py-1 text-2xs font-medium text-primary-foreground disabled:opacity-60"
                        onClick={() => void promote(attachment.attachmentId)}
                        disabled={promotingAttachmentId === attachment.attachmentId}
                      >
                        {promotingAttachmentId === attachment.attachmentId ? "Creating…" : "Create as new document"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SafeEmailBody({ entry, title }: { entry: ActivityEntry; title: string }) {
  if (entry.sanitizedBodyHtml) {
    return (
      <iframe
        srcDoc={prepareDocumentEmailHtmlForFrame(entry.sanitizedBodyHtml)}
        sandbox=""
        className="h-56 w-full rounded border border-border bg-white"
        title={title}
      />
    );
  }
  return (
    <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 text-muted-foreground">
      {entry.body ?? entry.bodyPreview ?? "No message details were recorded."}
    </div>
  );
}

function MailCard({
  entry,
  isNew,
  documentId,
  inboundAttachments,
  inboundAttachmentsLoading,
  inboundAttachmentsError,
  onPromoteAttachment,
  promotingAttachmentId,
}: {
  entry: ActivityEntry;
  isNew: boolean;
  documentId?: string;
  inboundAttachments?: readonly InboundAttachment[];
  inboundAttachmentsLoading?: boolean;
  inboundAttachmentsError?: string | null;
  onPromoteAttachment?: (attachmentId: string) => Promise<InboundPromotionResponse>;
  promotingAttachmentId?: string | null;
}) {
  const [bodyOpen, setBodyOpen] = useState(false);
  const outbound = entry.direction === "out";
  const recipient = entry.to?.filter(Boolean).join(", ");
  const address = outbound
    ? recipient
      ? `To ${recipient}`
      : "To recipients"
    : (entry.from ?? activityActorLabel(entry));
  return (
    <article
      className={`rounded-md border px-3 py-2 text-xs ${outbound ? "border-primary/25 bg-primary/5" : "border-border bg-muted/20"}`}
      aria-label={outbound ? "Outbound email" : "Inbound email"}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-medium text-foreground">
        {outbound ? (
          <CornerUpLeft className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span>{address}</span>
        {entry.verifiedParticipant === false && (
          <span
            className="rounded bg-amber-100 px-1 py-0.5 text-3xs font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            title="This reply came from an address outside the original conversation"
          >
            Unverified sender
          </span>
        )}
        {entry.correlationState === "ambiguous" && (
          <span className="rounded bg-amber-100 px-1 py-0.5 text-3xs font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Held for review
          </span>
        )}
        {entry.status === "ambiguous" && (
          <span className="rounded bg-amber-100 px-1 py-0.5 text-3xs font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Send status unknown
          </span>
        )}
        {isNew && (
          <span className="rounded bg-blue-100 px-1 py-0.5 text-3xs font-semibold uppercase tracking-wide text-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
            New
          </span>
        )}
      </div>
      {entry.subject && (
        <p className="mt-1 font-medium text-foreground">{entry.subject}</p>
      )}
      {emailPreview(entry) && (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">
          {emailPreview(entry)}
        </p>
      )}
      {!outbound && (entry.sanitizedBodyHtml || entry.body) && (
        <div className="mt-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline"
            onClick={() => setBodyOpen((value) => !value)}
            aria-expanded={bodyOpen}
          >
            {bodyOpen ? "Hide full message" : "View full message"}
            <ChevronDown className={`h-3 w-3 transition-transform ${bodyOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {bodyOpen && <div className="mt-1"><SafeEmailBody entry={entry} title="Inbound email body" /></div>}
        </div>
      )}
      {!outbound && entry.hasAttachments && !entry.attachmentReviewed && (
        <AttachmentReview
          documentId={documentId}
          attachments={inboundAttachments ?? []}
          loading={inboundAttachmentsLoading}
          error={inboundAttachmentsError}
          onPromote={onPromoteAttachment}
          promotingAttachmentId={promotingAttachmentId}
        />
      )}
    </article>
  );
}
function NdrCard({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  const disclosureId = useId();
  const failedMessage = entry.body ?? entry.bodyPreview;
  return (
    <article
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
      aria-label="Delivery failed"
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle
          className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300"
          aria-hidden="true"
        />
        Delivery failed
        <span className="rounded bg-amber-100 px-1 py-0.5 text-3xs uppercase tracking-wide dark:bg-amber-950/50">
          NDR
        </span>
      </p>
      <p className="mt-1 text-amber-900 dark:text-amber-100">
        The mail system reported the message was undeliverable.
      </p>
      <button
        type="button"
        aria-controls={disclosureId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        {open ? "Hide the message that failed" : "Show the message that failed"}
      </button>
      {open && (
        <div id={disclosureId} className="mt-1 rounded border border-amber-300/70 bg-amber-100/50 p-2 dark:border-amber-800 dark:bg-amber-950/20">
          {entry.subject && <p className="font-medium text-amber-950 dark:text-amber-50">{entry.subject}</p>}
          {entry.sanitizedBodyHtml ? (
            <div className="mt-1">
              <SafeEmailBody entry={entry} title="Original delivery-failure message" />
            </div>
          ) : failedMessage ? (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-amber-900 dark:text-amber-100">{failedMessage}</p>
          ) : (
            <p className="text-amber-900 dark:text-amber-100">No additional message details were recorded.</p>
          )}
        </div>
      )}
    </article>
  );
}
function FoldedMail({
  entry,
  isNew,
  documentId,
  inboundAttachments,
  inboundAttachmentsLoading,
  inboundAttachmentsError,
  onPromoteAttachment,
  promotingAttachmentId,
}: {
  entry: ActivityEntry;
  isNew: boolean;
  documentId?: string;
  inboundAttachments?: readonly InboundAttachment[];
  inboundAttachmentsLoading?: boolean;
  inboundAttachmentsError?: string | null;
  onPromoteAttachment?: (attachmentId: string) => Promise<InboundPromotionResponse>;
  promotingAttachmentId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const label =
    entry.direction === "out"
      ? entry.emailKind === "forward"
        ? "Forwarded this document"
        : "Sent a reply"
      : "Replied";
  if (!open)
    return (
      <button
        type="button"
        className="flex items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
        aria-expanded="false"
        onClick={() => setOpen(true)}
      >
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="font-semibold text-foreground">{label}</span>
        {isNew && (
          <span className="text-3xs font-semibold uppercase tracking-wide text-blue-700">
            New
          </span>
        )}
      </button>
    );
  return (
    <div>
      <MailCard
        entry={entry}
        isNew={isNew}
        documentId={documentId}
        inboundAttachments={inboundAttachments}
        inboundAttachmentsLoading={inboundAttachmentsLoading}
        inboundAttachmentsError={inboundAttachmentsError}
        onPromoteAttachment={onPromoteAttachment}
        promotingAttachmentId={promotingAttachmentId}
      />
      <button
        type="button"
        className="mt-1 text-xs font-medium text-primary hover:underline"
        aria-expanded="true"
        onClick={() => setOpen(false)}
      >
        Fold
      </button>
    </div>
  );
}
function EventRow({ entry }: { entry: ActivityEntry }) {
  const rawDetail = redactOpaqueText(entry.summary ?? entry.bodyPreview ?? "");
  const detail = boilerplateSummaries.has(rawDetail.trim().toLowerCase())
    ? ""
    : rawDetail;
  const hasVisibleChanges = Boolean(
    entry.changes && visibleChangeFields(entry.changes, entry).length
  );
  return (
    <div className="text-xs text-muted-foreground">
      <p className="font-semibold text-foreground">{eventLabel(entry)}</p>
      {detail && <p>{detail}</p>}
      {entry.changes && hasVisibleChanges && (
        <DiffDetails changes={entry.changes} entry={entry} />
      )}
    </div>
  );
}
function SystemEventRun({ entries }: { entries: readonly ActivityEntry[] }) {
  const [open, setOpen] = useState(false);
  const summary = entries.slice(0, 3).map(eventLabel).join(" · ");
  return (
    <div data-testid="system-activity-group">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${entries.length} system events`}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="font-semibold text-foreground">{summary}</span>
        <span className="ml-auto shrink-0">{entries.length} events</span>
        <time className="shrink-0 font-mono tabular-nums text-2xs text-muted-foreground">
          {groupTime(entries)}
        </time>
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 border-l border-border pl-3">
          {entries.map((entry) => (
            <EventRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function actorGroups(
  entries: readonly ActivityEntry[],
  cutoff?: string | null,
  viewer?: ActivityViewer
): FeedGroup[] {
  const groups: FeedGroup[] = [];
  for (const unit of foldConsecutiveSystemEntries(entries)) {
    const entry = unit.entries[0];
    const previous = groups.at(-1);
    const previousEntry = previous?.entries.at(-1);
    if (
      !unit.foldedSystem &&
      previous &&
      !previous.foldedSystem &&
      !shouldStartActorGroup(previousEntry, entry, cutoff, viewer)
    )
      previous.entries.push(entry);
    else
      groups.push({
        entries: [...unit.entries],
        foldedSystem: unit.foldedSystem,
      });
  }
  return groups;
}
function GroupItems({
  group,
  cutoff,
  viewer,
  documentId,
  inboundAttachments,
  inboundAttachmentsLoading,
  inboundAttachmentsError,
  onPromoteAttachment,
  promotingAttachmentId,
  newEntryIds,
}: {
  group: FeedGroup;
  cutoff?: string | null;
  viewer?: ActivityViewer;
  documentId?: string;
  inboundAttachments?: readonly InboundAttachment[];
  inboundAttachmentsLoading?: boolean;
  inboundAttachmentsError?: string | null;
  onPromoteAttachment?: (attachmentId: string) => Promise<InboundPromotionResponse>;
  promotingAttachmentId?: string | null;
  newEntryIds?: ReadonlySet<string>;
}) {
  if (group.foldedSystem) return <SystemEventRun entries={group.entries} />;
  const emailCount = group.entries.filter(
    (entry) => entry.kind === "email" && entry.emailKind !== "ndr"
  ).length;
  let emailIndex = 0;
  return (
    <div className="space-y-1.5">
      {group.entries.map((entry) => {
        const isNew = isUnreadActivity(entry, cutoff, viewer);
        const isNewComment = entry.kind === "comment" && newEntryIds?.has(entry.id) === true;
        const fold =
          entry.kind === "email" &&
          entry.emailKind !== "ndr" &&
          emailCount >= 3 &&
          emailIndex++ > 0;
        const content =
          entry.emailKind === "ndr" ? (
            <NdrCard entry={entry} />
          ) : entry.kind === "email" ? (
            fold ? (
              <FoldedMail
                entry={entry}
                isNew={isNew}
                documentId={documentId}
                inboundAttachments={inboundAttachments}
                inboundAttachmentsLoading={inboundAttachmentsLoading}
                inboundAttachmentsError={inboundAttachmentsError}
                onPromoteAttachment={onPromoteAttachment}
                promotingAttachmentId={promotingAttachmentId}
              />
            ) : (
              <MailCard
                entry={entry}
                isNew={isNew}
                documentId={documentId}
                inboundAttachments={inboundAttachments}
                inboundAttachmentsLoading={inboundAttachmentsLoading}
                inboundAttachmentsError={inboundAttachmentsError}
                onPromoteAttachment={onPromoteAttachment}
                promotingAttachmentId={promotingAttachmentId}
              />
            )
          ) : entry.kind === "comment" ? (
            <blockquote className="m-0 whitespace-pre-wrap break-words text-sm italic text-foreground">
              “{entry.body ?? entry.bodyPreview ?? ""}”
            </blockquote>
          ) : (
            <EventRow entry={entry} />
          );
        return (
          <div
            key={entry.id}
            className={cn("grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2", isNewComment && motionStyles.newActivityEntry)}
          >
            <time className="pt-0.5 text-right font-mono tabular-nums text-2xs text-muted-foreground">
              {formatTime(activityTimestamp(entry))}
            </time>
            <div
              className={
                isNew
                  ? "rounded-sm bg-blue-50/60 px-1 py-0.5 dark:bg-blue-950/20"
                  : ""
              }
            >
              {content}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ActivityFeed({
  entries,
  optimisticEntries = [],
  unreadCutoff,
  hasMore = false,
  loadingEarlier = false,
  onLoadEarlier,
  showJump,
  onJump,
  unreadCount = 0,
  currentUser,
  canComment = false,
  documentId,
  inboundAttachments,
  inboundAttachmentsLoading,
  inboundAttachmentsError,
  onPromoteAttachment,
  promotingAttachmentId,
  newEntryIds,
}: ActivityFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const merged = mergeActivityEntries(entries, optimisticEntries);
  const groups = actorGroups(merged, unreadCutoff, currentUser);
  useEffect(() => {
    const scrollContainer =
      feedRef.current?.closest<HTMLElement>(".overflow-y-auto");
    if (!scrollContainer) return undefined;
    const onScroll = () => setScrolled(scrollContainer.scrollTop > 120);
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => scrollContainer.removeEventListener("scroll", onScroll);
  }, [entries.length]);
  if (!merged.length)
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        <Activity className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
        <p>
          No activity on this document yet.
          {canComment ? " Your comment will be the first." : ""}
        </p>
      </div>
    );
  const hasUnread = merged.some((entry) =>
    isUnreadActivity(entry, unreadCutoff, currentUser)
  );
  const newBoundaryIndex = hasUnread
    ? groups.findIndex((group) =>
        group.entries.some(
          (entry) => !isUnreadActivity(entry, unreadCutoff, currentUser)
        )
      )
    : -1;
  return (
    <div
      ref={feedRef}
      className={`${motionStyles.spinnerScope} relative space-y-3`}
      aria-label="Activity feed"
    >
      {(showJump ?? (scrolled && unreadCount > 0)) && (
        <button
          type="button"
          aria-label="Jump to newest"
          onClick={onJump}
          className="sticky top-0 z-10 mx-auto flex rounded-full border bg-background px-3 py-1 text-xs font-medium text-primary shadow-sm"
        >
          {unreadCount > 0 ? `${unreadCount} new` : "Jump to newest"}
        </button>
      )}
      {groups.map((group, index) => {
        const entry = group.entries[0];
        const previous = groups[index - 1]?.entries.at(-1);
        const date = activityDayLabel(activityTimestamp(entry));
        const actor = actorDisplay(entry);
        const unread = group.entries.some((item) =>
          isUnreadActivity(item, unreadCutoff, currentUser)
        );
        const system = isSystemActor(entry, actor.displayName);
        return (
          <div
            key={group.entries.map((item) => item.id).join(":")}
            className="space-y-2"
          >
            {(!previous ||
              date !== activityDayLabel(activityTimestamp(previous))) && (
              <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span>{date}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            {index === newBoundaryIndex && (
              <div className="flex items-center gap-2 text-2xs font-semibold text-blue-700">
                <span className="h-px flex-1 bg-blue-200" />
                <span>New</span>
                <span className="h-px flex-1 bg-blue-200" />
              </div>
            )}
            <div className={unread ? "rounded-md bg-blue-50/30 px-1.5 py-1 dark:bg-blue-950/10" : ""}>
              <div className="mb-1 flex min-w-0 items-center gap-2">
                <div className="w-6 shrink-0">
                  {system ? (
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground"
                      aria-label="System"
                    >
                      <Settings2 className="h-3 w-3" aria-hidden="true" />
                    </span>
                  ) : (
                    <UserAvatar
                      user={{
                        name: actor.displayName,
                        image: actor.photoUrl,
                      }}
                      size="sm"
                    />
                  )}
                </div>
                <span className="min-w-0 truncate text-sm font-medium">
                  {actor.displayName}
                </span>
                <time className="ml-auto shrink-0 font-mono tabular-nums text-2xs text-muted-foreground">
                  {groupTime(group.entries)}
                </time>
              </div>
              <GroupItems
                group={group}
                cutoff={unreadCutoff}
                viewer={currentUser}
                documentId={documentId}
                inboundAttachments={inboundAttachments}
                inboundAttachmentsLoading={inboundAttachmentsLoading}
                inboundAttachmentsError={inboundAttachmentsError}
                onPromoteAttachment={onPromoteAttachment}
                promotingAttachmentId={promotingAttachmentId}
                newEntryIds={newEntryIds}
              />
            </div>
          </div>
        );
      })}
      {hasMore && (
        <button
          type="button"
          onClick={onLoadEarlier}
          disabled={loadingEarlier}
          className="mx-auto block rounded-md px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted"
        >
          {loadingEarlier
            ? "Loading earlier activity…"
            : "Show earlier activity"}
        </button>
      )}
    </div>
  );
}
