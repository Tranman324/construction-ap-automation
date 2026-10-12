import { cn } from '@/modules/shared/lib/utils';
import type { Phase } from '@/modules/projects/types/project';

const PHASE_LABELS = [
  'Job Setup',
  'Execution',
  'Close Out',
  'Complete',
] as const;

interface PhaseIndicatorProps {
  phase: Phase;
  showLabel?: boolean;
  className?: string;
}

export function PhaseIndicator({ phase, showLabel, className }: PhaseIndicatorProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex gap-1">
        {PHASE_LABELS.map((label, index) => {
          const isFilled = index < phase;
          return (
            <div
              key={label}
              title={label}
              className={cn(
                'h-1.5 flex-1 rounded-sm',
                isFilled
                  ? 'bg-ncg-navy dark:bg-ncg-cyan opacity-100'
                  : 'bg-muted opacity-40',
              )}
            />
          );
        })}
      </div>
      {showLabel && (
        <span className="text-xs text-muted-foreground">
          {PHASE_LABELS[phase - 1]}
        </span>
      )}
    </div>
  );
}
