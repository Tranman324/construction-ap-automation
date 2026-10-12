"use client";

import { ListChecks } from "lucide-react";

import { RulesWorkspaceSurface } from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceSurface";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/modules/shared/components/ui/dialog";

interface RulesWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RulesWorkspaceModal({ open, onOpenChange }: RulesWorkspaceModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(760px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
        showCloseButton
      >
        <DialogHeader className="border-b p-5">
          <div className="flex items-start gap-3 pr-8">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ListChecks className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>Auto-coding rules</DialogTitle>
              <DialogDescription>
                Select a rule to edit it in place. Rules run top-to-bottom on every incoming invoice.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <RulesWorkspaceSurface active={open} />
      </DialogContent>
    </Dialog>
  );
}
