"use client";

import {
  ClassificationSelectItem,
  ClassificationSelectValue,
} from "@/modules/accounting/modules/invoices/components/invoices/renderers/ClassificationSelectParts";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";

export interface DocumentClassificationControlProps {
  record: Invoice;
  classifications?: readonly ClassificationInfo[];
  allowInvoiceClassification?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onReclassify?: (classification: string) => void;
}

export function DocumentClassificationControl({
  record,
  classifications = [],
  allowInvoiceClassification = true,
  disabled,
  pending,
  onReclassify,
}: DocumentClassificationControlProps) {
  const options = classifications.filter((item) => (
    item.status === "active" && (allowInvoiceClassification || item.name !== "invoice")
  ));
  const current = classifications.find((item) => item.name === record.classification);

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Select
        value={record.classification}
        disabled={disabled || pending || !onReclassify}
        onValueChange={(value) => {
          if (value !== record.classification) onReclassify?.(value);
        }}
      >
        <SelectTrigger
          aria-label="Reclassify document"
          className="h-7 w-auto min-w-32 gap-1 border-dashed px-2 text-xs"
        >
          <SelectValue>
            <ClassificationSelectValue
              classification={record.classification}
              label={current?.label}
            />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((classification) => (
            <ClassificationSelectItem
              key={classification.name}
              classification={classification.name}
              label={classification.label}
              className="text-xs"
            />
          ))}
        </SelectContent>
      </Select>
      {pending && <span className="text-xs text-muted-foreground">Saving...</span>}
    </div>
  );
}
