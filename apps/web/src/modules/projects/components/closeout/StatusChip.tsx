'use client';

import { cn } from '@/modules/shared/lib/utils';
import type { DocStatus } from '@/modules/projects/types/closeout';
import { docStatusColor } from '@/modules/projects/lib/closeoutHelpers';

interface StatusChipProps {
  status: DocStatus;
  onClick?: () => void;
  className?: string;
}

export function StatusChip({ status, onClick, className }: StatusChipProps) {
  const { bg, text, label } = docStatusColor(status);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-150',
        'disabled:cursor-default',
        bg, text,
        onClick && 'cursor-pointer hover:opacity-80',
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', status === 'received' ? 'bg-emerald-500' : status === 'requested' ? 'bg-amber-500' : status === 'na' ? 'bg-slate-400' : 'bg-slate-300')} />
      {label}
    </button>
  );
}
