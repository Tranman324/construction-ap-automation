"use client";

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { useAddWaiverContact, useRequestWaiver } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useWaiverRecipient } from "@/modules/accounting/modules/invoices/hooks/queries";
import { WaiverRecipientDialog } from "@/modules/accounting/modules/invoices/components/invoices/WaiverRecipientDialog";
import { WaiverStatusActions } from "@/modules/accounting/modules/invoices/components/invoices/WaiverStatusActions";
import type { AddWaiverContactPayload, WaiverRecipientResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { toast } from "@/modules/shared/components/ui/toaster";
import { isApiError } from "@/modules/shared/lib/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/modules/shared/components/ui/alert-dialog";

interface LienWaiverMissingNoticeProps {
  invoice: Invoice;
  presentation?: "default" | "tray";
}

function formatRequestedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waiver requested";
  return `Waiver requested ${formatDistanceToNow(date, { addSuffix: true })}`;
}

function getRequestDateLabel(message: string): string {
  const timestamp = message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/)?.[0];
  if (!timestamp) return "an earlier date";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "an earlier date" : format(date, "MMM d, yyyy");
}

export function LienWaiverMissingNotice({ invoice, presentation = "default" }: LienWaiverMissingNoticeProps) {
  const [resendConfirmation, setResendConfirmation] = useState<{
    invoiceId: string;
    dateLabel: string;
  } | null>(null);
  const [recipientPrompt, setRecipientPrompt] = useState<{
    resolution: WaiverRecipientResponse;
    resend: boolean;
  } | null>(null);
  const requestWaiver = useRequestWaiver();
  const addWaiverContact = useAddWaiverContact();
  const waiverRecipient = useWaiverRecipient(invoice.id);

  async function sendWaiverRequest(resend: boolean, recipientOverride?: string): Promise<boolean> {
    try {
      const result = await requestWaiver.mutateAsync(
        {
          invoiceId: invoice.id,
          ...(resend ? { resend: true } : {}),
          ...(recipientOverride ? { recipientOverride } : {}),
        },
      );
      toast.success(resend ? "Waiver request resent" : "Waiver request sent", {
        description: `The request was sent to ${result.sentTo} on the original invoice thread.`,
      });
      return true;
    } catch (error) {
      if (isApiError(error) && error.status === 409 && !resend) {
        setResendConfirmation({
          invoiceId: invoice.id,
          dateLabel: getRequestDateLabel(error.message),
        });
        return false;
      }
      toast.error("Waiver request failed", {
        description: isApiError(error) ? error.message : error instanceof Error ? error.message : "Please try again.",
      });
      return false;
    }
  }

  async function beginWaiverRequest(resend: boolean) {
    const result = await waiverRecipient.refetch();
    if (result.error) {
      toast.error("Could not resolve waiver recipient", { description: result.error.message });
      return;
    }
    if (!result.data) {
      toast.error("Could not resolve waiver recipient", { description: "Please try again." });
      return;
    }
    if (result.data.recipientType === "direct") {
      await sendWaiverRequest(resend);
      return;
    }
    setRecipientPrompt({ resolution: result.data, resend });
  }

  function handleRequestWaiver(resend: boolean) {
    void beginWaiverRequest(resend);
  }

  function handleConfirmResend() {
    setResendConfirmation(null);
    void beginWaiverRequest(true);
  }

  async function handleRecipientSend(email: string) {
    if (!recipientPrompt) return;
    const sent = await sendWaiverRequest(recipientPrompt.resend, email);
    if (sent) setRecipientPrompt(null);
  }

  function handleAddContact(payload: AddWaiverContactPayload) {
    return addWaiverContact.mutateAsync({ invoiceId: invoice.id, ...payload });
  }

  return (
    <div className={presentation === "tray" ? "min-w-0" : "space-y-2"}>
      <WaiverStatusActions
        presentation={presentation}
        invoice={invoice}
        requestPending={requestWaiver.isPending}
        recipientPending={waiverRecipient.isFetching}
        onRequest={handleRequestWaiver}
      />

      {presentation !== "tray" && invoice.waiverRequestedAt && (
        <p className="text-xs text-muted-foreground">
          {formatRequestedAt(invoice.waiverRequestedAt)}
        </p>
      )}

      <AlertDialog
        open={resendConfirmation?.invoiceId === invoice.id}
        onOpenChange={(open) => { if (!open) setResendConfirmation(null); }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Send waiver request again?</AlertDialogTitle>
            <AlertDialogDescription>
              A waiver request was already sent on {resendConfirmation?.dateLabel ?? "an earlier date"}. Send again?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={requestWaiver.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={requestWaiver.isPending} onClick={handleConfirmResend}>
              Send Again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {recipientPrompt && (
        <WaiverRecipientDialog
          key={`${invoice.id}-${recipientPrompt.resend ? "resend" : "request"}`}
          open
          pending={requestWaiver.isPending}
          resolution={recipientPrompt.resolution}
          onOpenChange={(open) => { if (!open) setRecipientPrompt(null); }}
          onSend={(email) => { void handleRecipientSend(email); }}
          onAddContact={handleAddContact}
        />
      )}
    </div>
  );
}
