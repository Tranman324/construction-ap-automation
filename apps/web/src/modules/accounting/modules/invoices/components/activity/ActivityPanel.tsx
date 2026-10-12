"use client";

import { CornerUpLeft, CornerUpRight, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/modules/shared/lib/auth";
import { resolvePlatformUserPhotoUrl } from "@/modules/shared/lib/userProfile";
import { useCreateComment, useForwardDocument, useMarkActivityViewed, usePromoteInboundAttachment, useReplyToDocument } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useActivity, useCollaborationDirectory, useForwardDefaults, useInboundAttachments, useReplyRecipient } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { CollaborationRouteFamily } from "@/modules/accounting/modules/invoices/hooks/collaborationRoutes";
import type { ActivityEntry, AuditEntry } from "@/modules/accounting/modules/invoices/types/api";
import type { InvoiceEmail } from "@/modules/accounting/modules/invoices/types/invoice";
import type { DocumentAction } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { ActivityFeed } from "./ActivityFeed";
import { CollaborationComposer, type CollaborationMode } from "./CollaborationComposer";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";

interface ActivityPanelProps {
  documentId: string;
  active: boolean;
  email?: InvoiceEmail | null;
  fallbackEntries?: readonly AuditEntry[];
  canComment?: boolean;
  canEmail?: boolean;
  readOnly?: boolean;
  isTrash?: boolean;
  lockedReason?: string;
  unreadReplies?: number;
  unreadComments?: number;
  onActivityViewed?: (state: { unreadReplies: number; unreadComments: number }) => void;
  focusSignal?: number;
  composeRequest?: CollaborationComposeRequest;
  routeFamily?: CollaborationRouteFamily;
  serverBacked?: boolean;
}

export interface CollaborationComposeRequest {
  mode: CollaborationMode;
  sequence: number;
}

export function requestCollaborationCompose(documentId: string, mode: Exclude<CollaborationMode, null>) {
  window.dispatchEvent(new CustomEvent("document-collaboration-compose", { detail: { documentId, mode } }));
}

export function collaborationActionsFor(documentId: string, email?: InvoiceEmail | null, options?: { canEmail?: boolean; readOnly?: boolean; isTrash?: boolean }): DocumentAction[] {
  const canEmail = options?.canEmail ?? true;
  if (!canEmail || options?.readOnly || options?.isTrash) return [];
  const hasSourceMessage = Boolean(email?.messageId);
  return [
    { id: "reply", label: "Reply", icon: CornerUpLeft, disabled: !hasSourceMessage, disabledReason: hasSourceMessage ? undefined : "No source email message on file", onClick: () => requestCollaborationCompose(documentId, "reply") },
    { id: "forward", label: "Forward", icon: CornerUpRight, onClick: () => requestCollaborationCompose(documentId, "forward") },
  ];
}

