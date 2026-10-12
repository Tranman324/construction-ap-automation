"use client";
import { PanelNotice } from "./PanelNotice";

import { VendorDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown";
import { Input } from "@/modules/shared/components/ui/input";
import { Field } from "@/modules/shared/components/patterns/Field";
import { getInvoiceFieldState } from "@/modules/shared/components/patterns/invoiceFieldState";
import type { StatementAttributeSource } from "@/modules/accounting/modules/invoices/types/invoice";

export interface StatementDetailsFieldsProps {
  vendorCode: string;
  vendorName: string;
  vendorManual: boolean;
  statementPeriod: string;
  statementBalance: string;
  statementPeriodSource: StatementAttributeSource;
  statementBalanceSource: StatementAttributeSource;
  canEditStatementAttributes: boolean;
  statementAttributeError?: string | null;
  statementAttributeSaveState?: "idle" | "saving" | "saved" | "error";
  onVendorCodeChange: (value: string) => void;
  onStatementPeriodChange: (value: string) => void;
  onStatementPeriodBlur?: (value: string) => void;
  onStatementBalanceChange: (value: string) => void;
  onStatementBalanceBlur?: (value: string) => void;
}

export function StatementDetailsFields({
  vendorCode,
  vendorName,
  vendorManual,
  statementPeriod,
  statementBalance,
  statementPeriodSource,
  statementBalanceSource,
  canEditStatementAttributes,
  statementAttributeError,
  statementAttributeSaveState = "idle",
  onVendorCodeChange,
  onStatementPeriodChange,
  onStatementPeriodBlur,
  onStatementBalanceChange,
  onStatementBalanceBlur,
}: StatementDetailsFieldsProps) {
  const vendorFieldState = getInvoiceFieldState({
    value: vendorCode,
    manuallyEdited: vendorManual,
  });
  const statementPeriodFieldState = getInvoiceFieldState({
    value: statementPeriod,
    manuallyEdited: statementPeriodSource === "manual",
  });
  const statementBalanceFieldState = getInvoiceFieldState({
    value: statementBalance,
    manuallyEdited: statementBalanceSource === "manual",
  });

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Field label="Vendor" invoiceState={vendorFieldState}>
          <VendorDropdown
            value={vendorCode || null}
            vendorName={vendorName}
            isManual={vendorManual}
            onChange={(value) => onVendorCodeChange(value ?? "")}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Statement period" htmlFor="statement-period" invoiceState={statementPeriodFieldState}>
            <Input id="statement-period" aria-label="Statement period" value={statementPeriod} disabled={!canEditStatementAttributes} onChange={(event) => onStatementPeriodChange(event.target.value)} onBlur={(event) => onStatementPeriodBlur?.(event.target.value)} />
          </Field>
          <Field label="Statement balance" htmlFor="statement-balance" invoiceState={statementBalanceFieldState}>
            <Input
              id="statement-balance"
              inputMode="decimal"
              aria-label="Statement balance"
              value={statementBalance}
              disabled={!canEditStatementAttributes}
              onChange={(event) => onStatementBalanceChange(event.target.value)}
              onBlur={(event) => onStatementBalanceBlur?.(event.target.value)}
            />
          </Field>
        </div>
      </div>
      {statementAttributeSaveState !== "idle" ? <div className="flex justify-end"><span className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
          {statementAttributeSaveState === "saving" ? "Saving…" : statementAttributeSaveState === "saved" ? "Saved" : "Not saved"}
        </span></div> : null}
      {!canEditStatementAttributes ? <p className="text-xs text-muted-foreground">You do not have permission to edit statement attributes.</p> : null}
      {statementAttributeError ? <PanelNotice id="statement-attribute-error" label="Statement details could not be saved"><p role="alert" className="text-sm text-destructive">{statementAttributeError}</p></PanelNotice> : null}
    </div>
  );
}
