"use client";

import { CircleOff, FileCheck2, Loader2, Mail, RotateCcw } from "lucide-react";

import {
  useRevertWaiverBypass,
  useRevertWaiverOverride,
  useSetWaiverBypass,
  useSetWaiverOverride,
} from "@/modules/accounting/modules/invoices/hooks/mutations";
import { mutationErrorMessage } from "@/modules/accounting/modules/invoices/lib/mutationErrorMessage";
import { isWaiverGateBlocked } from "@/modules/accounting/modules/invoices/lib/waiverGate";
import type { Invoice, WaiverActionCapability } from "@/modules/accounting/modules/invoices/types/invoice";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";

interface WaiverStatusActionsProps {
  invoice: Invoice;
  presentation?: "default" | "tray";
  requestPending: boolean;
  recipientPending: boolean;
  onRequest: (resend: boolean) => void;
}

const unavailableAction: WaiverActionCapability = {
  permitted: false,
  blockers: [{ code: "WAIVER_ACTIONS_UNAVAILABLE", message: "Waiver action availability is unavailable. Refresh this document and try again." }],
};

function capabilityMessage(capability: WaiverActionCapability): string | null {
  if (capability.permitted || capability.blockers.length === 0) return null;
  return capability.blockers.map((blocker) => blocker.message).join(" ");
}

export function WaiverStatusActions({
  invoice,
  presentation = "default",
  requestPending,
  recipientPending,
  onRequest,
}: WaiverStatusActionsProps) {
  const setOverride = useSetWaiverOverride();
  const revertOverride = useRevertWaiverOverride();
  const setBypass = useSetWaiverBypass();
  const revertBypass = useRevertWaiverBypass();
  const blocked = isWaiverGateBlocked(invoice);
  const attached = invoice.waiverOnDocument === true;
  const bypassed = invoice.waiverBypassed === true;
  const resend = invoice.waiverRequestedAt != null;
  const requestAction = (resend ? invoice.waiverActions?.resend : invoice.waiverActions?.request) ?? unavailableAction;
  const documentAction = (attached ? invoice.waiverActions?.clearOnDocument : invoice.waiverActions?.markOnDocument) ?? unavailableAction;
  const revertBypassAction = invoice.waiverActions?.revertBypass ?? unavailableAction;
  const setBypassAction = invoice.waiverActions?.bypass ?? unavailableAction;
  const useRevertBypass = revertBypassAction.permitted;
  const bypassAction = useRevertBypass ? revertBypassAction : setBypassAction;
  const actionPending = setOverride.isPending || revertOverride.isPending || setBypass.isPending || revertBypass.isPending;
  const documentActionError = attached ? revertOverride.error : setOverride.error;
  const bypassActionError = useRevertBypass ? revertBypass.error : setBypass.error;
  const requestBlocker = capabilityMessage(requestAction);
  const documentBlocker = capabilityMessage(documentAction);
  const bypassBlocker = capabilityMessage(bypassAction);
  const documentActionErrorMessage = documentActionError ? mutationErrorMessage(documentActionError, "Unable to update lien waiver status.") : null;
  const bypassActionErrorMessage = bypassActionError ? mutationErrorMessage(bypassActionError, "Unable to update lien waiver status.") : null;
  const bypassHint = invoice.waiverActions?.bypassHint;
  const requestDescription = requestBlocker ? "waiver-request-blocker" : undefined;
  const documentDescription = [documentBlocker ? "waiver-document-blocker" : null, documentActionErrorMessage ? "waiver-document-action-error" : null].filter(Boolean).join(" ") || undefined;
  const bypassDescription = [bypassBlocker ? "waiver-bypass-blocker" : null, bypassActionErrorMessage ? "waiver-bypass-action-error" : null].filter(Boolean).join(" ") || undefined;
  const inTray = presentation === "tray";
  const actionVariant = blocked && !inTray ? "warning" : "outline";
  const trayButtonClass = inTray ? "h-7 px-[11px] text-xs font-semibold gap-1" : undefined;

  return (
    <TooltipProvider delayDuration={0}>
      <div className={inTray ? "min-w-0" : blocked ? "rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-950/30" : "rounded-lg border border-border p-3"}>
        <div className={inTray ? "flex min-w-0 items-center gap-2" : "flex min-w-0 flex-wrap items-center gap-2"}>
          <p className={inTray ? `min-w-0 flex-1 truncate text-xs ${resend && blocked ? "font-semibold text-blue-700 dark:text-blue-300" : "font-medium text-foreground"}` : "mr-auto text-xs font-medium text-foreground"}>
            {blocked ? inTray && resend ? "Lien waiver requested" : "Lien Waiver Missing" : bypassed ? "Lien waiver bypassed" : attached ? "Waiver on document" : "Lien waiver status"}
          </p>
          <div className={inTray ? "flex shrink-0 items-center gap-1.5" : "contents"}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  size="sm"
                  className={trayButtonClass}
                  variant={inTray && blocked && !resend ? "warning" : actionVariant}
                  disabled={!requestAction.permitted || requestPending || recipientPending}
                  aria-describedby={requestDescription}
                  onClick={() => onRequest(resend)}
                >
                  {requestPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Mail className="h-3.5 w-3.5" aria-hidden="true" />}
                  {resend ? "Resend" : "Request"}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{resend ? "Resend the lien waiver request email" : "Send a lien waiver request email to the vendor"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  size="sm"
                  className={trayButtonClass}
                  variant={actionVariant}
                  disabled={!documentAction.permitted || actionPending}
                  aria-describedby={documentDescription}
                  onClick={() => (attached ? revertOverride : setOverride).mutate({ invoiceId: invoice.id })}
                >
                  {attached ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  {attached ? "Clear" : "Attached"}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{attached ? "Remove the waiver-on-document marker" : "Mark that the waiver is already inside this PDF"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  size="sm"
                  className={trayButtonClass}
                  variant={actionVariant}
                  disabled={!bypassAction.permitted || actionPending}
                  aria-describedby={bypassDescription}
                  onClick={() => (useRevertBypass ? revertBypass : setBypass).mutate({ invoiceId: invoice.id })}
                >
                  {actionPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : useRevertBypass ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleOff className="h-3.5 w-3.5" aria-hidden="true" />}
                  {useRevertBypass ? "Undo Bypass" : "Bypass"}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{useRevertBypass ? "Restore the lien waiver requirement" : "Record that no lien waiver is required"}</TooltipContent>
          </Tooltip>
          </div>
          {!inTray && bypassHint?.show ? (
            <p className="text-xs text-muted-foreground">
              This vendor has been bypassed {bypassHint.count}× since their last attached waiver — consider requesting a waiver instead.
            </p>
          ) : null}
        </div>
        {!inTray && (requestBlocker || documentBlocker || bypassBlocker || documentActionErrorMessage || bypassActionErrorMessage) && (
          <div className="mt-2 space-y-1 text-xs">
            {requestBlocker && <p id="waiver-request-blocker" className="text-muted-foreground">{requestBlocker}</p>}
            {documentBlocker && <p id="waiver-document-blocker" className="text-muted-foreground">{documentBlocker}</p>}
            {bypassBlocker && <p id="waiver-bypass-blocker" className="text-muted-foreground">{bypassBlocker}</p>}
            {documentActionErrorMessage && <p id="waiver-document-action-error" role="alert" className="text-destructive">{documentActionErrorMessage}</p>}
            {bypassActionErrorMessage && <p id="waiver-bypass-action-error" role="alert" className="text-destructive">{bypassActionErrorMessage}</p>}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
