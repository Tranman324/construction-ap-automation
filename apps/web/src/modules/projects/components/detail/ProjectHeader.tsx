'use client';

import { useState } from 'react';
import { MapPin, Pencil, Users, ChevronDown, CheckCircle2, Building2, HardHat, TrendingUp, Download } from 'lucide-react';
import { useProject, useProjectTeam, useProjectFlags, useResolvedFlags, useCurrentUser, useUsers } from '@/modules/projects/hooks/queries';
import type { ResolvedFlagEntry } from '@/modules/projects/hooks/queries';
import { useResolveFlag } from '@/modules/projects/hooks/mutations';
import type { EvaluatedFlag } from '@/modules/projects/lib/healthFlags';
import type { User } from '@/modules/shared/types/user';
import type { ProjectTeamMember } from '@/modules/projects/types/project';
import { HealthBadge } from '@/modules/projects/components/primitives/HealthBadge';
import { PhaseTimeline } from '@/modules/projects/components/primitives/PhaseTimeline';
import { UserAvatar, AvatarGroup } from '@/modules/shared/components/UserAvatar';
import { Button } from '@/modules/shared/components/ui/button';
import { Skeleton } from '@/modules/shared/components/ui/skeleton';
import { cn } from '@/modules/shared/lib/utils';
import { TeamManagementSheet } from '@/modules/projects/components/detail/TeamManagementSheet';
import { canAccess } from '@/modules/projects/lib/permissions';
import { getSiteCheckins, getChecklistsForProject } from '@/modules/projects/mock/index';
import type { ChecklistType } from '@/modules/projects/types/checklist';

function resolveUser(userId: string, users: User[]): User | null {
  return users.find((u) => u.id === userId) ?? null;
}

