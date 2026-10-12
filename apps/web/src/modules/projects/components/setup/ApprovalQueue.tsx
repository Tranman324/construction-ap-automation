'use client';

import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Lock,
  Clock,
  ChevronRight,
  MapPin,
  DollarSign,
} from 'lucide-react';
import { useAuth } from '@/modules/shared/lib/auth';
import { useProjects, useProjectTeam } from '@/modules/projects/hooks/queries';
import { ProjectStatus, type Project, type ProjectTeamMember } from '@/modules/projects/types/project';
import { getUserById } from '@/modules/projects/mock';
import {
  Card,
  CardContent,
} from '@/modules/shared/components/ui/card';
import { Skeleton } from '@/modules/shared/components/ui/skeleton';
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import { cn } from '@/modules/shared/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// ─── PendingCard ──────────────────────────────────────────────────────────────

function PendingCard({ project, index }: { project: Project; index: number }) {
  const router = useRouter();
  const { data: rawTeam } = useProjectTeam(project.id);
  const team: ProjectTeamMember[] = rawTeam ?? [];
  const pmMember = team.find((m) => m.role === 'pm' && m.is_primary);
  const pm = pmMember ? getUserById(pmMember.user_id) : null;
  const days = daysAgo(project.created_at);

  return (
    <Card
      className={cn(
        'group cursor-pointer transition-[border-color,box-shadow] duration-200 hover:shadow-md hover:border-primary/20',
        'animate-in fade-in slide-in-from-bottom-2',
      )}
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'backwards' }}
      onClick={() => router.push(`/projects/pending/${project.id}`)}
    >
      <CardContent className="flex items-center gap-4 py-4">
        {/* PM Avatar */}
        <div className="shrink-0">
          {pm ? (
            <UserAvatar user={{ name: pm.name, image: pm.avatar_url }} size="md" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs">
              ?
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate">{project.job_name}</h3>
            <span className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
              {project.job_type}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{project.customer_name}</span>
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {project.address.split(',').slice(0, 2).join(',')}
            </span>
          </div>
        </div>

        {/* Contract + Submitted */}
        <div className="hidden sm:flex items-center gap-6 text-sm shrink-0">
          <div className="text-right">
            <div className="flex items-center gap-1 font-semibold">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              {fmt.format(project.contract_value)}
            </div>
            <p className="text-[11px] text-muted-foreground">Contract</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className={cn(
                'font-medium',
                days > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
              )}>
                {days === 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days ago`}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              PM: {pm?.name ?? 'Unassigned'}
            </p>
          </div>
        </div>

        {/* Chevron */}
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
      </CardContent>
    </Card>
  );
}

// ─── ApprovalQueue ────────────────────────────────────────────────────────────

export function ApprovalQueue() {
  const { user } = useAuth();
  const canApprove = Boolean(user?.isAdmin);

  const { data: raw, isLoading } = useProjects({ status: ProjectStatus.pending_approval });
  const projects: Project[] = raw?.data ?? [];

  // ── Permission gate ────────────────────────────────────────────────────────

  if (!canApprove) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <Lock className="h-10 w-10 mb-4" />
        <p className="text-lg font-medium text-foreground">
          {"You don't have permission to view this page."}
        </p>
        <p className="text-sm mt-1">Only admins can approve projects.</p>
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <CheckCircle2 className="h-10 w-10 text-green-500 mb-4" />
        <p className="text-lg font-medium text-foreground">No projects pending approval.</p>
        <p className="text-sm mt-1">{"You're all caught up!"}</p>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted-foreground">
          {projects.length} project{projects.length !== 1 ? 's' : ''} awaiting review
        </p>
      </div>
      {projects.map((project, i) => (
        <PendingCard key={project.id} project={project} index={i} />
      ))}
    </div>
  );
}
