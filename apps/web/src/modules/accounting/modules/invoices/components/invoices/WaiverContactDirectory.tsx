"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";

import type {
  AddWaiverContactPayload,
  AddWaiverContactResponse,
  WaiverDirectoryContact,
} from "@/modules/accounting/modules/invoices/types/api";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { isApiError } from "@/modules/shared/lib/api";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";

interface WaiverContactDirectoryProps {
  contacts: WaiverDirectoryContact[];
  selection: string;
  pending: boolean;
  isEmailValid: (value: string) => boolean;
  onSelect: (email: string) => void;
  onAddContact: (payload: AddWaiverContactPayload) => Promise<AddWaiverContactResponse>;
}

export function directorySourceLabel(source: WaiverDirectoryContact["source"]): string {
  if (source === "confirmed_send") return "confirmed send";
  if (source === "manual") return "manual";
  return "seen";
}

export function WaiverContactDirectory({
  contacts,
  selection,
  pending,
  isEmailValid,
  onSelect,
  onAddContact,
}: WaiverContactDirectoryProps) {
  const [directoryContacts, setDirectoryContacts] = useState(contacts);
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, setAddPending] = useState(false);

  useEffect(() => {
    setDirectoryContacts(contacts);
  }, [contacts]);

  async function addContact() {
    const email = addEmail.trim();
    if (!isEmailValid(email)) return;
    setAddPending(true);
    setAddError(null);
    try {
      const response = await onAddContact({ email, ...(addName.trim() ? { name: addName.trim() } : {}) });
      setDirectoryContacts(response.directoryContacts);
      const normalized = response.directoryContacts.find(
        (contact) => contact.email.trim().toLowerCase() === email.toLowerCase(),
      );
      if (normalized) onSelect(normalized.email);
      setAddOpen(false);
      setAddEmail("");
      setAddName("");
    } catch (error) {
      setAddError(
        isApiError(error) ? error.message : error instanceof Error ? error.message : "Unable to add contact.",
      );
    } finally {
      setAddPending(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3" aria-label="Vendor contact directory">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Vendor contact directory</p>
          <p className="text-xs text-muted-foreground">Select a saved contact, then Send to confirm.</p>
        </div>
        <PermissionGate requires="accounting.invoices.request_waiver">
          <Button type="button" size="sm" variant="outline" onClick={() => { setAddOpen((open) => !open); setAddError(null); }} disabled={addPending}>
            <Plus className="size-4" aria-hidden="true" /> Add Contact
          </Button>
        </PermissionGate>
      </div>
      {directoryContacts.length > 0 ? (
        <div className="space-y-1" role="listbox" aria-label="Saved vendor contacts">
          {directoryContacts.map((contact) => {
            const selected = selection === contact.email;
            return (
              <button key={contact.email} type="button" role="option" aria-selected={selected}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-transparent px-2 py-1.5 text-left text-sm hover:border-border hover:bg-muted/50"
                onClick={() => onSelect(contact.email)} disabled={pending || addPending}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{contact.name || contact.email}</span>
                  {contact.name && <span className="block truncate text-xs text-muted-foreground">{contact.email}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  {selected && <Check className="size-3.5 text-primary" aria-hidden="true" />}
                  {directorySourceLabel(contact.source)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No saved vendor contacts yet.</p>
      )}
      {addOpen && (
        <div className="space-y-2 border-t border-border pt-2">
          <label className="text-xs font-medium" htmlFor="waiver-contact-email">Email</label>
          <Input id="waiver-contact-email" type="email" value={addEmail} onChange={(event) => setAddEmail(event.target.value)} disabled={addPending} placeholder="vendor@example.com" />
          <label className="text-xs font-medium" htmlFor="waiver-contact-name">Name (optional)</label>
          <Input id="waiver-contact-name" value={addName} onChange={(event) => setAddName(event.target.value)} disabled={addPending} placeholder="Accounts payable" />
          {addError && <p className="text-xs text-destructive" role="alert">{addError}</p>}
          <Button type="button" size="sm" onClick={() => { void addContact(); }} disabled={!isEmailValid(addEmail) || addPending}>
            {addPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Save Contact
          </Button>
        </div>
      )}
    </div>
  );
}
