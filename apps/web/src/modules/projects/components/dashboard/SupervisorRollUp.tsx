'use client';

import Link from 'next/link';
import { mockProjects, getTeamForProject, getChecklistsForProject } from '@/modules/projects/mock/index';
import { useUsers } from '@/modules/projects/hooks/queries';
import type { User } from '@/modules/shared/types/user';
import { ProjectStatus } from '@/modules/projects/types/project';
import { Badge } from '@/modules/shared/components/ui/badge';
import { Card } from '@/modules/shared/components/ui/card';
import { cn } from '@/modules/shared/lib/utils';
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import { AlertTriangle, CheckCircle2, Circle, Camera } from 'lucide-react';
import type { ChecklistType } from '@/modules/projects/types/checklist';
import { ChecklistTimeline } from '@/modules/projects/components/primitives/ChecklistTimeline';

// ─── Internal Types ───────────────────────────────────────────────────────────

type ProjectChecklist = {
  complete: number;
  total: number;
};

type SuperRow = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  rows: {
    projectId: string;
    jobName: string;
    jobNumber: string;
    preflight: ProjectChecklist;
    inProcess: ProjectChecklist;
    final: ProjectChecklist;
    hasUnphotoedComplete: boolean;
  }[];
};

// ─── SupervisorRollUp ─────────────────────────────────────────────────────────

export function SupervisorRollUp() {
  const { data: usersData } = useUsers();
  const users: User[] = usersData ?? [];
  const activeSupers = users.filter(u => u.role.name === 'superintendent' && u.is_active);
  const activeProjects = mockProjects.filter(p => p.status === ProjectStatus.active || p.status === ProjectStatus.onboarding);

  const superRows: SuperRow[] = activeSupers.map(user => {
    const assignedProjects = activeProjects.filter(p =>
      getTeamForProject(p.id).some(m => m.user_id === user.id && m.role === 'superintendent')
    );

    const rows = assignedProjects.map(project => {
      const instances = getChecklistsForProject(project.id);

      function summarize(type: ChecklistType): ProjectChecklist {
        const inst = instances.find(i => i.type === type);
        if (!inst) return { complete: 0, total: 0 };
        const items = inst.sections.flatMap(s => s.items);
        return { complete: items.filter(i => i.is_completed).length, total: items.length };
      }

      const allItems = instances.flatMap(inst => inst.sections.flatMap(s => s.items));
      const hasUnphotoedComplete = allItems.some(
        i => i.is_completed && i.requires_photo && i.photo_url === null
      );

      return {
        projectId: project.id,
        jobName: project.job_name,
        jobNumber: project.job_number,
        preflight: summarize('preflight'),
        inProcess: summarize('in_process'),
        final: summarize('final_inspections'),
        hasUnphotoedComplete,
      };
    });

    return { userId: user.id, name: user.name, avatarUrl: user.avatar_url ?? null, rows };
  }).filter(sr => sr.rows.length > 0);

  const incompletePreflightCount = superRows
    .flatMap(sr => sr.rows)
    .filter(r => r.preflight.total > 0 && r.preflight.complete < r.preflight.total)
    .length;

  return (
    <div className="space-y-4">
      {incompletePreflightCount > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50/80 dark:bg-amber-950/20 dark:border-amber-500/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {incompletePreflightCount} project{incompletePreflightCount !== 1 ? 's' : ''} have incomplete Mobilization checklists.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {superRows.map((sr, idx) => {
          // Overall completion across all their projects
          const allComplete = sr.rows.reduce((s, r) => s + r.preflight.complete + r.inProcess.complete + r.final.complete, 0);
          const allTotal = sr.rows.reduce((s, r) => s + r.preflight.total + r.inProcess.total + r.final.total, 0);
          const overallPct = allTotal > 0 ? Math.round((allComplete / allTotal) * 100) : 100;

          return (
            <Card
              key={sr.userId}
              className="overflow-hidden"
              style={{ animation: 'card-enter 0.4s ease-out both', animationDelay: `${idx * 60}ms` }}
            >
              {/* Header: avatar + name + overall % */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                <UserAvatar
                  user={{ name: sr.name, image: sr.avatarUrl }}
                  size="md"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{sr.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {sr.rows.length} project{sr.rows.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className={cn(
                    'text-lg font-bold tabular-nums',
                    overallPct === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground',
                  )}>
                    {overallPct}%
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Complete</p>
                </div>
              </div>

              {/* Project rows */}
              <div className="divide-y divide-border">
                {sr.rows.map(row => {
                  const rowComplete = row.preflight.complete + row.inProcess.complete + row.final.complete;
                  const rowTotal = row.preflight.total + row.inProcess.total + row.final.total;
                  const rowDone = rowTotal > 0 && rowComplete === rowTotal;

                  return (
                    <div key={row.projectId} className="px-5 py-3.5 hover:bg-muted/40 transition-colors">
                    <Link
                      href={`/projects/${row.projectId}?tab=checklists`}
                      className="block"
                    >
                      {/* Project identity + status chips */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{row.jobName}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">{row.jobNumber}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-3">
                          {rowDone && (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          )}
                          {row.hasUnphotoedComplete && (
                            <Badge variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-600 dark:text-amber-400 dark:border-amber-500/30">
                              <Camera className="h-3 w-3" />
                              Photos needed
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Checklist timeline stepper */}
                      <ChecklistTimeline
                        steps={[
                          { label: 'Start', complete: (row.preflight.complete > 0 || row.inProcess.complete > 0 || row.final.complete > 0) ? 1 : 0, total: 0, milestone: true },
                          { label: 'Mobilization', complete: row.preflight.complete, total: row.preflight.total },
                          { label: 'Buildout', complete: row.inProcess.complete, total: row.inProcess.total },
                          { label: 'Final', complete: row.final.complete, total: row.final.total },
                          { label: 'Complete', complete: rowDone ? 1 : 0, total: 0, milestone: true },
                        ]}
                      />
                    </Link>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      {superRows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Circle className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No active superintendents found.</p>
        </div>
      )}
    </div>
  );
}
