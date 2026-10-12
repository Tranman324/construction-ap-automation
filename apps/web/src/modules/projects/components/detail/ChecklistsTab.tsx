'use client';

import { useState } from 'react';
import { ClipboardCheck, HardHat, Cog, BadgeCheck, ChevronRight, Lock, CheckCircle2 } from 'lucide-react';
import { useChecklists, useUsers, useProject } from '@/modules/projects/hooks/queries';
import type { ChecklistInstance, ChecklistSection as SectionType } from '@/modules/projects/types/checklist';
import type { User } from '@/modules/shared/types/user';
import type { OnboardingCompletion } from '@/modules/projects/types/project';
import { ChecklistSection } from '@/modules/projects/components/detail/ChecklistSection';
import { STEP_LABELS } from '@/modules/projects/components/detail/OnboardingGate';
import { Skeleton } from '@/modules/shared/components/ui/skeleton';
import { cn } from '@/modules/shared/lib/utils';

export interface ChecklistUserMeta {
  name: string;
  image?: string | null;
}

export interface ChecklistsTabProps {
  projectId: string;
}

function isSectionGroupComplete(instance: ChecklistInstance | undefined): boolean {
  if (!instance) return false;
  return instance.sections.every((s) => s.items.every((i) => i.is_completed));
}

function getInstanceProgress(instance: ChecklistInstance): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const s of instance.sections) {
    for (const i of s.items) {
      total++;
      if (i.is_completed) done++;
    }
  }
  return { done, total };
}

function getSectionProgress(section: SectionType): { done: number; total: number } {
  const done = section.items.filter((i) => i.is_completed).length;
  return { done, total: section.items.length };
}

const PHASES = [
  { key: 'preflight' as const, label: 'Mobilization', icon: HardHat, color: 'text-blue-600 dark:text-blue-400', ringColor: 'stroke-blue-500', bgColor: 'bg-blue-50 dark:bg-blue-950/30' },
  { key: 'in_process' as const, label: 'Interior Buildout', icon: Cog, color: 'text-amber-600 dark:text-amber-400', ringColor: 'stroke-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-950/30' },
  { key: 'final_inspections' as const, label: 'Final Inspections', icon: BadgeCheck, color: 'text-emerald-600 dark:text-emerald-400', ringColor: 'stroke-emerald-500', bgColor: 'bg-emerald-50 dark:bg-emerald-950/30' },
] as const;

