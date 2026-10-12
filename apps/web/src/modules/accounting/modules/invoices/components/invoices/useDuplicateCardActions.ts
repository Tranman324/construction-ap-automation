"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { toast } from "@/modules/shared/components/ui/toaster";
import { useDuplicateBypass } from "../../hooks/mutations";
import type { ResolveActionHandler, ResolveCardModel } from "../documents/resolveCardModel";

export interface DuplicateCardActionsInput {
  invoiceId: string;
  /** The duplicate card model; its Discard `confirm` kind decides between the dialog and a direct discard. */
  model: ResolveCardModel | null;
  /** The tray's single guarded discard path. The card or dialog confirms first; this never owns a discard mutation. */
  onDiscard: () => void;
}

export interface DuplicateCardActions {
  onAction: ResolveActionHandler;
  /** Props for `SpectrumConfirmDialog` (`onConfirm` is its `onDiscard`). */
  dialog: { open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void };
  bypassPending: boolean;
}

// Bypass POSTs in flight, by invoice id. Module scope (not component state) so a controller that unmounts and remounts
// mid-request still sees the POST, and a same-tick second call is refused before React re-renders (F1).
const bypassInFlight = new Set<string>();
const bypassListeners = new Set<() => void>();
function setBypassInFlight(invoiceId: string, inFlight: boolean) {
  if (inFlight) bypassInFlight.add(invoiceId);
  else bypassInFlight.delete(invoiceId);
  bypassListeners.forEach((listener) => listener());
}
function subscribeBypassInFlight(listener: () => void) {
  bypassListeners.add(listener);
  return () => { bypassListeners.delete(listener); };
}

/** Maps duplicate card action ids to the existing behaviors. `view` is a link action (never reaches `onAction`), so it and unknown ids are no-ops. */
export function useDuplicateCardActions({ invoiceId, model, onDiscard }: DuplicateCardActionsInput): DuplicateCardActions {
  const bypass = useDuplicateBypass();
  const [open, setOpen] = useState(false);
  const discardUsesDialog = model?.actions?.some((a) => a.id === "discard" && a.confirm === "dialog") ?? false;
  // Leaving the Spectrum state closes the dialog, so a later return to Spectrum never reopens it unasked.
  const [dialogAvailable, setDialogAvailable] = useState(discardUsesDialog);
  if (dialogAvailable !== discardUsesDialog) {
    setDialogAvailable(discardUsesDialog);
    if (!discardUsesDialog) setOpen(false);
  }
  const { mutateAsync } = bypass;
  const inFlight = useSyncExternalStore(subscribeBypassInFlight, () => bypassInFlight.has(invoiceId), () => false);

  const onAction = useCallback<ResolveActionHandler>((actionId) => {
    switch (actionId) {
      case "discard":
        if (discardUsesDialog) setOpen(true);
        else onDiscard();
        return;
      case "bypass":
        if (bypassInFlight.has(invoiceId)) return;
        setBypassInFlight(invoiceId, true);
        // The toasts hang off the mutation's own promise, not mutate() callbacks, so they still fire after this controller unmounts.
        mutateAsync({ id: invoiceId })
          .then(
            () => { toast.success("Duplicate flag bypassed"); },
            (error: Error) => { toast.error("Could not bypass duplicate flag", { description: error.message }); },
          )
          .finally(() => setBypassInFlight(invoiceId, false));
        return;
      case "view":
        return;
      default:
        return;
    }
  }, [discardUsesDialog, invoiceId, mutateAsync, onDiscard]);

  const onConfirm = useCallback(() => {
    setOpen(false);
    onDiscard();
  }, [onDiscard]);

  return { onAction, dialog: { open, onOpenChange: setOpen, onConfirm }, bypassPending: inFlight || bypass.isPending };
}
