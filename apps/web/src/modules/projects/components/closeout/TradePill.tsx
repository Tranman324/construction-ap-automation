'use client';

import { cn } from '@/modules/shared/lib/utils';
import type { TradeCloseout } from '@/modules/projects/types/closeout';
import { tradeCompletionPct } from '@/modules/projects/lib/closeoutHelpers';

interface TradePillProps {
  tradeCloseout: TradeCloseout;
  onClick?: () => void;
  className?: string;
}

export function TradePill({ tradeCloseout, onClick, className }: TradePillProps) {
  const pct = tradeCompletionPct(tradeCloseout);
  const { color, name } = tradeCloseout.trade;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-[box-shadow,opacity] duration-150',
        'hover:shadow-sm',
        onClick && 'cursor-pointer',
        pct >= 100 && 'opacity-70',
        className,
      )}
      style={{
        borderColor: color + '40',
        backgroundColor: color + '10',
        color,
      }}
    >
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate max-w-[80px]">{name}</span>
      <span className="ml-auto font-mono text-[10px] tabular-nums opacity-75">
        {Math.round(pct)}%
      </span>
    </button>
  );
}