function auditFallback(entries: readonly AuditEntry[]): ActivityEntry[] {
  return entries.map((entry) => ({ kind: "event", id: entry.id, action: entry.action, timestamp: entry.createdAt, actor: { name: entry.actor }, changes: entry.changes }));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ActivityPanel({ documentId, active, email, fallbackEntries = [], canComment = false, canEmail = false, readOnly = false, isTrash = false, lockedReason, unreadReplies = 0, unreadComments = 0, onActivityViewed, focusSignal = 0, composeRequest, routeFamily = "invoice", serverBacked = false }: ActivityPanelProps) {
  const collaborationAllowed = !readOnly && !isTrash;
  const commentsAllowed = canComment && collaborationAllowed;
  const emailAllowed = canEmail && collaborationAllowed;
  if (!serverBacked || !active) {
    return <ActivitySurface canComment={commentsAllowed} canEmail={emailAllowed} lockedReason={lockedReason}><ActivityFeed entries={auditFallback(fallbackEntries)} canComment={commentsAllowed} /></ActivitySurface>;
  }
  return <ServerBackedActivityPanel key={`${documentId}-${routeFamily}-${canComment}-${canEmail}-${readOnly}-${isTrash}-${composeRequest?.sequence ?? 0}`} documentId={documentId} active={active} email={email} fallbackEntries={fallbackEntries} canComment={commentsAllowed} canEmail={emailAllowed} readOnly={readOnly} isTrash={isTrash} lockedReason={lockedReason} unreadReplies={unreadReplies} unreadComments={unreadComments} onActivityViewed={onActivityViewed} focusSignal={focusSignal} composeRequest={composeRequest} routeFamily={routeFamily} />;
}

function ActivitySurface({ canComment, canEmail, lockedReason, children }: { canComment: boolean; canEmail: boolean; lockedReason?: string; children: ReactNode }) {
  const viewOnly = !canComment && !canEmail;
  return (
    <section className="space-y-3" aria-label="Activity" data-testid="collaboration-activity-panel">
      {viewOnly && <p className="inline-flex items-center gap-1 text-xs text-muted-foreground"><LockKeyhole className="h-3 w-3" aria-hidden="true" />{lockedReason ?? "Activity is view only."}</p>}
      {children}
    </section>
  );
}

function ActivityLoadingState() {
  return (
    <div className="space-y-4 py-4" role="status" aria-live="polite" aria-label="Loading activity">
      <Skeleton className="h-4 w-28" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
    </div>
  );
}

function ServerBackedActivityPanel({ documentId, active, email, canComment = false, canEmail = false, lockedReason, unreadReplies = 0, unreadComments = 0, onActivityViewed, focusSignal = 0, composeRequest, routeFamily = "invoice" }: ActivityPanelProps) {
  const { user: currentUser } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<CollaborationMode>(() => composeRequest?.mode ?? (canComment ? "comment" : null));
  const [error, setError] = useState<string | null>(null);
  const [unreadCutoff, setUnreadCutoff] = useState<string | null>(null);
  const [earlierPages, setEarlierPages] = useState<Record<number, ActivityEntry[]>>({});
  const [composeFocus, setComposeFocus] = useState(0);
  const [newCommentIds, setNewCommentIds] = useState<ReadonlySet<string>>(() => new Set());
  const viewedKey = useRef<string | null>(null);
  const viewInFlight = useRef<string | null>(null);
  const activityRouteFamily = routeFamily;
  const emailRouteFamily = routeFamily;
  const activity = useActivity(documentId, { offset: 0, routeFamily: activityRouteFamily });
  const earlierActivity = useActivity(documentId, { offset, enabled: offset > 0, routeFamily: activityRouteFamily });
  const hasInboundAttachments = activity.data?.entries.some((entry) => entry.kind === "email" && entry.direction === "in" && entry.hasAttachments && !entry.attachmentReviewed) ?? false;
  const inboundAttachments = useInboundAttachments(documentId, { enabled: hasInboundAttachments });
  const defaults = useForwardDefaults(documentId, { enabled: mode === "forward" && canEmail, routeFamily: emailRouteFamily });
  const replyRecipient = useReplyRecipient(documentId, { enabled: mode === "reply" && canEmail, routeFamily: emailRouteFamily });
  const directory = useCollaborationDirectory({ enabled: mode === "forward" && canEmail });
  const createComment = useCreateComment();
  const markViewed = useMarkActivityViewed();
  const reply = useReplyToDocument();
  const forward = useForwardDocument();
  const promoteAttachment = usePromoteInboundAttachment();
  useEffect(() => {
    if (earlierActivity.data?.pagination.offset !== offset || offset === 0) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setEarlierPages((current) => current[offset] ? current : { ...current, [offset]: earlierActivity.data?.entries ?? [] });
    });
    return () => { cancelled = true; };
  }, [earlierActivity.data, offset]);

  const entries = [
    ...(activity.data?.entries ?? []),
    ...Object.entries(earlierPages).sort(([a], [b]) => Number(a) - Number(b)).flatMap(([, page]) => page),
    ...(offset > 0 && !earlierPages[offset] ? earlierActivity.data?.entries ?? [] : []),
  ];
  useEffect(() => {
    if (composeRequest) return undefined;
    const onCompose = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId?: string; mode?: CollaborationMode }>).detail;
      if (detail?.documentId === documentId && detail.mode) { setMode(detail.mode); setComposeFocus((value) => value + 1); }
    };
    window.addEventListener("document-collaboration-compose", onCompose);
    return () => window.removeEventListener("document-collaboration-compose", onCompose);
  }, [composeRequest, documentId]);

  useEffect(() => {
    if (!active || viewedKey.current === documentId || viewInFlight.current === documentId) return;
    viewInFlight.current = documentId;
    void markViewed.mutateAsync({ id: documentId, routeFamily: activityRouteFamily }).then((response) => {
      viewedKey.current = documentId;
      viewInFlight.current = null;
      setUnreadCutoff(response.priorActivityViewedAt);
      onActivityViewed?.({ unreadReplies: response.unreadReplies, unreadComments: response.unreadComments });
    }).catch(() => {
      viewInFlight.current = null;
    });
  }, [active, activityRouteFamily, documentId, markViewed, onActivityViewed]);

  async function postComment(body: string) {
    setError(null);
    try {
      const response = await createComment.mutateAsync({ id: documentId, routeFamily: activityRouteFamily, payload: { body } });
      setNewCommentIds((current) => new Set(current).add(response.comment.id));
    } catch (cause) {
      const message = errorMessage(cause, "Comment could not be posted. Your text is still here.");
      setError(message);
      throw cause;
    }
  }

  async function sendReply(body: string, _sendToken?: string, recipient?: string) {
    if (!email?.messageId) throw new Error("Reply is unavailable because this document has no source email message.");
    setError(null);
    try { await reply.mutateAsync({ id: documentId, routeFamily: emailRouteFamily, payload: { body, ...(recipient ? { recipient } : {}) } }); await activity.refetch(); }
    catch (cause) { const message = errorMessage(cause, "Reply could not be sent. Your text is still here."); setError(message); throw cause; }
  }

  async function sendForward(recipientIds: readonly string[], body: string) {
    setError(null);
    try { await forward.mutateAsync({ id: documentId, routeFamily: emailRouteFamily, payload: { recipients: [...recipientIds], body } }); await activity.refetch(); }
    catch (cause) { const message = errorMessage(cause, "Forward could not be sent. Your text is still here."); setError(message); throw cause; }
  }

  async function promoteInboundAttachment(attachmentId: string) {
    const response = await promoteAttachment.mutateAsync({ id: documentId, attachmentId });
    await activity.refetch();
    return response;
  }

  const pending = createComment.isPending || reply.isPending || forward.isPending;
  const hasMore = (offset > 0 ? earlierActivity.data?.pagination.hasMore : activity.data?.pagination.hasMore) ?? false;
  const recipients = (directory.data ?? []).map((recipient) => ({ userId: recipient.id, name: recipient.name, email: recipient.email, avatarUrl: resolvePlatformUserPhotoUrl({ id: recipient.id, azure_id: recipient.azure_id, avatar_url: recipient.avatar_url }) }));
  const loadEarlier = () => {
    if (offset > 0 && !earlierPages[offset] && earlierActivity.isFetching) return;
    if (offset > 0 && earlierPages[offset] && !earlierActivity.data?.pagination.hasMore) return;
    setOffset((current) => current + 50);
  };
  const unreadCount = unreadReplies + unreadComments;
  const jumpToNewest = () => {
    const scroller = panelRef.current?.closest<HTMLElement>(".overflow-y-auto");
    scroller?.scrollTo?.({ top: 0, behavior: "smooth" });
  };
  const feedProps = {
    entries,
    unreadCutoff,
    currentUser,
    unreadCount,
    hasMore,
    loadingEarlier: activity.isFetching || earlierActivity.isFetching,
    onLoadEarlier: loadEarlier,
    onJump: jumpToNewest,
    documentId,
    inboundAttachments: inboundAttachments.data?.attachments,
    inboundAttachmentsLoading: inboundAttachments.isFetching,
    inboundAttachmentsError: inboundAttachments.error?.message ?? null,
    onPromoteAttachment: promoteInboundAttachment,
    promotingAttachmentId: promoteAttachment.isPending ? promoteAttachment.variables?.attachmentId : null,
    newEntryIds: newCommentIds,
  };
  return <div ref={panelRef}><ActivitySurface canComment={canComment} canEmail={canEmail} lockedReason={lockedReason}><CollaborationComposer documentId={documentId} currentUser={currentUser} focusSignal={focusSignal + composeFocus} mode={mode} email={email} replyResolution={replyRecipient.data} replyResolutionLoading={replyRecipient.isFetching} recipients={defaults.data?.defaultRecipients ?? []} directory={recipients} canComment={canComment} canEmail={canEmail} pending={pending} error={error} onModeChange={setMode} onComment={postComment} onReply={sendReply} onForward={sendForward} />{activity.data ? <ActivityFeed {...feedProps} canComment={canComment} /> : <ActivityLoadingState />}</ActivitySurface></div>;
}
