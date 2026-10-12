"use client";

import type { ReactNode } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Zap } from "lucide-react";

import type { DocumentAction } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { Rule, RuleCreateAndApplyResponse } from "@/modules/accounting/modules/invoices/types/rules";
import { useRules } from "@/modules/accounting/modules/invoices/hooks/useRules";
import { Button } from "@/modules/shared/components/ui/button";
import { RuleBuilderModal } from "@/modules/accounting/modules/invoices/components/settings/RuleBuilderModal";

// ─── Component ────────────────────────────────────────────────────────────────

interface CreateRuleFromInvoiceActionOptions {
  invoice?: Invoice | null;
  previewInvoices?: Invoice[];
  enabled?: boolean;
  onAppliedTerminalRule?: () => void;
}

interface CreateRuleFromInvoiceActionResult {
  action?: DocumentAction;
  modal: ReactNode;
}

interface Props {
  invoice: Invoice;
  previewInvoices?: Invoice[];
}

export function useCreateRuleFromInvoiceAction({
  invoice,
  previewInvoices = [],
  enabled = true,
  onAppliedTerminalRule,
}: CreateRuleFromInvoiceActionOptions): CreateRuleFromInvoiceActionResult {
  const [builderOpen, setBuilderOpen] = useState(false);
  const { data: rulesData } = useRules({ enabled: !!invoice && enabled });
  const activeInvoiceIdRef = useRef(invoice?.id);
  useLayoutEffect(() => {
    activeInvoiceIdRef.current = invoice?.id;
  }, [invoice?.id]);
  const action = useMemo<DocumentAction | undefined>(() => {
    if (!invoice || !enabled) return undefined;

    return {
      id: "create-rule",
      label: "Create Rule",
      icon: Zap,
      onClick: () => setBuilderOpen(true),
    };
  }, [enabled, invoice]);

  return {
    action,
    modal: invoice ? (
      <RuleBuilderModal
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        existingRules={rulesData?.rules ?? []}
        previewInvoices={previewInvoices}
        sourceInvoice={invoice}
        onSaved={(result) => {
          if (
            isAppliedTerminalRule(result) &&
            result.sourceOutcome?.id === activeInvoiceIdRef.current
          ) {
            onAppliedTerminalRule?.();
          }
        }}
      />
    ) : null,
  };
}

function isAppliedTerminalRule(
  result: Rule | RuleCreateAndApplyResponse,
): result is RuleCreateAndApplyResponse & {
  sourceOutcome: { id: string; matched: true; status: "discarded" | "approved" | "filed" };
} {
  if (!("sourceOutcome" in result)) return false;
  const sourceOutcome = result.sourceOutcome;
  if (!sourceOutcome || typeof sourceOutcome !== "object") return false;
  if (typeof sourceOutcome.id !== "string" || sourceOutcome.matched !== true) return false;
  return typeof sourceOutcome.status === "string"
    && ["discarded", "approved", "filed"].includes(sourceOutcome.status);
}

export function CreateRuleFromInvoice({
  invoice,
  previewInvoices = [],
}: Props) {
  const { action, modal } = useCreateRuleFromInvoiceAction({ invoice, previewInvoices });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-2 text-xs"
        onClick={() => action?.onClick()}
      >
        <Zap className="h-3 w-3" />
        Create Rule
      </Button>

      {modal}
    </>
  );
}
