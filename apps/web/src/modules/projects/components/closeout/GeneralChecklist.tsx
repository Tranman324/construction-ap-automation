'use client';

import { cn } from '@/modules/shared/lib/utils';
import { Checkbox } from '@/modules/shared/components/ui/checkbox';
import type { CloseoutGeneralChecklist, GeneralChecklistKey } from '@/modules/projects/types/closeout';
import { GENERAL_CHECKLIST_LABELS } from '@/modules/projects/types/closeout';

interface GeneralChecklistProps {
  checklist: CloseoutGeneralChecklist;
  onToggle?: (key: GeneralChecklistKey) => void;
  className?: string;
}

const KEYS = Object.keys(GENERAL_CHECKLIST_LABELS) as GeneralChecklistKey[];

export function GeneralChecklist({ checklist, onToggle, className }: GeneralChecklistProps) {
  const total = KEYS.length;
  const done = KEYS.filter((k) => checklist[k].complete).length;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">General Checklist</h4>
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground">{done}/{total}</span>
      </div>
      <div className="grid gap-1">
        {KEYS.map((key) => {
          const item = checklist[key];
          return (
            <label
              key={key}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150',
                'hover:bg-muted/40 cursor-pointer',
                item.complete && 'text-muted-foreground line-through opacity-70',
              )}
            >
              <Checkbox
                checked={item.complete}
                onCheckedChange={onToggle ? () => onToggle(key) : undefined}
                className="size-3.5"
              />
              <span className="flex-1">{GENERAL_CHECKLIST_LABELS[key]}</span>
              {item.note && (
                <span className="text-[10px] text-muted-foreground italic truncate max-w-[140px]">{item.note}</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
