"use client";

import { useRef, useState, type MouseEvent } from "react";

import { useFlagDocument, useUnflagDocument } from "@/modules/accounting/modules/invoices/hooks/mutations";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { isApiError } from "@/modules/shared/lib/api";
import { ReviewPennant } from "@/modules/accounting/modules/invoices/components/invoices/renderers/InvoiceMarkerRenderers";
import { formatShortcutTooltip, useDocumentPanelKeyboardShortcuts, useDocumentShortcutLabels } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";

type FlagRecord = Pick<Invoice, "id" | "flaggedAt" | "flagReason" | "flaggedBy">;

function errorMessage(error: unknown, fallback: string): string {
  if (isApiError(error)) return error.message || fallback;
  return error instanceof Error ? error.message : fallback;
}

/**
 * One-click flag/unflag glyph for review ("needs attention").
 *
 * - Filled red pennant when flagged; gray outline of the same pennant when not.
 * - Click toggles directly (flag if unflagged, unflag if flagged) with NO reason
 *   dialog and NO toast. If a reason/flaggedBy is present it surfaces in the
 *   tooltip.
 * - OPTIMISTIC: the flag state derives from `record.flaggedAt`, which the
 *   mutations flip in the cache on click (via the parent's list/detail query),
 *   so the glyph updates instantly. The server stays authoritative — a failed
 *   request (e.g. a 403 unflag by a non-flagger) rolls the cache back, so the
 *   glyph reverts, and the server error renders inline next to the glyph.
 * - `stopPropagation` so a click inside a table row never triggers row
 *   navigation. A per-glyph in-flight guard blocks rapid double-toggles.
 */
export function FlagToggleGlyph({ record, className, shortcutEnabled = false }: { record: FlagRecord; className?: string; shortcutEnabled?: boolean }) {
  return (
    <PermissionGate requires="accounting.invoices.view_details">
      <FlagToggleGlyphInner record={record} className={className} shortcutEnabled={shortcutEnabled} />
    </PermissionGate>
  );
}

function FlagToggleGlyphInner({ record, className, shortcutEnabled }: { record: FlagRecord; className?: string; shortcutEnabled: boolean }) {
  const flagDocument = useFlagDocument();
  const unflagDocument = useUnflagDocument();
  const isFlagged = record.flaggedAt != null;
  const pending = flagDocument.isPending || unflagDocument.isPending;
  const inFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  function performToggle() {
    // Guard rapid double-toggles: the ref blocks a synchronous second click
    // before `pending` has re-rendered the disabled state.
    if (inFlightRef.current || pending) return;

    inFlightRef.current = true;
    setError(null);
    const mutation = isFlagged ? unflagDocument : flagDocument;
    const fallback = isFlagged ? "Could not remove the flag." : "Could not flag the document.";
    mutation.mutate(
      { id: record.id },
      {
        onError: (mutationError) => setError(errorMessage(mutationError, fallback)),
        onSettled: () => {
          inFlightRef.current = false;
        },
      },
    );
  }

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.preventDefault();
    performToggle();
  }

  const shortcutRef = useRef(null);
  const shortcuts = useDocumentShortcutLabels();
  useDocumentPanelKeyboardShortcuts({
    primaryActionRef: shortcutRef,
    undoAction: null,
    previousAction: null,
    nextAction: null,
    toggleFlagAction: shortcutEnabled ? { disabled: pending, run: performToggle } : null,
    enabled: shortcutEnabled,
  });

  return (
    <ReviewPennant
      flaggedAt={record.flaggedAt}
      flagReason={record.flagReason}
      flaggedBy={record.flaggedBy}
      pending={pending}
      error={error}
      title={shortcutEnabled ? formatShortcutTooltip("Toggle flag", shortcuts.toggleFlag) : undefined}
      onToggle={toggle}
      className={className}
    />
  );
}
