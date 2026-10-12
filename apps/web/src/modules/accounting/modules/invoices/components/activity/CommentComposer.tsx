"use client";

import { useEffect, useState } from "react";
import { Button } from "@/modules/shared/components/ui/button";
import { Textarea } from "@/modules/shared/components/ui/textarea";

const MAX_COMMENT_LENGTH = 2000;

interface CommentComposerProps {
  documentId: string;
  disabled?: boolean;
  error?: string | null;
  onSubmit: (body: string) => Promise<void>;
}

export function CommentComposer({ documentId, disabled = false, error, onSubmit }: CommentComposerProps) {
  const storageKey = `document-comment-draft:${documentId}`;
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    try { setBody(localStorage.getItem(storageKey) ?? ""); } catch { /* storage is optional */ }
  }, [storageKey]);

  useEffect(() => {
    try {
      if (body) localStorage.setItem(storageKey, body);
      else localStorage.removeItem(storageKey);
    } catch { /* storage is optional */ }
  }, [body, storageKey]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > MAX_COMMENT_LENGTH || submitting || disabled) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(trimmed);
      setBody("");
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "Comment could not be posted.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2 border-b border-border pb-4" aria-label="Comment composer">
      <Textarea
        value={body}
        maxLength={MAX_COMMENT_LENGTH}
        disabled={disabled || submitting}
        placeholder={disabled ? "Comments are unavailable" : "Add a comment…"}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        aria-label="Comment"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{body.length}/{MAX_COMMENT_LENGTH}</span>
        <Button type="button" size="sm" disabled={disabled || submitting || !body.trim()} onClick={() => void submit()}>
          {submitting ? "Posting…" : "Post comment"}
        </Button>
      </div>
      {(error ?? submitError) ? <p role="alert" className="text-sm text-destructive">{error ?? submitError}</p> : null}
    </div>
  );
}
