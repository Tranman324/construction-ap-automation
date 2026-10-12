"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import type {
  AddWaiverContactPayload,
  AddWaiverContactResponse,
  WaiverRecipientResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import { WaiverContactDirectory } from "@/modules/accounting/modules/invoices/components/invoices/WaiverContactDirectory";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";

const MANUAL_VALUE = "__manual__";

interface WaiverRecipientDialogProps {
  open: boolean;
  pending: boolean;
  resolution: WaiverRecipientResponse;
  onOpenChange: (open: boolean) => void;
  onSend: (email: string) => void;
  onAddContact: (payload: AddWaiverContactPayload) => Promise<AddWaiverContactResponse>;
}

export function isRecipientEmailValid(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function sourceLabel(source: WaiverRecipientResponse["candidates"][number]["source"]): string {
  if (source === "sender") return "original sender";
  if (source === "vendor_record") return "vendor record";
  if (source === "forwarded_header") return "forwarded email";
  return "email body";
}

export function WaiverRecipientDialog({
  open,
  pending,
  resolution,
  onOpenChange,
  onSend,
  onAddContact,
}: WaiverRecipientDialogProps) {
  const [selection, setSelection] = useState(
    () => resolution.cachedVendorEmail ?? resolution.candidates[0]?.email ?? MANUAL_VALUE,
  );
  const [manualMode, setManualMode] = useState(
    () => resolution.recipientType === "manual" || selection === MANUAL_VALUE,
  );
  const [manualEmail, setManualEmail] = useState("");
  const directoryContacts = resolution.directoryContacts;

  const manual = manualMode;
  const recipient = manual ? manualEmail.trim() : selection;
  const canSend = isRecipientEmailValid(recipient) && !pending;
  const selectRecipient = (email: string) => {
    setSelection(email);
    setManualMode(email === MANUAL_VALUE ? true : false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm waiver recipient</DialogTitle>
          <DialogDescription className="flex items-start gap-2 pt-1">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>{resolution.reason}. Confirm the vendor email before sending.</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <WaiverContactDirectory
            contacts={directoryContacts}
            selection={selection}
            pending={pending}
            isEmailValid={isRecipientEmailValid}
            onSelect={selectRecipient}
            onAddContact={onAddContact}
          />
          {resolution.recipientType === "parsed" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="waiver-recipient-select">Send waiver request to</label>
              <Select value={selection} onValueChange={selectRecipient} disabled={pending}>
                <SelectTrigger id="waiver-recipient-select" className="w-full">
                  <SelectValue placeholder="Choose a recipient" />
                </SelectTrigger>
                <SelectContent>
                  {resolution.candidates.map((candidate) => (
                    <SelectItem key={candidate.email} value={candidate.email}>
                      {candidate.email} ({sourceLabel(candidate.source)})
                    </SelectItem>
                  ))}
                  <SelectItem value={MANUAL_VALUE}>Enter a different email...</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {manual && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="waiver-recipient-email">
                {resolution.recipientType === "manual" ? "Vendor email" : "Different vendor email"}
              </label>
              <Input
                id="waiver-recipient-email"
                type="email"
                autoComplete="email"
                value={manualEmail}
                onChange={(event) => setManualEmail(event.target.value)}
                placeholder="vendor@example.com"
                disabled={pending}
              />
              {resolution.recipientType === "manual" && (
                <p className="text-xs text-muted-foreground">No vendor email was found in the source message.</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSend} onClick={() => onSend(recipient)}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
