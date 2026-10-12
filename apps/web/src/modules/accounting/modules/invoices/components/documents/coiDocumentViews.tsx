"use client";

import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { PanelNotice } from "./PanelNotice";

import { VendorDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown";
import type { CoiComplianceResult } from "@/modules/accounting/modules/invoices/types/api";
import type { CoiDisplayData } from "@/modules/accounting/modules/invoices/components/documents/coiDocumentData";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/modules/shared/components/ui/dialog";
import { Input } from "@/modules/shared/components/ui/input";
import { Textarea } from "@/modules/shared/components/ui/textarea";
import { cn } from "@/modules/shared/lib/utils";

type CoiStatus = CoiComplianceResult["checks"][number]["effectiveStatus"];

export interface CoiSpectrumFieldsProps {
  data: CoiDisplayData;
  vendorCode: string;
  expirationDate: string;
  comment: string;
  onVendorCodeChange: (value: string) => void;
  onExpirationDateChange: (value: string) => void;
  onCommentChange: (value: string) => void;
  canOverride?: boolean;
}

export interface CoiComplianceChecksProps {
  compliance: CoiComplianceResult;
  onApprove: (checkId: string, reason?: string) => void;
  onRevoke?: (checkId: string) => void;
  canOverride?: boolean;
}

const statusClass: Record<CoiStatus, string> = {
  pass: "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300",
  warn: "border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300",
  fail: "border-red-200 bg-red-50/80 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300",
};
const verdictTone = { compliant: statusClass.pass, "review-required": statusClass.warn, "non-compliant": statusClass.fail };
const checkIcon = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle };
const verdictLabel = { compliant: "Compliant", "review-required": "Review Required", "non-compliant": "Non-Compliant" };

export function CoiSpectrumFields({ data, vendorCode, expirationDate, comment, onVendorCodeChange, onExpirationDateChange, onCommentChange, canOverride = false }: CoiSpectrumFieldsProps) {
  const trackingYear = expirationDate.slice(0, 4) || "—";
  return <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5 text-sm font-medium text-foreground">
        <span>Vendor</span>
        <VendorDropdown value={vendorCode || null} vendorName={data.insured} isManual={vendorCode !== data.vendorCode} onChange={(value) => onVendorCodeChange(value ?? "")} disabled={!canOverride} />
        <span className="block text-xs font-normal text-muted-foreground">Searchable by code or name — only the vendor code is sent to Spectrum.</span>
      </label>
      <label className="space-y-1.5 text-sm font-medium text-foreground">
        <span>Expiration date</span>
        <Input type="date" value={expirationDate} onChange={(event) => onExpirationDateChange(event.target.value)} disabled={!canOverride} />
        <span className="block text-xs font-normal text-muted-foreground">Sets tracking code COI {trackingYear}.</span>
      </label>
    </div>
    <label className="space-y-1.5 text-sm font-medium text-foreground">
      <span>Comment</span>
      <Textarea rows={2} className="min-h-20 resize-y" value={comment} onChange={(event) => onCommentChange(event.target.value)} placeholder="Add a note..." />
      <span className="block text-xs font-normal text-muted-foreground">Optional — note on the Spectrum tracking item.</span>
    </label>
  </div>;
}

export function CoiComplianceHeader({ compliance }: { compliance: CoiComplianceResult }) {
  return <div className="flex flex-wrap items-center justify-end gap-2"><Badge variant="outline" className={cn("border text-xs", verdictTone[compliance.verdict])}>{verdictLabel[compliance.verdict]}</Badge><span className="font-mono text-xs text-muted-foreground">Config {compliance.configVersion} · evaluated {compliance.evaluatedAt}</span></div>;
}

export function CoiStatusBanner({ compliance }: { compliance: CoiComplianceResult }) {
  const detail = compliance.blockers.length ? compliance.blockers.map((blocker) => blocker.message).join(" ") : "The server reported no active upload blockers.";
  return <div className={cn("flex items-start gap-3 rounded-lg border p-3", verdictTone[compliance.verdict])}><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><div className="min-w-0"><p className="text-sm font-semibold">{verdictLabel[compliance.verdict]}</p><p className="text-xs opacity-85">{detail}</p></div></div>;
}

export function CoiComplianceChecks({ compliance, onApprove, onRevoke, canOverride = false }: CoiComplianceChecksProps) {
  const [reasonCheckId, setReasonCheckId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const reasonCheck = compliance.checks.find((check) => check.id === reasonCheckId) ?? null;

  function closeReasonDialog() {
    setReasonCheckId(null);
    setReason("");
  }

  function applyOverride(checkId: string, effectiveStatus: CoiStatus) {
    if (effectiveStatus === "fail") {
      setReasonCheckId(checkId);
      return;
    }
    onApprove(checkId);
  }

  function confirmOverride() {
    if (!reasonCheck || !reason.trim()) return;
    const trimmedReason = reason.trim();
    closeReasonDialog();
    onApprove(reasonCheck.id, trimmedReason);
  }

  return <div className="space-y-2">
    {compliance.checks.map((check) => {
      const Icon = checkIcon[check.effectiveStatus];
      const overridden = check.provenance === "override";
      const approvable = canOverride && !overridden && check.rawStatus !== "pass";
      const card = <div key={check.id} className={cn("flex flex-col gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center", statusClass[check.effectiveStatus])}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{check.label}</p>
            <p className="text-xs leading-5 text-muted-foreground">{overridden ? "Approved manually" : check.detail}</p>
          </div>
        </div>
        {approvable && <Button type="button" variant="outline" size="sm" className="self-end sm:self-auto" onClick={() => applyOverride(check.id, check.effectiveStatus)}>Approve</Button>}
        {canOverride && overridden && onRevoke && <Button type="button" variant="outline" size="sm" className="self-end sm:self-auto" onClick={() => onRevoke(check.id)}>Revoke approval</Button>}
      </div>;
      return check.effectiveStatus === "pass" ? card : (
        <PanelNotice key={check.id} id={`coi-check-${check.id}`} label={check.label}
          tabId={/coverage/i.test(`${check.id} ${check.label}`) ? "coverage" : "details"}>{card}</PanelNotice>
      );
    })}
    <Dialog open={reasonCheck !== null} onOpenChange={(open) => { if (!open) closeReasonDialog(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override compliance check?</DialogTitle>
          <DialogDescription>
            Explain why {reasonCheck?.label ?? "this failing check"} is approved despite the failure.
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-1.5 text-sm font-medium" htmlFor="coi-override-reason">
          <span>Override reason</span>
          <Textarea
            id="coi-override-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain the approval"
            rows={4}
            className="resize-none"
          />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={closeReasonDialog}>Cancel</Button>
          <Button type="button" onClick={confirmOverride} disabled={!reason.trim()}>Confirm override</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
