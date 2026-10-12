"use client";

import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign,
  BriefcaseBusiness,
  Building2,
  FileText,
  Hash,
  Mail,
  Plus,
  Receipt,
  Tag,
  X,
} from "lucide-react";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { RuleCriteriaField } from "@/modules/accounting/modules/invoices/types/rules";
import type { RuleBuilderDraft } from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";
import {
  buildInvoiceContextFields,
  createCriterionFromInvoiceField,
} from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";
import { ruleLabelMapsFromOptions } from "@/modules/accounting/modules/invoices/components/settings/ruleLabels";
import { useRuleOptions } from "@/modules/accounting/modules/invoices/hooks/queries";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

interface InvoiceRuleContextPanelProps {
  invoice: Invoice;
  draft: RuleBuilderDraft;
  disabled?: boolean;
  onDraftChange: (draft: RuleBuilderDraft) => void;
}

const FIELD_ICONS: Record<RuleCriteriaField, LucideIcon> = {
  vendor_name: Building2,
  vendor_code: Tag,
  amount: BadgeDollarSign,
  description: FileText,
  invoice_number: Hash,
  job_number: BriefcaseBusiness,
  classification: Receipt,
  status: Receipt,
  email_from: Mail,
  email_subject: Mail,
};

export function InvoiceRuleContextPanel({
  invoice,
  draft,
  disabled = false,
  onDraftChange,
}: InvoiceRuleContextPanelProps) {
  const { data: ruleOptions } = useRuleOptions();
  const fields = buildInvoiceContextFields(invoice, ruleLabelMapsFromOptions(ruleOptions));
  const invoiceNumber = invoice.extracted?.invoiceNumber ?? invoice.id;

  function toggleField(field: RuleCriteriaField) {
    const existingIndex = draft.criteria.findIndex((criterion) => criterion.field === field);
    if (existingIndex >= 0) {
      onDraftChange({
        ...draft,
        criteria: draft.criteria.filter((_, index) => index !== existingIndex),
      });
      return;
    }

    const criterion = createCriterionFromInvoiceField(invoice, field);
    if (!criterion) return;
    onDraftChange({ ...draft, criteria: [...draft.criteria, criterion] });
  }

  return (
    <aside className="flex min-h-0 flex-col rounded-lg border bg-muted/20">
      <header className="border-b bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">From this invoice</h3>
            <p className="truncate font-mono text-xs text-muted-foreground">{invoiceNumber}</p>
          </div>
          <Badge variant="secondary" className="shrink-0 font-mono">
            {draft.criteria.length} fields
          </Badge>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {fields.map((field) => {
            const Icon = FIELD_ICONS[field.field];
            const added = draft.criteria.some((criterion) => criterion.field === field.field);
            return (
              <div
                key={field.field}
                className={cn(
                  "rounded-lg border bg-card p-3 transition-colors",
                  added && "border-primary/30 bg-primary/5",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{field.label}</p>
                    <p className="break-words text-xs text-muted-foreground">
                      {field.display}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={added ? "secondary" : "outline"}
                    className="h-8 shrink-0 gap-1.5"
                    disabled={disabled}
                    onClick={() => toggleField(field.field)}
                    aria-label={`${added ? "Remove" : "Add"} ${field.label}`}
                  >
                    {added ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    {added ? "Remove" : "Add"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
