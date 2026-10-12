"use client";

import { useRef, useState, type RefObject } from "react";
import { AlertTriangle, Loader2, Mail } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";
import { hasDocumentAlertTarget, isDocumentActionDisabled, isDocumentAlertDismissible, isDocumentAlertNotice, type DocumentAlert } from "../../types/documentSpec";
import { ResolveCarousel } from "./ResolveCarousel";
import { TONE_ICONS } from "./resolveCardIcons";

interface AlertHandlers { onReview?: (alert: DocumentAlert) => void; onDismiss?: (alert: DocumentAlert) => void }
interface DocumentResolveTrayProps extends AlertHandlers { documentId?: string; alerts: readonly DocumentAlert[]; trayRef?: RefObject<HTMLElement | null> }

/** Each card offers its own action, else "Review details" when it has a target, else "Dismiss"; never a button that does nothing. */
export function DocumentResolveTray({ documentId, alerts, trayRef, onReview, onDismiss }: DocumentResolveTrayProps) {
  return <ResolveCarousel key={documentId ?? "document"} cards={alerts.map((alert) => ({ ...alert, notice: isDocumentAlertNotice(alert), content: <AlertCard alert={alert} onReview={onReview} onDismiss={onDismiss} /> }))} testId="document-resolve-tray" trayRef={trayRef} />;
}

function AlertCard({ alert, onReview, onDismiss }: AlertHandlers & { alert: DocumentAlert }) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const notice = isDocumentAlertNotice(alert);
  const Icon = alert.waiting ? Mail : (alert.icon ?? (notice ? TONE_ICONS.info : AlertTriangle));
  const action = alert.action;
  const ActionIcon = action?.pending || pending ? Loader2 : action?.icon;
  async function run() {
    if (!action || inFlight.current || isDocumentActionDisabled(action)) return;
    inFlight.current = true;
    setPending(true);
    try { await action.onClick(); } catch { /* Domain owner displays the failure; never resolve locally. */ }
    finally { inFlight.current = false; setPending(false); }
  }
  const message = [alert.label, alert.detail].filter(Boolean).join(" — ");
  return <div className="flex min-w-0 items-center gap-2 text-xs">
    <div className="flex min-w-0 flex-1 items-center gap-2" title={message}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", notice && "text-rc-icon")} aria-hidden="true" />
      <strong className="truncate font-semibold" aria-label={alert.detail ? `${alert.label}: ${alert.detail}` : alert.label}>{message}</strong>
    </div>
    {action ? <Button type="button" className="shrink-0" variant={action.tone === "primary" ? "default" : "outline"} size="sm" disabled={pending || isDocumentActionDisabled(action)} title={action.disabledReason} onClick={() => { void run(); }}>
      {ActionIcon && <ActionIcon className={cn("h-3 w-3", (pending || action.pending) && "animate-spin")} aria-hidden="true" />}{action.label}
    </Button> : onReview && hasDocumentAlertTarget(alert) ? <Button type="button" className="shrink-0" variant="outline" size="sm" onClick={() => onReview(alert)}>Review details</Button> : null}
    {onDismiss && isDocumentAlertDismissible(alert) && <Button type="button" className="shrink-0" variant="outline" size="sm" onClick={() => onDismiss(alert)}>Dismiss</Button>}
  </div>;
}
