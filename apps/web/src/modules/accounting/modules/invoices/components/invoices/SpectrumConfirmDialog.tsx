"use client";

import { Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle,
} from "@/modules/shared/components/ui/alert-dialog";
import type { Evidence } from "../documents/resolveCardModel";
import { ResolveCardEvidence } from "../documents/ResolveCardEvidence";

const TITLE = "Confirm it's in Spectrum";
const BODY = "Check these against Spectrum before discarding. The discard reason is written automatically from them.";

export interface SpectrumConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Compact compare from `buildSpectrumConfirmEvidence`. */
  evidence: Extract<Evidence, { layout: "compare" }>;
  /** The caller routes this to the tray's single guarded discard path. */
  onDiscard: () => void;
  pending?: boolean;
}

/** Spectrum confirmation before discarding a duplicate. It owns no mutation and no reason input. */
export function SpectrumConfirmDialog({ open, onOpenChange, evidence, onDiscard, pending = false }: SpectrumConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-[460px]">
        <AlertDialogHeader>
          <AlertDialogMedia className="size-10 bg-destructive/10 text-destructive *:[svg:not([class*='size-'])]:size-5">
            <Trash2 aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>{TITLE}</AlertDialogTitle>
          <AlertDialogDescription>{BODY}</AlertDialogDescription>
        </AlertDialogHeader>
        <div data-testid="spectrum-confirm-facts" data-tone="blocking">
          <ResolveCardEvidence evidence={evidence} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={() => onDiscard()}>
            Discard duplicate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
