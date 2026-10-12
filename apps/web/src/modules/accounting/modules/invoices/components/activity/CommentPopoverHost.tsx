"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCreateComment } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { type CollaborationRouteFamily } from "@/modules/accounting/modules/invoices/hooks/collaborationRoutes";
import type { DocumentAction } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { DocumentActionsDropdown } from "@/modules/accounting/modules/invoices/components/documents/DocumentActionsDropdown";
import { CollaborationComposer } from "./CollaborationComposer";

interface CommentPopoverHostProps {
  documentId: string;
  routeFamily: CollaborationRouteFamily;
  actions: readonly DocumentAction[];
  canComment: boolean;
}

export function CommentPopoverHost({ documentId, routeFamily, actions, canComment }: CommentPopoverHostProps) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const menuActions = canComment
    ? [...actions, { id: "add-comment", label: "Add Comment", onClick: () => setOpen(true) }]
    : actions;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !hostRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  return (
    <div ref={hostRef} className="relative inline-block" data-comment-popover>
      <DocumentActionsDropdown actions={menuActions} />
      {open && <OpenCommentPopover documentId={documentId} routeFamily={routeFamily} onClose={() => setOpen(false)} />}
    </div>
  );
}

function OpenCommentPopover({ documentId, routeFamily, onClose }: { documentId: string; routeFamily: CollaborationRouteFamily; onClose: () => void }) {
  const createComment = useCreateComment();

  async function submitComment(body: string) {
    await createComment.mutateAsync({ id: documentId, routeFamily, payload: { body } });
    onClose();
  }

  return (
    <div role="dialog" aria-label="Add comment" className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-border bg-popover p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between text-sm font-semibold"><span>Add comment</span><button type="button" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button></div>
      <CollaborationComposer documentId={documentId} mode="comment" inputLabel="Add a comment" recipients={[]} canComment canEmail={false} pending={createComment.isPending} error={createComment.error?.message} onModeChange={() => undefined} onComment={submitComment} onReply={async () => undefined} onForward={async () => undefined} />
    </div>
  );
}
