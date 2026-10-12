import { Check } from 'lucide-react';
import { cn } from '@/modules/shared/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/shared/components/ui/tooltip';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChecklistSummary {
  complete: number;
  total: number;
}

interface PhaseTimelineProps {
  mobilization: ChecklistSummary;
  buildout: ChecklistSummary;
  final: ChecklistSummary;
  startDate?: string;
  className?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PHASE_LABELS = ['Job Setup', 'Execution', 'Close Out', 'Complete'] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Distribute completed-phase dates evenly between startDate and now */
function deriveDate(stepIndex: number, completedCount: number, startDate?: string): string | null {
  if (stepIndex >= completedCount || !startDate) return null;
  const start = new Date(startDate).getTime();
  const now = Date.now();
  if (start >= now || completedCount <= 0) return null;
  const interval = (now - start) / completedCount;
  const ts = start + interval * (stepIndex + 1);
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PhaseTimeline({ mobilization, buildout, final, startDate, className }: PhaseTimelineProps) {
  // Determine completion state for each phase
  const mobDone = mobilization.total > 0 && mobilization.complete === mobilization.total;
  const buildDone = buildout.total > 0 && buildout.complete === buildout.total;
  const finalDone = final.total > 0 && final.complete === final.total;

  // Phase nodes: Job Setup is done when mobilization has started
  const phases = [
    { label: PHASE_LABELS[0], done: mobilization.complete > 0 || mobDone },
    { label: PHASE_LABELS[1], done: mobDone },
    { label: PHASE_LABELS[2], done: buildDone },
    { label: PHASE_LABELS[3], done: finalDone },
  ];

  // Progress for each connector (between phase[i] and phase[i+1])
  const connectors = [
    mobilization.total > 0 ? mobilization.complete / mobilization.total : 0,
    buildout.total > 0 ? buildout.complete / buildout.total : 0,
    final.total > 0 ? final.complete / final.total : 0,
  ];

  // Current step = first incomplete phase (for pulsing indicator)
  const currentIndex = phases.findIndex(p => !p.done);

  // Count completed phases for date derivation
  const completedCount = phases.filter(p => p.done).length;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex items-start w-full', className)}>
        {phases.map((phase, index) => {
          const isCompleted = phase.done;
          const isCurrent = index === currentIndex;
          const isFuture = !isCompleted && !isCurrent;
          const completedDate = isCompleted ? deriveDate(index, completedCount, startDate) : null;

          return (
            <div key={phase.label} className={cn('flex flex-col items-center', index < phases.length - 1 ? 'flex-1' : '')}>
              {/* Node row: node + connector */}
              <div className="flex items-center w-full">
                {/* Node */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'relative flex items-center justify-center shrink-0 rounded-full transition-colors',
                        'h-5 w-5',
                        isCompleted && 'bg-emerald-500 dark:bg-emerald-400',
                        isCurrent && 'bg-primary dark:bg-ncg-cyan',
                        isFuture && 'bg-muted border border-border',
                      )}
                    >
                      {isCompleted && (
                        <Check className="h-3 w-3 text-white dark:text-emerald-950" strokeWidth={3} />
                      )}
                      {isCurrent && (
                        <>
                          <span className="absolute inset-0 rounded-full animate-ping bg-primary/30 dark:bg-ncg-cyan/30" />
                          <span className="h-2 w-2 rounded-full bg-white" />
                        </>
                      )}
                      {isFuture && (
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs text-center">
                    <p className="font-medium">{phase.label}</p>
                    {isCompleted && completedDate && (
                      <p className="opacity-70">{completedDate}</p>
                    )}
                    {isCurrent && (
                      <p className="opacity-70">In Progress</p>
                    )}
                  </TooltipContent>
                </Tooltip>

                {/* Connector with progress fill */}
                {index < phases.length - 1 && (
                  <div className="flex-1 mx-0.5 relative">
                    {/* Background track */}
                    <div className="h-1 w-full bg-border rounded-full" />
                    {/* Progress fill — diagonal candy-cane stripes */}
                    {connectors[index] > 0 && connectors[index] < 1 && (
                      <div
                        className="absolute top-0 left-0 h-1 rounded-full"
                        style={{
                          width: `${Math.min(connectors[index] * 100, 100)}%`,
                          backgroundImage: 'linear-gradient(-45deg, var(--color-primary) 25%, transparent 25%, transparent 50%, var(--color-primary) 50%, var(--color-primary) 75%, transparent 75%)',
                          backgroundSize: '12px 12px',
                          animation: 'candy-cane 3.2s linear infinite',
                        }}
                      />
                    )}
                    {connectors[index] >= 1 && (
                      <div
                        className="absolute top-0 left-0 h-1 w-full rounded-full bg-emerald-500 dark:bg-emerald-400"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Label under node */}
              <span className={cn(
                'text-[10px] leading-tight text-center mt-1 whitespace-nowrap',
                isCompleted ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground',
                isCurrent && 'text-foreground font-medium',
              )}>
                {phase.label}
              </span>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
