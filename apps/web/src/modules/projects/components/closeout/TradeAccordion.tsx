'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/modules/shared/components/ui/accordion';
import { cn } from '@/modules/shared/lib/utils';
import type { TradeCloseout, DocField } from '@/modules/projects/types/closeout';
import { DOC_FIELD_LABELS } from '@/modules/projects/types/closeout';
import { tradeCompletionPct, tradeDocCounts, cycleDocStatus } from '@/modules/projects/lib/closeoutHelpers';
import { StatusChip } from './StatusChip';

interface TradeAccordionProps {
  trades: TradeCloseout[];
  onStatusChange?: (tradeCloseoutId: string, field: DocField, newStatus: string) => void;
  className?: string;
}

const DOC_FIELDS: DocField[] = ['asBuilts', 'om', 'tab', 'warranty', 'finalLienWaiver'];

export function TradeAccordion({ trades, onStatusChange, className }: TradeAccordionProps) {
  return (
    <Accordion type="multiple" className={cn('space-y-1', className)}>
      {trades.map((tc) => {
        const pct = tradeCompletionPct(tc);
        const { total, received } = tradeDocCounts(tc);
        return (
          <AccordionItem key={tc.id} value={tc.id} className="rounded-lg border bg-card/50 px-3">
            <AccordionTrigger className="py-2.5 hover:no-underline">
              <div className="flex items-center gap-3 text-left">
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: tc.trade.color }}
                />
                <span className="text-sm font-medium">{tc.trade.name}</span>
                <span className="ml-1 text-[10px] font-mono tabular-nums text-muted-foreground">
                  {received}/{total}
                </span>
                <div className="ml-2 h-1.5 w-16 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width,background-color] duration-500',
                      pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-[var(--ncg-cyan)]' : 'bg-amber-500',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <div className="grid gap-2 pt-1">
                {DOC_FIELDS.map((field) => {
                  const status = tc[field];
                  if (status === null) return null;
                  return (
                    <div key={field} className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-1.5">
                      <span className="text-xs text-muted-foreground">{DOC_FIELD_LABELS[field]}</span>
                      <StatusChip
                        status={status}
                        onClick={onStatusChange ? () => onStatusChange(tc.id, field, cycleDocStatus(status)) : undefined}
                      />
                    </div>
                  );
                })}
                {tc.note && (
                  <p className="text-[10px] text-muted-foreground italic px-3 pt-1">{tc.note}</p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
