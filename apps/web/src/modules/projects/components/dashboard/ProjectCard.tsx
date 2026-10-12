'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/modules/shared/components/ui/badge';
import { Card, CardHeader, CardContent } from '@/modules/shared/components/ui/card';
import { cn } from '@/modules/shared/lib/utils';
import { HealthBadge } from '@/modules/projects/components/primitives/HealthBadge';
import { PhaseTimeline } from '@/modules/projects/components/primitives/PhaseTimeline';
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import { ProjectStatus, type Project, type ProjectTeamMember } from '@/modules/projects/types/project';
import type { User } from '@/modules/shared/types/user';
import type { ChecklistType } from '@/modules/projects/types/checklist';
import { getChecklistsForProject } from '@/modules/projects/mock/index';
import { useProjectFlags } from '@/modules/projects/hooks/queries';
import { Camera } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/shared/components/ui/tooltip';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: Project;
  teamMembers: ProjectTeamMember[];
  users: User[];
  /** Grid index for staggered entrance animation */
  index?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusLabel(status: ProjectStatus): string {
  switch (status) {
    case ProjectStatus.pending_approval: return 'Pending';
    case ProjectStatus.onboarding:       return 'Onboarding';
    case ProjectStatus.active:           return 'Active';
    case ProjectStatus.completed:        return 'Completed';
    case ProjectStatus.rejected:         return 'Rejected';
    case ProjectStatus.changes_requested: return 'Changes Requested';
    case ProjectStatus.archived:         return 'Archived';
    case ProjectStatus.draft:            return 'Draft';
    default:                             return status;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectCard({ project, teamMembers, users, index = 0 }: ProjectCardProps) {
  const router = useRouter();
  const [renderNow] = useState(() => Date.now());

  // Derived data
  const primaryPMMember = teamMembers.find((m) => m.role === 'pm' && m.is_primary) ?? null;
  const primaryPM = primaryPMMember
    ? (users.find((u) => u.id === primaryPMMember.user_id) ?? null)
    : null;
  const primarySuperMember =
    teamMembers.find((m) => m.role === 'superintendent' && m.is_primary) ?? null;
  const primarySuper = primarySuperMember
    ? (users.find((u) => u.id === primarySuperMember.user_id) ?? null)
    : null;
  const daysSinceStart = project.start_date
    ? Math.floor((renderNow - new Date(project.start_date).getTime()) / 86_400_000)
    : null;

  const { data: flagData } = useProjectFlags(project.id);
  const health = flagData?.health ?? 'green';
  const flagCount = flagData?.flags.length ?? 0;

  // Checklist summaries for the phase timeline
  const instances = getChecklistsForProject(project.id);
  function summarize(type: ChecklistType) {
    const inst = instances.find(i => i.type === type);
    if (!inst) return { complete: 0, total: 0 };
    const items = inst.sections.flatMap(s => s.items);
    return { complete: items.filter(i => i.is_completed).length, total: items.length };
  }
  const mobilization = summarize('preflight');
  const buildout = summarize('in_process');
  const final = summarize('final_inspections');

  // Photo requirement: any completed item missing required photo
  const allItems = instances.flatMap(inst => inst.sections.flatMap(s => s.items));
  const photosNeeded = allItems.some(i => i.is_completed && i.requires_photo && i.photo_url === null);

  return (
    <Card
      className={cn(
        'cursor-pointer transition-[border-color,box-shadow] duration-200 h-full flex flex-col bg-card',
        'hover:shadow-lg hover:shadow-primary/5 hover:border-primary/15',
      )}
      style={{
        animation: 'card-enter 0.4s ease-out both',
        animationDelay: `${index * 60}ms`,
      }}
      onClick={() => router.push('/projects/' + project.id)}
    >
      <CardHeader className="pb-2">
        {/* Top row: job info + status badge */}
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-mono">{project.job_number}</p>
            <h3 className="font-semibold leading-tight">{project.job_name}</h3>
          </div>
          <Badge
            variant={project.status === ProjectStatus.pending_approval ? 'outline' : 'secondary'}
            className={cn(
              'text-xs shrink-0',
              project.status === ProjectStatus.pending_approval &&
                'border-amber-400 text-amber-600 dark:text-amber-400',
              project.status === ProjectStatus.active &&
                'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
              project.status === ProjectStatus.onboarding &&
                'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
            )}
          >
            {getStatusLabel(project.status)}
          </Badge>
        </div>
        {/* Address */}
        <p className="text-xs text-muted-foreground truncate">{project.address}</p>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-3">
        {/* Phase timeline */}
        <PhaseTimeline
          mobilization={mobilization}
          buildout={buildout}
          final={final}
          startDate={project.start_date}
        />

        {/* Health row */}
        <div className="flex items-center gap-2">
          <HealthBadge health={health} flagCount={flagCount} />
          {photosNeeded && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-600 dark:text-amber-400 dark:border-amber-500/30">
              <Camera className="h-3 w-3" />
              Photos
            </Badge>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {daysSinceStart !== null ? `${daysSinceStart} days active` : ''}
          </span>
        </div>

        {/* Team row: PM + Super compact */}
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="shrink-0">
                    <UserAvatar
                      user={{ name: primaryPM?.name ?? 'Unassigned', image: primaryPM?.avatar_url }}
                      size="sm"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">PM</p>
                  <p className="text-muted-foreground">{primaryPM?.name ?? 'Unassigned'}</p>
                </TooltipContent>
              </Tooltip>
              <span className="text-xs truncate text-muted-foreground">
                {primaryPM?.name?.split(' ')[0] ?? 'No PM'}
              </span>
            </div>
            <span className="text-border">|</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="shrink-0">
                    <UserAvatar
                      user={{ name: primarySuper?.name ?? 'Unassigned', image: primarySuper?.avatar_url }}
                      size="sm"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">Superintendent</p>
                  <p className="text-muted-foreground">{primarySuper?.name ?? 'Unassigned'}</p>
                </TooltipContent>
              </Tooltip>
              <span className="text-xs truncate text-muted-foreground">
                {primarySuper?.name?.split(' ')[0] ?? 'No Super'}
              </span>
            </div>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
