import { Check } from 'lucide-react';
import { cn } from '@/modules/shared/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/shared/components/ui/tooltip';

export interface ChecklistStep {
  label: string;
  complete: number;
  total: number;
  /** When true, step is a simple milestone (Start / Complete) — no count display */
  milestone?: boolean;
}

interface ChecklistTimelineProps {
  steps: ChecklistStep[];
  className?: string;
}

export function ChecklistTimeline({ steps, className }: ChecklistTimelineProps) {
  // Current step: first non-milestone that isn't fully complete (with items)
  const currentIndex = steps.findIndex(s => !s.milestone && s.total > 0 && s.complete < s.total);

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex items-start w-full', className)}>
        {steps.map((step, index) => {
          const isDone = step.milestone
            ? step.complete > 0
            : step.total > 0 && step.complete === step.total;
          const isEmpty = !step.milestone && step.total === 0;
          const isCurrent = !step.milestone && index === currentIndex;
          const isFuture = !isDone && !isCurrent;
          const pct = step.total > 0 ? Math.round((step.complete / step.total) * 100) : 0;

          return (
            <div key={step.label} className={cn('flex flex-col items-center', index < steps.length - 1 ? 'flex-1' : '')}>
              {/* Node row: node + connector */}
              <div className="flex items-center w-full">
                {/* Node */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'relative flex items-center justify-center shrink-0 rounded-full transition-colors',
                        'h-6 w-6',
                        isDone && 'bg-emerald-500 dark:bg-emerald-400',
                        isCurrent && 'bg-primary dark:bg-ncg-cyan',
                        isFuture && !isEmpty && 'bg-muted border border-border',
                        isEmpty && 'bg-muted border border-dashed border-border',
                      )}
                    >
                      {isDone && (
                        <Check className="h-3.5 w-3.5 text-white dark:text-emerald-950" strokeWidth={3} />
                      )}
                      {isCurrent && (
                        <>
                          <span className="absolute inset-0 rounded-full animate-ping bg-primary/30 dark:bg-ncg-cyan/30" />
                          <span className="h-2 w-2 rounded-full bg-white" />
                        </>
                      )}
                      {isFuture && !isEmpty && (
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {step.milestone
                      ? step.label
                      : isEmpty
                        ? `${step.label} — No items`
                        : isDone
                          ? `${step.label} — Complete (${step.complete}/${step.total})`
                          : `${step.label} — ${pct}% (${step.complete}/${step.total})`}
                  </TooltipContent>
                </Tooltip>

                {/* Connector with progress fill */}
                {index < steps.length - 1 && (() => {
                  // The next step drives the fill percentage
                  const next = steps[index + 1];
                  const nextPct = next.milestone
                    ? (next.complete > 0 ? 1 : 0)
                    : next.total > 0 ? next.complete / next.total : 0;
                  const nextDone = next.milestone
                    ? next.complete > 0
                    : next.total > 0 && next.complete === next.total;

                  return (
                    <div className="flex-1 mx-1 relative">
                      {/* Background track */}
                      <div className="h-1 w-full bg-border rounded-full" />
                      {/* Progress fill — diagonal candy-cane stripes */}
                      {(isDone && nextPct > 0 && !nextDone) && (
                        <div
                          className="absolute top-0 left-0 h-1 rounded-full"
                          style={{
                            width: `${Math.min(nextPct * 100, 100)}%`,
                            backgroundImage: 'linear-gradient(-45deg, var(--color-primary) 25%, transparent 25%, transparent 50%, var(--color-primary) 50%, var(--color-primary) 75%, transparent 75%)',
                            backgroundSize: '12px 12px',
                            animation: 'candy-cane 3.2s linear infinite',
                          }}
                        />
                      )}
                      {/* Fully filled if both sides done */}
                      {isDone && nextDone && (
                        <div className="absolute top-0 left-0 h-1 w-full rounded-full bg-emerald-500 dark:bg-emerald-400" />
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Label + count under node */}
              <span className={cn(
                'text-[10px] leading-tight text-center mt-1',
                isDone ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground',
                isCurrent && 'text-foreground font-medium',
              )}>
                {step.label}
              </span>
              {/* Count — only for non-milestone steps with items */}
              {!step.milestone && step.total > 0 && (
                <span className={cn(
                  'text-[10px] tabular-nums leading-tight',
                  isDone ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                )}>
                  {step.complete}/{step.total}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
