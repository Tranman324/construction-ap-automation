"use client";

import { useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";

import {
  hasSpectrumSubmitFailureWorkflowSnapshot,
  subscribeSpectrumSubmitFailureWorkflowSnapshot,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitFailureWorkflowModel";
import { Button } from "@/modules/shared/components/ui/button";

interface SpectrumSubmitReturnButtonProps {
  returnHref: string;
  visible: boolean;
  onReturn: (href: string) => void;
}

export function SpectrumSubmitReturnButton({
  returnHref,
  visible,
  onReturn,
}: SpectrumSubmitReturnButtonProps) {
  const workflowAvailable = useSyncExternalStore(
    subscribeSpectrumSubmitFailureWorkflowSnapshot,
    hasSpectrumSubmitFailureWorkflowSnapshot,
    () => false,
  );

  if (!visible || !workflowAvailable) return null;

  return (
    <Button
      className="gap-1.5 text-sm font-medium"
      size="sm"
      type="button"
      variant="outline"
      onClick={() => onReturn(returnHref)}
    >
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
      Back to results
    </Button>
  );
}
