"use client";

import { CheckIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";

import { getClassificationDisplay } from "@/modules/accounting/modules/invoices/components/invoices/renderers/ClassificationBadge";
import { cn } from "@/modules/shared/lib/utils";

export interface ClassificationSelectValueProps {
  classification: string;
  label?: string;
}

export function ClassificationSelectValue({
  classification,
  label,
}: ClassificationSelectValueProps) {
  const display = getClassificationDisplay(classification);
  const Icon = display.Icon;

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{label ?? display.label}</span>
    </span>
  );
}

export interface ClassificationSelectItemProps {
  classification: string;
  label?: string;
  className?: string;
}

export function ClassificationSelectItem({
  classification,
  label,
  className,
}: ClassificationSelectItemProps) {
  const display = getClassificationDisplay(classification);
  const Icon = display.Icon;
  const text = label ?? display.label;

  return (
    <SelectPrimitive.Item
      value={classification}
      textValue={text}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <SelectPrimitive.ItemText>{text}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}