export function ProjectHeader({ projectId }: { projectId: string }) {
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: rawTeam, isLoading: teamLoading } = useProjectTeam(projectId);
  const { data: usersData } = useUsers();
  const users: User[] = usersData ?? [];
  const team: ProjectTeamMember[] = rawTeam ?? [];
  const isLoading = projectLoading || teamLoading;
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: currentUser } = useCurrentUser();
  const canEdit = currentUser ? canAccess(currentUser, projectId, 'edit') : false;
  const canManageTeam = currentUser ? canAccess(currentUser, projectId, 'manage_team') : false;

  const { data: flagData } = useProjectFlags(projectId);
  const health = flagData?.health ?? 'green';
  const flagCount = flagData?.flags.length ?? 0;
  const flags: EvaluatedFlag[] = flagData?.flags ?? [];
  const [flagsOpen, setFlagsOpen] = useState(false);

  const { mutate: resolveFlag, isPending: resolving } = useResolveFlag();
  const { data: resolvedEntries } = useResolvedFlags(projectId);
  const resolvedFlags: ResolvedFlagEntry[] = resolvedEntries ?? [];
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const resolverName = currentUser?.name ?? 'Unknown User';

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-24 rounded-md" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-2 w-64 rounded-full" />
      </div>
    );
  }

  if (!project) {
    return <p className="text-muted-foreground p-4">Project not found.</p>;
  }

  const primaryPMMember = team.find((m) => m.role === 'pm' && m.is_primary) ?? null;
  const primaryPM = primaryPMMember ? resolveUser(primaryPMMember.user_id, users) : null;
  const primarySuperMember = team.find((m) => m.role === 'superintendent' && m.is_primary) ?? null;
  const primarySuper = primarySuperMember ? resolveUser(primarySuperMember.user_id, users) : null;
  const allTeamUsers = team
    .map((m) => resolveUser(m.user_id, users))
    .filter((u): u is User => u !== null)
    .map((u) => ({ name: u.name, image: u.avatar_url }));

  return (
    <div className="relative">
      {/* Subtle gradient backdrop */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.04] via-transparent to-primary/[0.02] dark:from-primary/[0.08] dark:via-transparent dark:to-primary/[0.04] pointer-events-none" />

      <div className="relative px-4 sm:px-6 py-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">

          {/* ─── Left: Project Identity ─── */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* Job number chip + health */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-md bg-primary/10 text-primary dark:bg-primary/20 border border-primary/10">
                <Building2 className="h-3 w-3" />
                {project.job_number}
              </span>
              <button
                type="button"
                onClick={() => setFlagsOpen((o) => !o)}
                className="inline-flex items-center gap-1"
                disabled={flags.length === 0}
              >
                <HealthBadge health={health} flagCount={flagCount} />
                {flags.length > 0 && (
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 text-muted-foreground transition-transform',
                      flagsOpen && 'rotate-180',
                    )}
                  />
                )}
              </button>
            </div>

            {/* Job name */}
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-tight">
              {project.job_name}
            </h1>

            {/* Address */}
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-primary/60" />
              <span className="truncate max-w-xs">{project.address}</span>
            </p>

            {/* Phase timeline — matches dashboard node style */}
            {(() => {
              const instances = getChecklistsForProject(project.id);
              function summarize(type: ChecklistType) {
                const inst = instances.find(i => i.type === type);
                if (!inst) return { complete: 0, total: 0 };
                const items = inst.sections.flatMap(s => s.items);
                return { complete: items.filter(i => i.is_completed).length, total: items.length };
              }
              // Factor onboarding into mobilization phase
              const mob = summarize('preflight');
              if (project.onboarding_steps) {
                const os = project.onboarding_steps;
                const obKeys: (keyof typeof os)[] = ['paycom', 'viewpoint', 'aia_a105', 'permits', 'notice_of_commencement'];
                mob.total += obKeys.length;
                mob.complete += obKeys.filter(k => {
                  const v = os[k];
                  return typeof v === 'boolean' ? v : false;
                }).length;
              }
              return (
                <div className="max-w-sm pt-1">
                  <PhaseTimeline
                    mobilization={mob}
                    buildout={summarize('in_process')}
                    final={summarize('final_inspections')}
                    startDate={project.start_date}
                  />
                </div>
              );
            })()}

            {/* ─── Flag alerts ─── */}
            {flagsOpen && flags.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {flags.map((f) => (
                  <div
                    key={f.flag_type}
                    className={cn(
                      'flex items-center gap-2 text-xs px-3 py-2 rounded-lg',
                      f.severity === 'red'
                        ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/50'
                        : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/50',
                    )}
                  >
                    <span className="flex-1">{f.flag_text}</span>
                    <button
                      type="button"
                      disabled={resolving}
                      onClick={() => resolveFlag({ projectId, flag_type: f.flag_type, resolvedBy: resolverName })}
                      className="text-xs font-medium hover:underline shrink-0 opacity-80 hover:opacity-100"
                    >
                      Resolve
                    </button>
                  </div>
                ))}
              </div>
            )}
            {resolvedFlags.length > 0 && flagsOpen && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setResolvedOpen((o) => !o)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  {resolvedFlags.length} resolved
                  <ChevronDown className={cn('h-3 w-3 transition-transform', resolvedOpen && 'rotate-180')} />
                </button>
                {resolvedOpen && (
                  <ul className="mt-1 space-y-1 pl-4">
                    {resolvedFlags.map((r) => (
                      <li key={r.flag_type} className="text-xs text-muted-foreground line-through">
                        {r.flag_type.replace(/_/g, ' ')}
                        <span className="ml-2 no-underline not-italic text-[10px]">
                          {new Date(r.resolved_at).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {flagsOpen && flags.length === 0 && (
              <p className="text-xs text-muted-foreground pt-1">No active flags.</p>
            )}
          </div>

          {/* ─── Center: Site Personnel + Physician Form ─── */}
          <div className="hidden xl:flex flex-col gap-3 w-60 shrink-0">
            <SitePersonnelWidget projectId={projectId} />
            <PhysicianFormWidget />
          </div>

          {/* ─── Right: Team Card ─── */}
          <div className="shrink-0 w-full lg:w-72 xl:w-80">
            <div className="rounded-xl border border-border bg-card/80 backdrop-blur-sm p-4 space-y-4 shadow-sm dark:shadow-none dark:bg-card/60">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Project Team
              </p>

              {/* PM */}
              <div className="flex items-center gap-3">
                <UserAvatar
                  user={{ name: primaryPM?.name ?? 'Unassigned', image: primaryPM?.avatar_url }}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{primaryPM?.name ?? 'Unassigned'}</p>
                  <p className="text-xs text-muted-foreground">Project Manager</p>
                </div>
              </div>

              {/* Super */}
              <div className="flex items-center gap-3">
                <UserAvatar
                  user={{ name: primarySuper?.name ?? 'Unassigned', image: primarySuper?.avatar_url }}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{primarySuper?.name ?? 'Unassigned'}</p>
                  <p className="text-xs text-muted-foreground">Superintendent</p>
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Avatars + actions */}
              <div className="flex items-center justify-between">
                <AvatarGroup users={allTeamUsers} />
                <div className="flex gap-1">
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg"
                      onClick={() => console.log('[STUB] Edit project info', projectId)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canManageTeam && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg"
                      onClick={() => setSheetOpen(true)}
                    >
                      <Users className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Mobile: Site Personnel + Physician Form (below header on small screens) ─── */}
      <div className="xl:hidden px-4 sm:px-6 pb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <SitePersonnelWidget projectId={projectId} />
        </div>
        <div className="flex-1">
          <PhysicianFormWidget />
        </div>
      </div>

      <TeamManagementSheet
        projectId={projectId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}

/* ─── Compact Site Personnel Sparkline Widget ─────────────────────────── */
function SitePersonnelWidget({ projectId }: { projectId: string }) {
  const data = getSiteCheckins(projectId);
  if (!data) return null;

  const trend = data.trend.slice(-14);
  const max = Math.max(...trend.map((t) => t.count), 1);
  const w = 120;
  const h = 32;
  const points = trend
    .map((t, i) => `${(i / (trend.length - 1)) * w},${h - (t.count / max) * h}`)
    .join(' ');

  const diff = data.todayCount - data.yesterdayCount;
  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  const color = diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : diff < 0 ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground';

  return (
    <div className="rounded-lg border border-border bg-card/60 backdrop-blur-sm p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <HardHat className="h-3 w-3" />
        Site Personnel
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-bold tabular-nums text-foreground leading-none">{data.todayCount}</p>
          <p className={cn('text-[10px] font-medium mt-0.5', color)}>
            {arrow} {Math.abs(diff)} vs yesterday
          </p>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-[100px] h-[28px] shrink-0" preserveAspectRatio="none">
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-primary/60"
          />
        </svg>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Week avg: <span className="font-medium text-foreground">{data.weekAvg}</span>
      </p>
    </div>
  );
}

/* ─── Compact Physician Form Download Widget ─────────────────────────── */
function PhysicianFormWidget() {
  return (
    <div className="rounded-lg border border-border bg-card/60 backdrop-blur-sm p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Download className="h-3 w-3" />
        {"Physician's Form"}
      </div>
      <div className="flex gap-2">
        <a
          href="/forms/physician-form-en.pdf"
          download
          className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 border border-primary/10 transition-colors"
        >
          English
        </a>
        <a
          href="/forms/physician-form-es.pdf"
          download
          className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 border border-primary/10 transition-colors"
        >
          Español
        </a>
      </div>
    </div>
  );
}
