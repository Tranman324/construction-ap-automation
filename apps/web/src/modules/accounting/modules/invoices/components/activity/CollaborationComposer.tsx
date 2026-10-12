"use client";

import { CornerUpLeft, CornerUpRight, MessageSquare, Send } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { UserAvatar } from "@/modules/shared/components/UserAvatar";
import type { ForwardDefaultRecipient, ReplyRecipientResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { InvoiceEmail } from "@/modules/accounting/modules/invoices/types/invoice";
import { Button } from "@/modules/shared/components/ui/button";
import { Textarea } from "@/modules/shared/components/ui/textarea";

export type CollaborationMode = "comment" | "reply" | "forward" | null;
export type CollaborationAttachment = { name: string; sizeLabel: string; oversize?: boolean };

export interface CollaborationComposerProps {
  documentId?: string;
  draftOwner?: string;
  currentUser?: { name?: string | null; image?: string | null } | null;
  focusSignal?: number;
  inputLabel?: string;
  attachment?: CollaborationAttachment;
  mode: CollaborationMode;
  email?: InvoiceEmail | null;
  replyResolution?: ReplyRecipientResponse;
  replyResolutionLoading?: boolean;
  recipients: readonly ForwardDefaultRecipient[];
  directory?: readonly ForwardDefaultRecipient[];
  canComment: boolean;
  canEmail: boolean;
  pending?: boolean;
  error?: string | null;
  onModeChange: (mode: CollaborationMode) => void;
  onComment: (body: string) => Promise<void>;
  onReply: (body: string, sendToken: string, recipient?: string) => Promise<void>;
  onForward: (recipients: readonly string[], body: string, sendToken: string) => Promise<void>;
}

export const COMMENT_LIMIT = 2_000;
export const EMAIL_LIMIT = 5_000;
type DraftMode = Exclude<CollaborationMode, null>;
type Drafts = Record<DraftMode, string>;
type SubmissionFailure = { mode: DraftMode; message: string; ambiguous: boolean };
type ComposerState = {
  key: string | undefined;
  drafts: Drafts;
  selected: string[] | null;
  search: string;
  highlighted: number;
  directoryOpen: boolean;
  removedAttachment: CollaborationAttachment | null;
  submitFailure: SubmissionFailure | null;
  manualReply: string | null;
};

const EMPTY_DRAFTS: Drafts = { comment: "", reply: "", forward: "" };

function initialComposerState(key: string | undefined): ComposerState {
  return { key, drafts: readDrafts(key), selected: null, search: "", highlighted: 0, directoryOpen: false, removedAttachment: null, submitFailure: null, manualReply: null };
}

const MANUAL_REPLY_OPTION = "__manual__";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readDraft(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function readDrafts(key: string | undefined): Drafts {
  if (!key || typeof window === "undefined") return { ...EMPTY_DRAFTS };
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (!isRecord(parsed)) return { ...EMPTY_DRAFTS };
    return {
      comment: readDraft(parsed.comment, COMMENT_LIMIT),
      reply: readDraft(parsed.reply, EMAIL_LIMIT),
      forward: readDraft(parsed.forward, EMAIL_LIMIT),
    };
  } catch {
    return { ...EMPTY_DRAFTS };
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : "Message could not be sent. Your text is still here.";
}

function isAmbiguousFailure(cause: unknown): boolean {
  const code = isRecord(cause) && typeof cause.code === "string" ? cause.code : "";
  const status = isRecord(cause) && typeof cause.status === "number" ? cause.status : undefined;
  const message = cause instanceof Error ? cause.message : isRecord(cause) && typeof cause.message === "string" ? cause.message : "";
  return status === undefined || status === 408 || status === 504 || /ambiguous|may have sent|delivery unknown|timed? ?out/i.test(`${code} ${message}`);
}

function createSendToken(): string {
  return globalThis.crypto.randomUUID();
}

function isEmailSendShortcut(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === "Enter" && event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
}

function addId(current: string[] | null, defaults: readonly ForwardDefaultRecipient[], id: string): string[] {
  const ids = current ?? defaults.map((recipient) => recipient.userId);
  return ids.includes(id) ? ids : [...ids, id];
}

export function CollaborationComposer({ documentId, draftOwner, currentUser, focusSignal = 0, inputLabel, attachment, mode, email, replyResolution, replyResolutionLoading = false, recipients, directory = recipients, canComment, canEmail, pending = false, error, onModeChange, onComment, onReply, onForward }: CollaborationComposerProps) {
  const draftKey = documentId ? `document-collaboration-draft:${draftOwner ?? "current-user"}:${documentId}` : undefined;
  const [composerState, setComposerState] = useState<ComposerState>(() => initialComposerState(draftKey));
  const sendTokens = useRef<Record<"reply" | "forward", string | null>>({ reply: null, forward: null });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recipientBoxRef = useRef<HTMLDivElement>(null);
  const state = composerState.key === draftKey ? composerState : initialComposerState(draftKey);
  const { drafts, selected, search, highlighted, directoryOpen, removedAttachment, submitFailure, manualReply } = state;
  const activeAttachment = attachment === removedAttachment ? undefined : attachment;
  const limit = mode === "comment" ? COMMENT_LIMIT : EMAIL_LIMIT;
  const body = mode ? drafts[mode] : "";
  const defaultIds = recipients.map((recipient) => recipient.userId);
  const effectiveSelected = selected ?? defaultIds;
  const forwardHasRecipients = mode === "forward" && effectiveSelected.length > 0;
  const manualReplyActive = manualReply !== null;
  const manualReplyEmail = manualReplyActive && isValidEmail(manualReply) ? manualReply.trim().toLowerCase() : undefined;
  const replyOptions = replyResolution && replyResolution.recipientType !== "direct" ? [...replyResolution.candidates, ...replyResolution.directoryContacts] : [];
  const defaultReplyOption = replyOptions[0]?.email;
  const replyRecipient = replyResolution ? (replyResolution.recipientType === "direct" ? replyResolution.directEmail : manualReplyActive ? manualReplyEmail : selected?.[0] ?? defaultReplyOption) : undefined;
  const replyHasRecipient = !replyResolutionLoading && (!replyResolution || Boolean(replyRecipient));
  const canSubmit = mode !== null && !pending && body.length <= limit && (mode === "forward" ? forwardHasRecipients : mode === "reply" ? Boolean(body.trim()) && replyHasRecipient : Boolean(body.trim()));
  const available = directory.filter((recipient) => !effectiveSelected.includes(recipient.userId));
  const matches = available.filter((recipient) => !search.trim() || `${recipient.name} ${recipient.email}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 6);
  const displayedFailure = mode && submitFailure?.mode === mode ? submitFailure : null;
  const displayedMessage = displayedFailure?.message ?? error;

  function updateState(update: (current: ComposerState) => ComposerState) {
    setComposerState((current) => update(current.key === draftKey ? current : initialComposerState(draftKey)));
  }

  useEffect(() => {
    if (!draftKey) return;
    try {
      if (Object.values(drafts).some(Boolean)) window.localStorage.setItem(draftKey, JSON.stringify(drafts));
      else window.localStorage.removeItem(draftKey);
    } catch { /* local draft persistence is optional */ }
  }, [draftKey, drafts]);

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal, mode]);

  useEffect(() => {
    if (!directoryOpen) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !recipientBoxRef.current?.contains(event.target)) {
        setComposerState((current) => current.key === draftKey ? { ...current, directoryOpen: false } : current);
      }
    };
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [directoryOpen, draftKey]);

  async function submit() {
    const value = body.trim();
    if (!mode || pending || body.length > limit || (mode === "forward" ? effectiveSelected.length === 0 : !value)) return;
    updateState((current) => ({ ...current, submitFailure: null }));
    const sendToken = mode === "comment" ? undefined : (sendTokens.current[mode] ??= createSendToken());
    try {
      if (mode === "comment") await onComment(value);
      if (mode === "reply") {
        if (replyRecipient) await onReply(value, sendToken as string, replyRecipient);
        else await onReply(value, sendToken as string);
      }
      if (mode === "forward") await onForward(effectiveSelected, value, sendToken as string);
      if (mode !== "comment") sendTokens.current[mode] = null;
      updateState((current) => ({ ...current, drafts: { ...current.drafts, [mode]: "" }, selected: mode === "forward" || mode === "reply" ? null : current.selected, manualReply: mode === "reply" ? null : current.manualReply }));
    } catch (cause) {
      const ambiguous = isAmbiguousFailure(cause);
      if (mode !== "comment" && !ambiguous) sendTokens.current[mode] = null;
      updateState((current) => ({ ...current, submitFailure: { mode, message: errorText(cause), ambiguous } }));
    }
  }

  function handleMode(next: CollaborationMode) {
    if (next === "reply" && !email?.messageId) return;
    if (next !== "comment" && !canEmail) return;
    updateState((current) => ({ ...current, submitFailure: null, selected: next === "reply" || mode === "reply" ? null : current.selected, manualReply: next === "reply" || mode === "reply" ? null : current.manualReply }));
    onModeChange(next);
  }

  function cancelEmail() {
    if (mode !== "reply" && mode !== "forward") return;
    updateState((current) => ({ ...current, drafts: { ...current.drafts, [mode]: "" }, selected: mode === "forward" || mode === "reply" ? null : current.selected, manualReply: mode === "reply" ? null : current.manualReply, submitFailure: null }));
    onModeChange(canComment ? "comment" : null);
  }

  function addRecipient(userId: string) {
    updateState((current) => ({ ...current, selected: addId(current.selected, recipients, userId), search: "", highlighted: 0, directoryOpen: false }));
  }

  function updateDraft(modeToUpdate: DraftMode, value: string) {
    updateState((current) => ({ ...current, drafts: { ...current.drafts, [modeToUpdate]: value } }));
  }

  function removeRecipient(userId: string) {
    updateState((current) => ({ ...current, selected: (current.selected ?? defaultIds).filter((id) => id !== userId) }));
  }

  function selectReplyRecipient(value: string) {
    if (value === MANUAL_REPLY_OPTION) {
      updateState((current) => ({ ...current, selected: null, manualReply: "" }));
      return;
    }
    updateState((current) => ({ ...current, selected: value ? [value] : null, manualReply: null }));
  }

  function updateManualReply(value: string) {
    updateState((current) => ({ ...current, manualReply: value }));
  }

  function handleRecipientKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !search && effectiveSelected.length > 0) {
      event.preventDefault();
      removeRecipient(effectiveSelected[effectiveSelected.length - 1]);
      return;
    }
    if (event.key === "Backspace" && !search && effectiveSelected.length) {
      updateState((current) => ({ ...current, selected: (current.selected ?? defaultIds).slice(0, -1) }));
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateState((current) => ({ ...current, directoryOpen: true, highlighted: Math.min(Math.max(matches.length - 1, 0), current.highlighted + 1) }));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      updateState((current) => ({ ...current, highlighted: Math.max(0, current.highlighted - 1) }));
    }
    if (event.key === "Enter" && directoryOpen && matches[highlighted]) {
      event.preventDefault();
      addRecipient(matches[highlighted].userId);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      updateState((current) => ({ ...current, search: "", directoryOpen: false }));
    }
  }

  function recipientChip(userId: string) {
    const recipient = directory.find((item) => item.userId === userId) ?? recipients.find((item) => item.userId === userId);
    if (!recipient) return null;
    return <span key={userId} className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"><UserAvatar user={{ name: recipient.name, image: recipient.avatarUrl }} size="xs" />{recipient.name}<button type="button" aria-label={`Remove ${recipient.name}`} onClick={() => removeRecipient(userId)}>×</button></span>;
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-2" aria-label="Collaboration composer">
      <div className="flex gap-1" role="tablist" aria-label="Message type">
        {canComment && <button type="button" role="tab" aria-selected={mode === "comment"} onClick={() => handleMode("comment")} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${mode === "comment" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}><MessageSquare className="h-3.5 w-3.5" />Comment</button>}
        <button type="button" role="tab" aria-selected={mode === "reply"} disabled={!email?.messageId || !canEmail} title={!email?.messageId ? "No source email on file" : !canEmail ? "Email actions are unavailable" : undefined} onClick={() => handleMode("reply")} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${mode === "reply" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}><CornerUpLeft className="h-3.5 w-3.5" />Reply</button>
        <button type="button" role="tab" aria-selected={mode === "forward"} disabled={!canEmail} title={!canEmail ? "Email actions are unavailable" : undefined} onClick={() => handleMode("forward")} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${mode === "forward" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}><CornerUpRight className="h-3.5 w-3.5" />Forward</button>
      </div>
      {!mode && <p className="text-xs text-muted-foreground">{canEmail ? "Commenting is unavailable. Choose Reply or Forward when email actions are permitted." : "This activity is view only. Commenting and email actions are unavailable."}</p>}
      {mode && <>
        {mode === "reply" && replyResolutionLoading && <p className="text-xs text-muted-foreground">Determining a safe reply recipient…</p>}
        {mode === "reply" && !replyResolutionLoading && replyResolution?.recipientType === "direct" && <p className="text-xs text-muted-foreground">To: <span className="font-medium text-foreground">{replyResolution.directEmail}</span></p>}
        {mode === "reply" && !replyResolutionLoading && replyResolution && replyResolution.recipientType !== "direct" && <div className="space-y-1"><label htmlFor="reply-recipient" className="text-xs text-muted-foreground">{replyResolution.reason}. Choose a recipient to reply to.</label><select id="reply-recipient" aria-label="Reply recipient" value={manualReplyActive ? MANUAL_REPLY_OPTION : selected?.[0] ?? defaultReplyOption ?? ""} onChange={(event) => selectReplyRecipient(event.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">{!defaultReplyOption && <option value="" disabled>Choose a recipient</option>}{replyOptions.map((candidate) => <option key={candidate.email} value={candidate.email}>{candidate.email}</option>)}<option value={MANUAL_REPLY_OPTION}>Type an email address…</option></select>{manualReplyActive && <input type="email" aria-label="Manual reply recipient" value={manualReply ?? ""} onChange={(event) => updateManualReply(event.target.value)} placeholder="name@company.example" autoFocus className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />}{manualReplyActive && manualReply && !manualReplyEmail && <p className="text-xs text-destructive">Enter a valid email address.</p>}</div>}
        {mode === "reply" && !replyResolutionLoading && !replyResolution && <p className="text-xs text-muted-foreground">To: <span className="font-medium text-foreground">{email?.from}</span></p>}
        {mode === "forward" && <div ref={recipientBoxRef} className="relative space-y-1"><div className="flex flex-wrap items-center gap-1 rounded-md border border-input p-1"><div className="flex flex-wrap gap-1">{effectiveSelected.map(recipientChip)}</div><input value={search} aria-label="Forward to" placeholder={effectiveSelected.length ? "Add someone…" : "Search name or title…"} onFocus={() => updateState((current) => ({ ...current, directoryOpen: true }))} onChange={(event) => updateState((current) => ({ ...current, search: event.target.value, highlighted: 0, directoryOpen: true }))} onKeyDown={handleRecipientKeyDown} className="min-w-32 flex-1 border-0 px-1 py-1 text-xs outline-none" /></div>{directoryOpen && matches.length > 0 && <div role="listbox" aria-label="Forward recipients" className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">{matches.map((recipient, index) => <button key={recipient.userId} type="button" role="option" aria-selected={index === highlighted} onMouseEnter={() => updateState((current) => ({ ...current, highlighted: index }))} onClick={() => addRecipient(recipient.userId)} className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs ${index === highlighted ? "bg-muted" : ""} hover:bg-muted`}><UserAvatar user={{ name: recipient.name, image: recipient.avatarUrl }} size="xs" /><span className="flex min-w-0 flex-col"><span className="truncate font-medium">{recipient.name}</span><span className="truncate text-muted-foreground">{recipient.email}</span></span></button>)}</div>}</div>}
        {activeAttachment?.oversize && <p role="status" className="text-xs text-muted-foreground">PDF too large to attach — a view link will be included instead.</p>}
        {activeAttachment && <p className="flex items-center gap-2 text-xs text-muted-foreground">Attachment: {activeAttachment.name} ({activeAttachment.sizeLabel}) <button type="button" aria-label="Remove attachment" onClick={() => updateState((current) => ({ ...current, removedAttachment: activeAttachment }))}>Remove</button></p>}
        {mode === "comment" ? <>
          <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50" data-testid="comment-composer">
            <UserAvatar user={{ name: currentUser?.name ?? "You", image: currentUser?.image }} size="sm" className="shrink-0" />
            <Textarea ref={inputRef} rows={1} value={body} maxLength={limit} disabled={pending} aria-label={inputLabel ?? "Comment"} placeholder="Add a comment…" className="min-h-0 max-h-40 min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:border-0 focus-visible:ring-0" onChange={(event) => updateDraft("comment", event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); void submit(); } }} />
            <span className="shrink-0 text-xs text-muted-foreground">↵ post · ⇧↵ line</span>
            <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void submit()}>{pending ? "Posting…" : "Comment"}</Button>
          </div>
        </> : <>
          <Textarea ref={inputRef} value={body} maxLength={limit} disabled={pending} aria-label={inputLabel ?? (mode === "reply" ? "Reply message" : "Forward message")} placeholder={mode === "reply" ? "Write your reply…" : "Add a note for the recipients…"} onChange={(event) => { if (mode) updateDraft(mode, event.target.value); }} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (isEmailSendShortcut(event)) { event.preventDefault(); void submit(); } }} />
          <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{body.length}/{limit} · ⌘⇧↵ / Ctrl⇧↵ to send</span><div className="flex items-center gap-2"><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={cancelEmail}>Cancel</Button><Button type="button" disabled={!canSubmit} onClick={() => void submit()}>{pending ? "Sending…" : <><Send className="mr-1 h-3.5 w-3.5" />{mode === "reply" ? "Send reply" : "Forward"}</>}</Button></div></div>
        </>}
      </>}
      {displayedMessage && <p role="alert" className="text-sm text-destructive">{displayedFailure?.ambiguous ? "This may have sent — check Activity before retrying." : displayedMessage} {mode && <button type="button" className="ml-1 underline" disabled={pending} onClick={() => void submit()}>Retry</button>}</p>}
    </div>
  );
}
