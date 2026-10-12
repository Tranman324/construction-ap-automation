'use client';

import { cn } from '@/modules/shared/lib/utils';

interface CompletionRingProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function CompletionRing({ percent, size = 48, strokeWidth = 4, className }: CompletionRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  const color =
    percent >= 100 ? 'text-emerald-500' :
    percent >= 60 ? 'text-[var(--ncg-cyan)]' :
    percent >= 30 ? 'text-amber-500' :
    'text-slate-400';

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg className="rotate-[-90deg]" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/30"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn('transition-[color,stroke-dashoffset] duration-500 ease-out', color)}
        />
      </svg>
      <span className="absolute text-[10px] font-bold tabular-nums">{Math.round(percent)}%</span>
    </div>
  );
}
