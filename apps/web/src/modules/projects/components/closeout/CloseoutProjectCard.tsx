'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/modules/shared/lib/utils';
import { Card, CardContent, CardHeader } from '@/modules/shared/components/ui/card';
import { Badge } from '@/modules/shared/components/ui/badge';
import type { CloseoutProject } from '@/modules/projects/types/closeout';
import { projectCompletionPct } from '@/modules/projects/lib/closeoutHelpers';
import { useUsers } from '@/modules/projects/hooks/queries';
import { GENERAL_CHECKLIST_LABELS, type GeneralChecklistKey } from '@/modules/projects/types/closeout';

interface CloseoutProjectCardProps {
  project: CloseoutProject;
  index?: number;
  className?: string;
}

const GC_KEYS = Object.keys(GENERAL_CHECKLIST_LABELS) as GeneralChecklistKey[];

const statusConfig: Record<string, { label: string; class: string }> = {
  active: { label: 'Active', class: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  complete: { label: 'Complete', class: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  hold: { label: 'On Hold', class: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
};

export function CloseoutProjectCard({ project, index = 0, className }: CloseoutProjectCardProps) {
  const router = useRouter();
  const { data: users } = useUsers();
  const pct = projectCompletionPct(project);
  const pm = users?.find((u: { id: string }) => u.id === project.pmId);
  const gcDone = GC_KEYS.filter((k) => project.generalChecklist[k].complete).length;
  const lwDone = project.lienWaivers.filter((w) => w.received).length;
  const tradeDone = project.trades.filter((t) => {
    const fields = [t.warranty, t.finalLienWaiver, t.asBuilts, t.om, t.tab].filter((f): f is NonNullable<typeof f> => f !== null);
    return fields.every((f) => f === 'received' || f === 'na');
  }).length;

  const handleClick = () => {
    if (project.projectId) {
      router.push(`/projects/${project.projectId}?tab=closeout`);
    }
  };

  const barColor =
    pct >= 100 ? 'bg-emerald-500' :
    pct >= 60 ? 'bg-[var(--ncg-cyan)]' :
    pct >= 30 ? 'bg-amber-500' :
    'bg-slate-400';

  const cfg = statusConfig[project.status] ?? statusConfig.active;

  return (
    <Card
      className={cn(
        'group overflow-hidden transition-[box-shadow,translate] duration-300',
        'hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5',
        project.projectId && 'cursor-pointer',
        className,
      )}
      style={{ animationDelay: `${index * 60}ms` }}
      onClick={handleClick}
    >
      <CardHeader className="pb-3 space-y-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="font-mono text-[11px] text-muted-foreground">{project.jobNumber}</span>
          <Badge className={cn('text-[9px] px-1.5 py-0 border-0', cfg.class)}>
            {cfg.label}
          </Badge>
        </div>
        <h3 className="text-sm font-semibold leading-tight truncate">{project.jobName}</h3>
        {pm && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{pm.name}</p>}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Overall Progress</span>
            <span className={cn('text-xs font-bold tabular-nums', pct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground')}>
              {Math.round(pct)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={cn('h-full rounded-full transition-[width,background-color] duration-500', barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        </div>

        {/* Compact summary row */}
        <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-border/50">
          <div>
            <p className="text-xs font-semibold tabular-nums text-foreground">{gcDone}/{GC_KEYS.length}</p>
            <p className="text-[10px] text-muted-foreground">General</p>
          </div>
          <div>
            <p className="text-xs font-semibold tabular-nums text-foreground">{lwDone}/{project.lienWaivers.length}</p>
            <p className="text-[10px] text-muted-foreground">Lien Waivers</p>
          </div>
          <div>
            <p className="text-xs font-semibold tabular-nums text-foreground">{tradeDone}/{project.trades.length}</p>
            <p className="text-[10px] text-muted-foreground">Trades</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
