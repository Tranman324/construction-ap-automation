"use client";

import { Plus, X } from "lucide-react";
import type { RuleCriterion, RuleCriteriaField, RuleCriteriaOperator } from "@/modules/accounting/modules/invoices/types/rules";
import { operatorsForField, isNullaryOperator, isBetweenOperator, ENUM_FIELDS } from "@/modules/accounting/modules/invoices/lib/rules/helpers";
import { useClassifications, useRuleOptions } from "@/modules/accounting/modules/invoices/hooks/queries";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";
import { Input } from "@/modules/shared/components/ui/input";

interface RuleCriterionRowProps {
  criterion: RuleCriterion;
  onChange: (updated: RuleCriterion) => void;
  onRemove: () => void;
  showRemove: boolean;
}

export function RuleCriterionRow({ criterion, onChange, onRemove, showRemove }: RuleCriterionRowProps) {
  const { field, operator, values } = criterion;
  const { data: ruleOptions } = useRuleOptions();
  const { classifications } = useClassifications();
  const isNullary = isNullaryOperator(operator);
  const isBetween = isBetweenOperator(operator);
  const isEnum = ENUM_FIELDS.has(field);
  const availableOperators = operatorsForField(field);
  const fieldOptions = ruleOptions?.fields ?? [];
  const statusOptions = ruleOptions?.statuses ?? [];
  const operatorLabelMap: Record<string, string> = {};
  for (const option of ruleOptions?.operators ?? []) operatorLabelMap[option.value] = option.label;
  const classificationOptions = classifications
    .filter((classification) => classification.status === "active")
    .map((classification) => ({ value: classification.name, label: classification.label }));

  function setField(newField: RuleCriteriaField) {
    const newOperators = operatorsForField(newField);
    const newOp = newOperators.includes(operator) ? operator : newOperators[0];
    onChange({ field: newField, operator: newOp, values: [""] });
  }

  function setOperator(newOp: RuleCriteriaOperator) {
    const newValues = isNullaryOperator(newOp)
      ? []
      : isBetweenOperator(newOp)
        ? ["", ""]
        : values.length > 0 ? values : [""];
    onChange({ ...criterion, operator: newOp, values: newValues });
  }

  function setValue(index: number, val: string) {
    const next = [...values];
    next[index] = val;
    onChange({ ...criterion, values: next });
  }

  function addValue() {
    onChange({ ...criterion, values: [...values, ""] });
  }

  function removeValue(index: number) {
    const next = values.filter((_, i) => i !== index);
    onChange({ ...criterion, values: next.length > 0 ? next : [""] });
  }

  function renderValues() {
    if (isNullary) return null;

    if (isBetween) {
      return (
        <div className="flex items-center gap-2 mt-3">
          <Input
            type="number"
            value={values[0] ?? ""}
            onChange={(e) => setValue(0, e.target.value)}
            placeholder="Min value"
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground shrink-0">and</span>
          <Input
            type="number"
            value={values[1] ?? ""}
            onChange={(e) => setValue(1, e.target.value)}
            placeholder="Max value"
            className="flex-1"
          />
        </div>
      );
    }

    if (isEnum && (operator === "equals" || operator === "not_equals")) {
      const options = field === "classification" ? classificationOptions : statusOptions;
      return (
        <Select
          value={values[0] ?? ""}
          onValueChange={(v) => onChange({ ...criterion, values: [v] })}
        >
          <SelectTrigger className="mt-3">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    const isNumeric = field === "amount";
    return (
      <div className="mt-3 space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            {i > 0 && (
              <span className="text-2xs font-semibold text-primary uppercase tracking-wider w-5 text-center shrink-0">or</span>
            )}
            {i === 0 && <div className="w-5 shrink-0" />}
            <div className="relative flex-1">
              <Input
                type={isNumeric ? "number" : "text"}
                value={v}
                onChange={(e) => setValue(i, e.target.value)}
                placeholder={isNumeric ? "e.g. 500" : "Enter value…"}
                className="pr-8"
              />
              {values.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeValue(i)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Remove value"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addValue}
          className="ml-7 flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
        >
          <Plus className="h-3 w-3" />
          Add OR value
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border">
        <Select value={field} onValueChange={(v) => setField(v as RuleCriteriaField)}>
          <SelectTrigger className="h-auto border-none bg-transparent p-0 shadow-none font-semibold text-sm focus:ring-0 flex-1 min-w-0 gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fieldOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-3 shrink-0 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Remove criterion"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="px-4 py-3 space-y-0">
        <Select value={operator} onValueChange={(v) => setOperator(v as RuleCriteriaOperator)}>
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableOperators.map((op) => (
              <SelectItem key={op} value={op}>{operatorLabelMap[op] ?? op}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {renderValues()}
      </div>
    </div>
  );
}
