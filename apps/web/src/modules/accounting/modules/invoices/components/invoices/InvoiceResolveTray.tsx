"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Invoice } from "../../types/invoice";
import type { DuplicateStatusResponse } from "../../types/api";
import { ResolveCarousel } from "../documents/ResolveCarousel";
import { LienWaiverMissingNotice } from "./LienWaiverMissingNotice";
import { ClosedPeriodApprovalNotice } from "./ClosedPeriodApprovalNotice";
import type { ResolveActionHandler, ResolveCarouselCard } from "../documents/resolveCardModel";
import { buildDuplicateCardModel, buildSpectrumConfirmEvidence, type DuplicateCardInput } from "./duplicateCardModel";
import type { InvoiceResolveRow } from "./invoiceResolveModel";
import { SpectrumConfirmDialog } from "./SpectrumConfirmDialog";
import { useDuplicateCardActions } from "./useDuplicateCardActions";

interface InvoiceResolveTrayProps {
  invoice: Invoice;
  rows: readonly InvoiceResolveRow[];
  /** Live duplicate evaluation; undefined while loading or on error. */
  duplicateStatus?: DuplicateStatusResponse | null;
  discardPending: boolean;
  onDiscard: () => boolean | Promise<boolean>;
  onDiscarded?: () => void;
}

export function InvoiceResolveTray(props: InvoiceResolveTrayProps) {
  return <InvoiceResolveCards key={props.invoice.id} {...props} />;
}

function InvoiceResolveCards({ invoice, rows, duplicateStatus, discardPending, onDiscard, onDiscarded }: InvoiceResolveTrayProps) {
  const [discarding, setDiscarding] = useState(false);
  const inFlight = useRef(false);
  const completed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function discard() {
    if (inFlight.current || completed.current || discardPending) return;
    inFlight.current = true;
    setDiscarding(true);
    try {
      if (await onDiscard()) {
        completed.current = true;
        if (mounted.current) onDiscarded?.();
      }
    } catch { /* Domain owner surfaces the error; keep the controlled card. */ }
    finally { inFlight.current = false; if (mounted.current) setDiscarding(false); }
  }
  // The duplicate controller (bypass mutation + Spectrum dialog) mounts only while a duplicate row exists; the carousel
  // stays mounted either way, reaching the controller's handler through a ref and its pending flag through state.
  const hasDuplicateRow = rows.some((row) => row.kind === "duplicate");
  const duplicateAction = useRef<ResolveActionHandler | null>(null);
  const [bypassPending, setBypassPending] = useState(false);
  const duplicateInput = { invoice, status: duplicateStatus, discardPending: discardPending || discarding };
  const duplicateModel = buildDuplicateCardModel({ ...duplicateInput, bypassPending: hasDuplicateRow && bypassPending });
  const cards: ResolveCarouselCard[] = rows.flatMap<ResolveCarouselCard>((row) => {
    if (row.kind === "duplicate") return duplicateModel ? [duplicateModel] : [];
    return [{ ...row, content: row.kind === "closed-period" ? (
      row.recoveryAction ? <ClosedPeriodApprovalNotice recovery={row.recoveryAction.recovery} disabled={row.recoveryAction.disabled} onUseSuggestedDate={row.recoveryAction.onUseSuggestedDate} /> : null
    ) : <LienWaiverMissingNotice invoice={invoice} presentation="tray" /> }];
  });
  return <>
    <ResolveCarousel cards={cards} testId="invoice-resolve-tray" onAction={(cardId, actionId) => { if (cardId === "duplicate") duplicateAction.current?.(actionId); }} />
    {hasDuplicateRow ? <DuplicateCardController input={duplicateInput} onDiscard={() => { void discard(); }} actionRef={duplicateAction} onBypassPendingChange={setBypassPending} /> : null}
  </>;
}

interface DuplicateCardControllerProps {
  input: Omit<DuplicateCardInput, "bypassPending">;
  onDiscard: () => void;
  actionRef: RefObject<ResolveActionHandler | null>;
  onBypassPendingChange: (pending: boolean) => void;
}

function DuplicateCardController({ input, onDiscard, actionRef, onBypassPendingChange }: DuplicateCardControllerProps) {
  // The controller reads only the Discard `confirm` kind, which does not depend on pending flags, so its model
  // carries no bypass state; the rendered card takes `bypassPending` from this controller through the tray.
  const model = buildDuplicateCardModel({ ...input, bypassPending: false });
  const actions = useDuplicateCardActions({ invoiceId: input.invoice.id, model, onDiscard });
  const { onAction, bypassPending } = actions;
  useLayoutEffect(() => {
    actionRef.current = onAction;
    return () => { actionRef.current = null; };
  }, [actionRef, onAction]);
  useLayoutEffect(() => {
    onBypassPendingChange(bypassPending);
    return () => onBypassPendingChange(false);
  }, [bypassPending, onBypassPendingChange]);
  const status = input.status;
  return status?.state === "spectrum" && model ? (
    <SpectrumConfirmDialog
      open={actions.dialog.open}
      onOpenChange={actions.dialog.onOpenChange}
      evidence={buildSpectrumConfirmEvidence(status)}
      onDiscard={actions.dialog.onConfirm}
      pending={input.discardPending}
    />
  ) : null;
}
