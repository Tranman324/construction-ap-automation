"use client";

import { RulesWorkspaceModal } from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceModal";

interface RulesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RulesPanel({ open, onOpenChange }: RulesPanelProps) {
  return <RulesWorkspaceModal open={open} onOpenChange={onOpenChange} />;
}
