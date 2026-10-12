'use client';

import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Receipt, PiggyBank, RefreshCw, CalendarDays, Briefcase, Shield, FileCheck2, Users, User, Phone, Mail, Hash, Camera, Building2, Sparkles } from 'lucide-react';
import { useProject, useProjectTeam } from '@/modules/projects/hooks/queries';
import { useTeamScraperData } from '@/modules/projects/hooks/useTeamScraperData';
import { getUserById, getProjectContacts, getChecklistsForProject, getDocsForProject } from '@/modules/projects/mock/index';
import type { ProjectTeamMember } from '@/modules/projects/types/project';
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import { QualityCheckOverview, QualityCheckHistory } from '@/modules/projects/components/detail/QualityCheck';
import { Badge } from '@/modules/shared/components/ui/badge';
import { Button } from '@/modules/shared/components/ui/button';
import { Skeleton } from '@/modules/shared/components/ui/skeleton';
import { cn } from '@/modules/shared/lib/utils';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ActivityEntry {
  id: string;
  timestamp: string;
  actorId: string | null;
  action: string;
}

export function OverviewTab({ projectId }: { projectId: string }) {
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: rawTeam } = useProjectTeam(projectId);
  const team: ProjectTeamMember[] = rawTeam ?? [];
  const { data: teamData } = useTeamScraperData(projectId);

  if (projectLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" style={{ animation: `card-enter 0.4s ease-out ${i * 60}ms both` }} />
          ))}
        </div>
        <Skeleton className="h-20 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!project) {
    return <p className="text-muted-foreground p-4">Project data unavailable.</p>;
  }

  const primaryPMMember = team.find((m) => m.role === 'pm' && m.is_primary) ?? null;
  const primarySuperMember = team.find((m) => m.role === 'superintendent' && m.is_primary) ?? null;

  // Build rich activity timeline from project lifecycle + checklist data
  const checklistInstances = getChecklistsForProject(project.id);
  const startDate = new Date(project.start_date);

  function addHours(date: Date, hours: number): string {
    return new Date(date.getTime() + hours * 3600_000).toISOString();
  }

  const activityEntries: ActivityEntry[] = [
    { id: 'a-01', timestamp: project.created_at, actorId: null, action: 'Project created in Spectrum' },
    ...(primaryPMMember
      ? [{ id: 'a-02', timestamp: project.created_at, actorId: primaryPMMember.user_id, action: 'Assigned as Primary PM' }]
      : []),
    ...(project.approved_at
      ? [{ id: 'a-03', timestamp: project.approved_at, actorId: project.approved_by, action: 'Project approved and activated' }]
      : []),
    ...team
      .filter((m) => !(m.role === 'pm' && m.is_primary))
      .map((m, i) => ({
        id: `a-team-${m.id}`,
        timestamp: addHours(startDate, -48 + i * 2),
        actorId: m.user_id,
        action: `Added to project team as ${m.role === 'pm' ? 'Project Manager' : 'Superintendent'}`,
      })),
    // Permit milestone
    ...(project.permit_status === 'obtained'
      ? [{ id: 'a-permit', timestamp: addHours(startDate, -24), actorId: primaryPMMember?.user_id ?? null, action: 'Building permit obtained and posted' }]
      : []),
    // Contract milestone
    ...(project.contract_status === 'in_hand'
      ? [{ id: 'a-contract', timestamp: addHours(startDate, -36), actorId: primaryPMMember?.user_id ?? null, action: 'Signed contract received' }]
      : []),
    // Checklist milestones
    ...checklistInstances.flatMap(inst => {
      const entries: ActivityEntry[] = [];
      const typeLabel = inst.type === 'preflight' ? 'Mobilization checklist' : inst.type === 'in_process' ? 'Interior Buildout checklist' : 'Final Inspections checklist';
      entries.push({
        id: `a-cl-start-${inst.type}`,
        timestamp: inst.started_at ?? project.start_date,
        actorId: primarySuperMember?.user_id ?? null,
        action: `${typeLabel} started`,
      });
      if (inst.completed_at) {
        entries.push({
          id: `a-cl-done-${inst.type}`,
          timestamp: inst.completed_at,
          actorId: primarySuperMember?.user_id ?? null,
          action: `${typeLabel} completed — all items verified`,
        });
      }
      // Add some section-level events for partially-done checklists
      inst.sections.forEach((sec, secIdx) => {
        const done = sec.items.filter(i => i.is_completed).length;
        if (done === sec.items.length && sec.items.length > 0) {
          const lastItem = sec.items.filter(i => i.completed_at).sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())[0];
          if (lastItem?.completed_at && secIdx % 3 === 0) {
            entries.push({
              id: `a-sec-${inst.type}-${secIdx}`,
              timestamp: lastItem.completed_at,
              actorId: lastItem.completed_by,
              action: `Completed section: ${sec.title}`,
            });
          }
        }
      });
      // Photo evidence milestones
      const photoItems = inst.sections.flatMap(s => s.items).filter(i => i.requires_photo && i.photo_url);
      if (photoItems.length > 3) {
        entries.push({
          id: `a-photos-${inst.type}`,
          timestamp: photoItems[Math.floor(photoItems.length / 2)]?.completed_at ?? inst.started_at ?? project.start_date,
          actorId: primarySuperMember?.user_id ?? null,
          action: `${photoItems.length} photo evidence items captured for ${typeLabel.toLowerCase()}`,
        });
      }
      return entries;
    }),
    // Document upload events derived from actual mock documents
    ...getDocsForProject(project.id).map((doc, i) => ({
      id: `a-doc-${i}`,
      timestamp: doc.uploaded_at,
      actorId: null as string | null,
      action: `${doc.file_name} uploaded (${doc.category})`,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 15);

  const budgetSpentPercent =
    project.estimated_cost != null && project.estimated_cost > 0 && project.cost_jtd != null
      ? (project.cost_jtd / project.estimated_cost) * 100
      : null;
  const budgetRemaining =
    project.estimated_cost != null && project.cost_jtd != null
      ? project.estimated_cost - project.cost_jtd
      : null;
  const projectedMargin =
    project.estimated_cost != null ? project.contract_value - project.estimated_cost : null;
  const marginPercent =
    projectedMargin != null && project.contract_value > 0
      ? (projectedMargin / project.contract_value) * 100
      : null;

  function permitBadgeClass(status: string): string {
    if (status === 'obtained') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    if (status === 'in_process') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    return '';
  }
  function contractBadgeClass(status: string): string {
    if (status === 'in_hand') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    if (status === 'in_progress') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    return '';
  }

  const budgetBarColor =
    budgetSpentPercent != null && budgetSpentPercent > 90
      ? 'from-red-500 to-red-400 dark:from-red-600 dark:to-red-500'
      : budgetSpentPercent != null && budgetSpentPercent > 70
        ? 'from-amber-500 to-amber-400 dark:from-amber-600 dark:to-amber-500'
        : 'from-primary to-primary/80';

  return (
    <div className="space-y-6">

      {/* ─── Financial KPIs ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          icon={DollarSign}
          label="Contract Value"
          value={fmt.format(project.contract_value)}
          accent="text-blue-600 dark:text-blue-400"
          accentBg="bg-blue-100 dark:bg-blue-900/30"
          index={0}
        />
        <KPICard
          icon={Receipt}
          label="Estimated Cost"
          value={project.estimated_cost != null ? fmt.format(project.estimated_cost) : '—'}
          accent="text-violet-600 dark:text-violet-400"
          accentBg="bg-violet-100 dark:bg-violet-900/30"
          index={1}
        />
        <KPICard
          icon={TrendingUp}
          label="Cost JTD"
          value={project.cost_jtd != null ? fmt.format(project.cost_jtd) : '—'}
          accent="text-amber-600 dark:text-amber-400"
          accentBg="bg-amber-100 dark:bg-amber-900/30"
          index={2}
        />
        <KPICard
          icon={PiggyBank}
          label="Projected Margin"
          value={projectedMargin != null ? fmt.format(projectedMargin) : '—'}
          sub={marginPercent != null ? `${pctFmt.format(marginPercent)}%` : undefined}
          accent="text-emerald-600 dark:text-emerald-400"
          accentBg="bg-emerald-100 dark:bg-emerald-900/30"
          index={3}
        />
      </div>

      {/* ─── Budget Progress ─── */}
      {budgetSpentPercent != null && budgetRemaining != null && (
        <div className={cn(
          'rounded-xl border p-5 space-y-3 transition-colors',
          budgetSpentPercent > 90
            ? 'border-red-200 bg-red-50/30 dark:border-red-900/40 dark:bg-red-950/10'
            : 'border-border bg-card',
        )}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Budget Utilization</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmt.format(project.cost_jtd ?? 0)} of {fmt.format(project.estimated_cost ?? 0)} spent
              </p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {pctFmt.format(budgetSpentPercent)}%
              </span>
              <p className="text-xs text-muted-foreground">
                {fmt.format(budgetRemaining)} remaining
              </p>
            </div>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full bg-gradient-to-r transition-[width,background-color] duration-500', budgetBarColor)}
              style={{ width: `${Math.min(budgetSpentPercent, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ─── Two Column: Project Details + AI Summary ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Project Details — 3 cols */}
        <div className="lg:col-span-3 rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Project Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <InfoRow icon={Building2} label="Customer" value={project.customer_name} />
            <InfoRow icon={Briefcase} label="Job Type" value={project.job_type ?? '—'} />
            <InfoRow icon={CalendarDays} label="Start Date" value={fmtDate(project.start_date)} />
            <InfoRow icon={CalendarDays} label="Projected End" value={fmtDate(project.projected_end_date)} />
            <InfoRow icon={CalendarDays} label="Actual End" value={fmtDate(project.end_date)} />
            <InfoRow
              icon={DollarSign}
              label="Profit %"
              value={project.profit_percent != null ? project.profit_percent.toFixed(1) + '%' : '—'}
            />
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                <Shield className="h-3 w-3" /> Permit Status
              </p>
              <Badge
                variant={permitBadgeClass(project.permit_status) ? undefined : 'secondary'}
                className={cn(permitBadgeClass(project.permit_status) || undefined)}
              >
                {project.permit_status.replace(/_/g, ' ')}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                <FileCheck2 className="h-3 w-3" /> Contract Status
              </p>
              <Badge
                variant={contractBadgeClass(project.contract_status) ? undefined : 'secondary'}
                className={cn(contractBadgeClass(project.contract_status) || undefined)}
              >
                {project.contract_status.replace(/_/g, ' ')}
              </Badge>
            </div>
            <InfoRow icon={Briefcase} label="Closeout Type" value={project.closeout_type === 'full' ? 'Full' : 'Short'} />
            <InfoRow icon={Hash} label="Estimate #" value={project.estimate_number ?? '—'} />
            {/* Photography Required notice */}
            {(() => {
              const allItems = getChecklistsForProject(project.id).flatMap(inst => inst.sections.flatMap(s => s.items));
              const photosNeeded = allItems.some(i => i.is_completed && i.requires_photo && i.photo_url === null);
              const photoItemCount = allItems.filter(i => i.requires_photo).length;
              return photoItemCount > 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                    <Camera className="h-3 w-3" /> Photography
                  </p>
                  <Badge
                    className={cn(
                      photosNeeded
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                    )}
                  >
                    {photosNeeded ? `${allItems.filter(i => i.is_completed && i.requires_photo && i.photo_url === null).length} photos missing` : 'All photos captured'}
                  </Badge>
                </div>
              ) : null;
            })()}
          </div>
        </div>

        {/* AI Project Summary — 2 cols */}
        <div className="lg:col-span-2">
          <AISummaryTile projectId={project.id} project={project} checklistInstances={checklistInstances} team={team} />
        </div>
      </div>

      {/* ─── Two Column: Weekly Quality Check + Viewpoint Team ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Weekly Quality Check — left */}
        <QualityCheckOverview projectId={projectId} />

        {/* Viewpoint Team — right */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Viewpoint Team</h3>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8 gap-1.5"
              onClick={() => console.log('[STUB] Refresh Team data for project', projectId)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
          {!teamData ? (
            <p className="text-sm text-muted-foreground">Team data unavailable.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <TeamStat
                  label="Submittals"
                  primary={`${teamData.submittals.open} open`}
                  secondary={`${teamData.submittals.approved} approved \u00b7 ${teamData.submittals.total} total`}
                />
                <TeamStat
                  label="RFIs"
                  primary={`${teamData.rfis.open} open`}
                  secondary={`${teamData.rfis.closed} closed`}
                />
                <TeamStat
                  label="Daily Log"
                  primary={`${teamData.dailyLog.streak}-day streak`}
                  secondary={`Last: ${teamData.dailyLog.lastCompleted}`}
                />
              </div>
              {teamData.photos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {teamData.photos.slice(0, 6).map((url: string, i: number) => (
                    <img
                      key={i}
                      src={url}
                      alt="Project photo"
                      className="h-20 w-20 object-cover rounded-lg shrink-0 border border-border"
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Quality Check History + Recent Activity (side by side) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <QualityCheckHistory projectId={projectId} />

        {/* Recent Activity */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 shrink-0">Recent Activity</h3>
          {activityEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <div className="relative overflow-y-auto max-h-[28rem] pr-1">
              {/* Timeline line */}
              <div className="absolute left-3 top-2 bottom-2 w-px bg-gradient-to-b from-border via-border/60 to-transparent" />
              <ul className="space-y-4">
                {activityEntries.map((entry) => {
                  const actor = entry.actorId ? getUserById(entry.actorId) : null;
                  return (
                    <li key={entry.id} className="relative flex items-start gap-3 pl-1 rounded-lg hover:bg-muted/30 transition-colors">
                      <div className="relative z-10 shrink-0">
                        <UserAvatar
                          user={{ name: actor?.name ?? 'System', image: actor?.avatar_url }}
                          size="sm"
                        />
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-sm text-foreground leading-snug">{entry.action}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(entry.timestamp)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ─── Project Contacts ─── */}
      <ProjectContactsCard projectId={projectId} />

    </div>
  );
}

/* ─── Sub-components ─── */

function KPICard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  accentBg,
  index = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent: string;
  accentBg: string;
  index?: number;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/15 transition-[border-color,box-shadow]"
      style={{ animation: `card-enter 0.4s ease-out ${index * 60}ms both` }}
    >
      <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center', accentBg)}>
        <Icon className={cn('h-4.5 w-4.5', accent)} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold tabular-nums text-foreground mt-0.5">{value}</p>
        {sub && <p className={cn('text-xs font-medium mt-0.5', accent)}>{sub}</p>}
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground truncate">{value || '—'}</p>
      </div>
    </div>
  );
}

function TeamStat({ label, primary, secondary }: { label: string; primary: string; secondary: string }) {
  return (
    <div className="rounded-lg bg-muted/40 dark:bg-muted/20 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground mt-1">{primary}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{secondary}</p>
    </div>
  );
}

/* ─── AI Summary Tile ─── */

function AISummaryTile({
  project,
  checklistInstances,
  team,
}: {
  projectId: string;
  project: { id: string; job_name: string; phase: number; contract_value: number; start_date: string; permit_status: string; contract_status: string };
  checklistInstances: import('@/modules/projects/types/checklist').ChecklistInstance[];
  team: ProjectTeamMember[];
}) {
  const totalItems = checklistInstances.reduce((sum, inst) => sum + inst.sections.reduce((s, sec) => s + sec.items.length, 0), 0);
  const completedItems = checklistInstances.reduce((sum, inst) => sum + inst.sections.reduce((s, sec) => s + sec.items.filter(i => i.is_completed).length, 0), 0);
  const photoRequired = checklistInstances.reduce((sum, inst) => sum + inst.sections.reduce((s, sec) => s + sec.items.filter(i => i.requires_photo).length, 0), 0);
  const photosCaptured = checklistInstances.reduce((sum, inst) => sum + inst.sections.reduce((s, sec) => s + sec.items.filter(i => i.requires_photo && i.photo_url).length, 0), 0);
  const completedChecklists = checklistInstances.filter(i => i.completed_at).length;
  const pms = team.filter(m => m.role === 'pm');
  const supers = team.filter(m => m.role === 'superintendent');
  const uniqueCompletedBy = new Set(
    checklistInstances.flatMap(inst => inst.sections.flatMap(sec => sec.items.filter(i => i.completed_by).map(i => i.completed_by!)))
  );

  const phaseLabel = project.phase === 1 ? 'Job Setup' : project.phase === 2 ? 'Execution' : project.phase === 3 ? 'Close Out' : 'Complete';

  const bullets: string[] = [];

  if (totalItems > 0) {
    bullets.push(`${completedItems} of ${totalItems} checklist items completed across ${checklistInstances.length} checklist${checklistInstances.length !== 1 ? 's' : ''} (${completedChecklists} fully signed off).`);
  }
  if (photoRequired > 0) {
    bullets.push(`${photosCaptured} of ${photoRequired} required photo evidence items captured${photosCaptured === photoRequired ? ' — all documentation complete.' : '.'}`);
  }
  if (uniqueCompletedBy.size > 0) {
    bullets.push(`Quality checks performed by ${uniqueCompletedBy.size} team member${uniqueCompletedBy.size !== 1 ? 's' : ''}, including ${pms.length} PM${pms.length !== 1 ? 's' : ''} and ${supers.length} superintendent${supers.length !== 1 ? 's' : ''}.`);
  }
  bullets.push(`Project is currently in ${phaseLabel} phase${project.permit_status === 'obtained' ? ' with permits obtained' : ''}${project.contract_status === 'in_hand' ? ' and contract in hand' : ''}.`);
  const docs = getDocsForProject(project.id);
  if (docs.length > 0) {
    bullets.push(`${docs.length} documents stored in SharePoint including ${[...new Set(docs.map(d => d.category.toLowerCase()))].join(', ')}.`);
  }

  // Typewriter state — reveal characters one at a time
  const fullText = bullets.join('\n');
  const [charCount, setCharCount] = useState(0);
  const done = charCount >= fullText.length;

  useEffect(() => {
    if (done) {
      return;
    }
    const id = setTimeout(() => setCharCount(c => c + 1), 12);
    return () => clearTimeout(id);
  }, [charCount, done]);

  // Split the revealed text back into bullet lines
  const revealed = fullText.slice(0, charCount);
  const revealedLines = revealed.split('\n');

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden h-full">
      <div className="px-5 py-3 bg-gradient-to-r from-primary/[0.06] to-transparent dark:from-primary/[0.12] border-b border-border flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Project Intelligence</h3>
      </div>
      <div className="px-5 py-4 space-y-2">
        {revealedLines.map((line, i) => {
          if (!line) return null;
          const isLastLine = i === revealedLines.length - 1 && !done;
          return (
            <div key={i} className="flex items-start gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40" />
              <p className="text-sm text-foreground/80 leading-relaxed">
                {line}
                {isLastLine && (
                  <span
                    className="inline-block w-0.5 h-3.5 bg-primary ml-0.5 align-middle"
                    style={{ animation: 'blink-caret 0.8s step-end infinite' }}
                  />
                )}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Project Contacts Card ─── */

function ProjectContactsCard({ projectId }: { projectId: string }) {
  const contacts = getProjectContacts(projectId);

  if (contacts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card flex flex-col items-center justify-center py-10 gap-2">
        <div className="rounded-full bg-muted p-3">
          <Phone className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No project contacts recorded yet.</p>
        <p className="text-xs text-muted-foreground">Contacts are captured during the Pre-Flight checklist.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 bg-muted/30 dark:bg-muted/10 border-b border-border flex items-center gap-2">
        <Phone className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Project Contacts</h3>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{contacts.length} contacts</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20 dark:bg-muted/5">
              <th className="text-left text-xs font-medium text-muted-foreground px-5 py-2.5">Name</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-5 py-2.5">Position</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-5 py-2.5">Phone</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-5 py-2.5">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {contacts.map((c) => (
              <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3 font-medium text-foreground whitespace-nowrap">{c.name}</td>
                <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    {c.position}
                  </Badge>
                </td>
                <td className="px-5 py-3 whitespace-nowrap">
                  <a
                    href={`tel:${c.phone.replace(/\D/g, '')}`}
                    className="inline-flex items-center gap-1.5 text-foreground hover:text-primary transition-colors"
                  >
                    <Phone className="h-3 w-3 text-muted-foreground" />
                    {c.phone}
                  </a>
                </td>
                <td className="px-5 py-3 whitespace-nowrap">
                  <a
                    href={`mailto:${c.email}`}
                    className="inline-flex items-center gap-1.5 text-foreground hover:text-primary transition-colors"
                  >
                    <Mail className="h-3 w-3 text-muted-foreground" />
                    {c.email}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
