'use client';

import { Badge } from '@/modules/shared/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/shared/components/ui/tooltip';
import { cn } from '@/modules/shared/lib/utils';
import type { HealthStatus } from '@/modules/projects/types/project';

interface HealthBadgeProps {
  health: HealthStatus;
  flagCount?: number;
  className?: string;
}

const dotClass: Record<HealthStatus, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
};

export function HealthBadge({ health, flagCount, className }: HealthBadgeProps) {
  const tooltipText =
    flagCount && flagCount > 0
      ? `${flagCount} active flag${flagCount === 1 ? '' : 's'}`
      : 'No active flags';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex items-center gap-1.5', className)}>
            <div
              className={cn('rounded-full w-2.5 h-2.5 shrink-0', dotClass[health])}
            />
            {flagCount !== undefined && flagCount > 0 && (
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  health === 'red' &&
                    'text-red-600 border-red-300 dark:text-red-400',
                )}
              >
                {flagCount}
              </Badge>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