export function ChecklistsTab({ projectId }: ChecklistsTabProps) {
  const { data: rawInstances, isLoading } = useChecklists(projectId);
  const { data: project } = useProject(projectId);
  const { data: usersData } = useUsers();
  const instances: ChecklistInstance[] = rawInstances ?? [];
  const users: User[] = usersData ?? [];
  const userMetaById = Object.fromEntries(
    users.flatMap((user) => [
      [user.id, { name: user.name, image: user.avatar_url || null }],
      [user.azure_id, { name: user.name, image: user.avatar_url || null }],
    ]),
  ) as Record<string, ChecklistUserMeta>;

  const preflight = instances.find((i) => i.type === 'preflight');
  const inProcess = instances.find((i) => i.type === 'in_process');
  const final = instances.find((i) => i.type === 'final_inspections');
  const instanceMap = { preflight, in_process: inProcess, final_inspections: final };

  // Default to preflight, or first available phase
  const [activePhase, setActivePhase] = useState<typeof PHASES[number]['key']>('preflight');

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 flex-1 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="rounded-full bg-muted p-4">
          <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground text-sm">No checklists found for this project.</p>
      </div>
    );
  }

  const activeInstance = instanceMap[activePhase];
  const preflightDone = isSectionGroupComplete(preflight);
  const inProcessDone = isSectionGroupComplete(inProcess);

  return (
    <div className="space-y-6">

      {/* ─── Onboarding Completions Log ─── */}
      {project?.onboarding_completions && Object.keys(project.onboarding_completions).length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Onboarding — Completed
          </p>
          <div className="space-y-2">
            {(Object.entries(project.onboarding_completions) as [string, OnboardingCompletion][])
              .sort(([, a], [, b]) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime())
              .map(([key, meta]) => (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  <span className="font-medium">{STEP_LABELS[key] ?? key}</span>
                  <span className="text-muted-foreground text-xs ml-auto tabular-nums">
                    {new Date(meta.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className="text-muted-foreground text-xs">{meta.completed_by}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ─── Phase Stepper ─── */}
      <div className="flex items-stretch gap-2">
        {PHASES.map((phase, idx) => {
          const inst = instanceMap[phase.key];
          if (!inst) return null;

          const { done, total } = getInstanceProgress(inst);
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const isActive = activePhase === phase.key;
          const isLocked =
            (phase.key === 'in_process' && !preflightDone) ||
            (phase.key === 'final_inspections' && !inProcessDone);
          const isComplete = done === total && total > 0;
          const Icon = phase.icon;

          return (
            <button
              key={phase.key}
              type="button"
              onClick={() => setActivePhase(phase.key)}
              className={cn(
                'relative flex-1 flex items-center gap-3 rounded-xl border p-3 sm:p-4 transition-[background-color,border-color,box-shadow] text-left cursor-pointer',
                isActive
                  ? 'border-primary/30 bg-primary/[0.04] dark:bg-primary/[0.08] shadow-sm ring-1 ring-primary/20'
                  : 'border-border bg-card hover:bg-muted/30 dark:hover:bg-muted/10',
              )}
              style={{ animation: `card-enter 0.4s ease-out ${idx * 80}ms both` }}
            >
              {/* Progress ring */}
              <div className="relative shrink-0">
                <svg viewBox="0 0 36 36" className="h-10 w-10 sm:h-12 sm:w-12">
                  {/* Background track */}
                  <circle
                    cx="18" cy="18" r="15.5"
                    fill="none"
                    strokeWidth="3"
                    className="stroke-muted"
                  />
                  {/* Progress arc */}
                  <circle
                    cx="18" cy="18" r="15.5"
                    fill="none"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${pct * 0.974} 100`}
                    transform="rotate(-90 18 18)"
                    className={cn(
                      'transition-[stroke,stroke-dasharray] duration-500',
                      isComplete ? 'stroke-emerald-500' : phase.ringColor,
                    )}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  {isLocked ? (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Icon className={cn('h-4 w-4', isComplete ? 'text-emerald-500' : phase.color)} />
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn(
                  'text-xs sm:text-sm font-semibold truncate',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}>
                  {phase.label}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground tabular-nums mt-0.5">
                  {done}/{total} · {pct}%
                </p>
              </div>
              {idx < PHASES.length - 1 && (
                <ChevronRight className="absolute -right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 hidden sm:block z-10" />
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Lock Warning ─── */}
      {activePhase === 'in_process' && !preflightDone && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/50 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <Lock className="h-4 w-4 shrink-0" />
          <span>Complete the Pre-Flight checklist to unlock In-Process items.</span>
        </div>
      )}
      {activePhase === 'final_inspections' && !inProcessDone && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/50 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <Lock className="h-4 w-4 shrink-0" />
          <span>Complete the In-Process checklist to unlock Final Inspections.</span>
        </div>
      )}

      {/* ─── Section Cards Grid ─── */}
      {activeInstance && (
        <div className="space-y-3">
          {activeInstance.sections.map((section) => {
            const { done: sDone, total: sTotal } = getSectionProgress(section);
            const sPct = sTotal > 0 ? Math.round((sDone / sTotal) * 100) : 0;
            const sectionComplete = sDone === sTotal && sTotal > 0;
            const phaseConfig = PHASES.find((p) => p.key === activePhase)!;

            return (
              <ChecklistSection
                key={section.title}
                section={section}
                projectId={projectId}
                userMetaById={userMetaById}
                progressPct={sPct}
                progressDone={sDone}
                progressTotal={sTotal}
                isComplete={sectionComplete}
                ringColor={phaseConfig.ringColor}
                accentColor={phaseConfig.color}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
