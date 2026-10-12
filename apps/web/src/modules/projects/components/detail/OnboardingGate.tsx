'use client';

import {
  CheckCircle2,
  DollarSign,
  Users,
  Scale,
  Landmark,
  ShieldCheck,
  ExternalLink,
  Clock,
  Lock,
} from 'lucide-react';
import { useProject } from '@/modules/projects/hooks/queries';
import { useUpdateOnboardingStep, useUpdateViewpointTask } from '@/modules/projects/hooks/mutations';
import { useAuth } from '@/modules/shared/lib/auth';
import { ORG_NAME, DEFAULT_RETAINAGE_PERCENT } from '@/modules/projects/mock/index';
import type { OnboardingSteps, ViewpointTasks } from '@/modules/projects/types/project';
import { GATE_STEPS } from '@/modules/projects/types/project';
import { Card, CardContent } from '@/modules/shared/components/ui/card';
import { cn } from '@/modules/shared/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currencyFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const dateFmt = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

function daysFromNow(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Steps 1-4 must be complete to unlock the project detail tabs.
 * Step 5 (NOC) does NOT gate the project.
 */
export function useOnboardingGate(projectId: string): { blocked: boolean; loading: boolean } {
  const { data: project, isLoading } = useProject(projectId);
  if (isLoading) return { blocked: false, loading: true };
  if (!project?.onboarding_steps) return { blocked: false, loading: false };
  const steps = project.onboarding_steps;
  const gateComplete = GATE_STEPS.every((k) => {
    const v = steps[k];
    return typeof v === 'boolean' ? v : false;
  });
  return { blocked: !gateComplete, loading: false };
}

/**
 * Returns whether the NOC banner should show above the tabs.
 * True when steps 1-4 are done but NOC is still incomplete.
 */
export function useNocBanner(projectId: string): { show: boolean } {
  const { data: project } = useProject(projectId);
  if (!project?.onboarding_steps) return { show: false };
  const steps = project.onboarding_steps;
  const gateComplete = GATE_STEPS.every((k) => {
    const v = steps[k];
    return typeof v === 'boolean' ? v : false;
  });
  return { show: gateComplete && !steps.notice_of_commencement };
}

// ─── Gate Component (steps 1-4) ───────────────────────────────────────────────

export function OnboardingGate({ projectId }: { projectId: string }) {
  const { data: project } = useProject(projectId);
  const { user } = useAuth();
  const updateStep = useUpdateOnboardingStep();
  const updateVpTask = useUpdateViewpointTask();

  if (!project?.onboarding_steps) return null;

  const steps = project.onboarding_steps;

  // Only count steps 1-4 for the gate progress
  const gateStepValues = GATE_STEPS.map((k) => {
    const v = steps[k];
    return typeof v === 'boolean' ? v : false;
  });
  const completedCount = gateStepValues.filter(Boolean).length;
  const totalSteps = GATE_STEPS.length;
  const pct = Math.round((completedCount / totalSteps) * 100);

  const toggleStep = (step: keyof OnboardingSteps) => {
    if (step === 'viewpoint' || step === 'viewpoint_tasks') return;
    const current = steps[step];
    if (typeof current !== 'boolean') return;
    updateStep.mutate({ id: project.id, step, complete: !current, completedBy: user?.name });
  };

  const toggleVpTask = (task: keyof ViewpointTasks) => {
    const current = steps.viewpoint_tasks?.[task] ?? false;
    updateVpTask.mutate({ id: project.id, task, complete: !current, completedBy: user?.name });
  };

  const vpTasks = steps.viewpoint_tasks;
  const vpDoneCount = vpTasks ? Object.values(vpTasks).filter(Boolean).length : 0;
  const vpTotalCount = 7;

  const stepConfigs: Array<{
    key: keyof OnboardingSteps;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
    hasSubChecklist?: boolean;
    content: React.ReactNode;
  }> = [
    {
      key: 'paycom',
      label: 'Paycom — Add Job Code',
      icon: DollarSign,
      description: 'Create the job code in Paycom so payroll can be charged to this project.',
      content: (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <DataRow label="Code" value={project.job_number} mono />
            <DataRow label="Description" value={`${project.job_number} ${project.job_name}`} />
            <DataRow label="GL" value={project.job_number} mono />
          </div>
          <HowTo
            steps={[
              'Log in to Paycom',
              'Navigate to GL → Job Codes → Add Job Code',
              'Enter Code, Description, and GL as shown above',
              'Save and verify the code appears in the list',
            ]}
            linkUrl="https://www.paycomonline.net/"
            linkLabel="Open Paycom"
          />
        </div>
      ),
    },
    {
      key: 'viewpoint',
      label: 'Viewpoint Team — Project Setup',
      icon: Users,
      description: 'Complete all sub-tasks to finish Viewpoint setup.',
      hasSubChecklist: true,
      content: (
        <div className="space-y-3">
          <p className="text-[11px] font-medium text-muted-foreground tabular-nums">{vpDoneCount}/{vpTotalCount} tasks complete</p>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-[width,background-color] duration-300',
                vpDoneCount === vpTotalCount ? 'bg-green-500' : 'bg-primary',
              )}
              style={{ width: `${Math.round((vpDoneCount / vpTotalCount) * 100)}%` }}
            />
          </div>
          <ul className="space-y-2.5">
            {([
              {
                task: 'spectrum' as const,
                label: 'Pull Project from Spectrum',
              },
              {
                task: 'contacts' as const,
                label: 'Add Project Contacts',
                details: [
                  `PMs assigned to this project (Project Manager)`,
                  `Superintendents assigned to this project (Superintendent)`,
                  `Owen Hartley (Project Manager)`,
                  `Wes Cardell (Project Manager)`,
                  `Subcontractors (Subcontractor)`,
                ],
              },
              {
                task: 'file_structure' as const,
                label: 'Import File Structure into Documents',
              },
              {
                task: 'drawings' as const,
                label: 'Upload Drawings',
              },
              {
                task: 'daily_logs' as const,
                label: 'Set up Daily Logs',
              },
              {
                task: 'submittals' as const,
                label: 'Project Defaults for Submittals',
                details: [
                  'Enable automatic submission by project',
                  'Default reviewer as PM or Project Coordinator',
                  'Default approver as person representing customer',
                  'Enable default review days',
                ],
              },
              {
                task: 'rfis' as const,
                label: 'Project Defaults for RFIs',
                details: [
                  'Enable automatic RFI by project',
                ],
              },
            ]).map(({ task, label, details }) => {
              const done = vpTasks?.[task] ?? false;
              return (
                <li key={task}>
                  <button
                    onClick={() => toggleVpTask(task)}
                    className="flex items-start gap-2.5 w-full text-left py-1 group cursor-pointer"
                  >
                    <div className={cn(
                      'shrink-0 mt-0.5 h-4.5 w-4.5 rounded border flex items-center justify-center transition-[background-color,border-color,color]',
                      done
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-muted-foreground/30 group-hover:border-primary',
                    )}>
                      {done && <CheckCircle2 className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0">
                      <span className={cn(
                        'text-sm',
                        done ? 'line-through text-muted-foreground' : 'text-foreground',
                      )}>
                        {label}
                      </span>
                      {details && !done && (
                        <ul className="mt-1 ml-1 space-y-0.5">
                          {details.map((d) => (
                            <li key={d} className="text-xs text-muted-foreground flex items-baseline gap-1.5">
                              <span className="shrink-0 text-[8px]">●</span>
                              {d}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <ExternalLinkButton href="https://team.viewpoint.com/" label="Open Viewpoint Team" />
        </div>
      ),
    },
    {
      key: 'aia_a105',
      label: 'AIA A105 — Contract Document',
      icon: Scale,
      description: 'Generate the AIA A105 owner-contractor agreement from project data.',
      content: (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
            <DataRow label="Owner" value={project.customer_name} />
            <DataRow label="Contractor" value={ORG_NAME} />
            <DataRow label="Project" value={project.job_name} />
            <DataRow label="Address" value={project.address} />
            <DataRow label="Contract Sum" value={currencyFull.format(project.contract_value)} />
            <DataRow label="Start Date" value={dateFmt(project.start_date)} />
            <DataRow label="Substantial Completion" value={dateFmt(project.end_date)} />
            <DataRow label="Retainage" value={`${DEFAULT_RETAINAGE_PERCENT}%`} />
          </div>
          <HowTo
            steps={[
              'Open AIA Contract Documents Online',
              'Select A105 — Standard Short Form of Agreement',
              'Fill in the fields above from the data panel',
              'Submit for owner signature',
            ]}
            linkUrl="https://www.aiacontracts.com/"
            linkLabel="AIA Contract Documents"
          />
        </div>
      ),
    },
    {
      key: 'permits',
      label: 'Apply for Permits',
      icon: Landmark,
      description: 'Submit building permit applications based on project scope and jurisdiction.',
      content: (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <DataRow label="Project Address" value={project.address} />
            <DataRow label="Contract Value" value={currency.format(project.contract_value)} />
          </div>
          <HowTo
            steps={[
              'Identify jurisdiction from project address',
              'Visit the county/city permitting portal',
              'Submit building permit application with scope of work',
              'Upload contractor license and insurance certificates',
              'Pay applicable permit fees',
              'Track permit status — update project when obtained',
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex-1 px-4 sm:px-6 py-6 animate-in fade-in-5 duration-300">
      {/* Locked banner */}
      <div className="flex items-center gap-3 mb-6 p-4 rounded-lg border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/20">
        <div className="rounded-lg bg-amber-100 dark:bg-amber-900/30 p-2 shrink-0">
          <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Complete onboarding to unlock this project</p>
          <p className="text-xs text-muted-foreground">
            All 4 steps must be verified before the project dashboard is accessible.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn(
            'text-lg font-bold tabular-nums',
            pct === 100 ? 'text-green-600 dark:text-green-400' : 'text-primary',
          )}>{pct}%</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-6">
        <div
          className={cn(
            'h-full rounded-full transition-[width,background-color] duration-500 ease-out',
            pct === 100 ? 'bg-green-500' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Steps 1-4 */}
      <div className="space-y-3">
        {stepConfigs.map((config, i) => {
          const done = config.key === 'viewpoint'
            ? steps.viewpoint
            : (typeof steps[config.key] === 'boolean' ? (steps[config.key] as boolean) : false);
          const StepIcon = config.icon;

          return (
            <Card
              key={config.key}
              className={cn(
                'transition-[background-color,border-color,box-shadow] duration-200 animate-in fade-in slide-in-from-bottom-2',
                done
                  ? 'bg-muted/30 border-green-200/40 dark:border-green-800/20'
                  : 'hover:shadow-sm hover:border-primary/15',
              )}
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'backwards' }}
            >
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  {/* Checkbox — disabled for viewpoint (derived from sub-tasks) */}
                  {config.hasSubChecklist ? (
                    <div className={cn(
                      'mt-0.5 shrink-0 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-[background-color,border-color,color]',
                      done
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-muted-foreground/30',
                    )}>
                      {done && <CheckCircle2 className="h-4 w-4" />}
                    </div>
                  ) : (
                    <button
                      onClick={() => toggleStep(config.key)}
                      className={cn(
                        'mt-0.5 shrink-0 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-[background-color,border-color,color,scale] cursor-pointer',
                        done
                          ? 'bg-green-500 border-green-500 text-white scale-100'
                          : 'border-muted-foreground/30 hover:border-primary hover:scale-110',
                      )}
                      aria-label={`Mark ${config.label} as ${done ? 'incomplete' : 'complete'}`}
                    >
                      {done && <CheckCircle2 className="h-4 w-4" />}
                    </button>
                  )}

                  {/* Step body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                        {i + 1}/{totalSteps}
                      </span>
                      <StepIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <h3 className={cn(
                      'text-sm font-semibold mt-0.5',
                      done && 'line-through text-muted-foreground',
                    )}>
                      {config.label}
                    </h3>

                    {!done && (
                      <>
                        <p className="text-xs text-muted-foreground mt-1">{config.description}</p>
                        <div className="mt-3 border-l-2 border-primary/10 pl-3">
                          {config.content}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── NOC Banner (step 5 — shown above tabs after 1-4 complete) ────────────────

export function NocBanner({ projectId }: { projectId: string }) {
  const { data: project } = useProject(projectId);
  const { user } = useAuth();
  const updateStep = useUpdateOnboardingStep();

  if (!project?.onboarding_steps) return null;
  const steps = project.onboarding_steps;
  if (steps.notice_of_commencement) return null;

  const nocDeadline = project.start_date
    ? new Date(new Date(project.start_date).getTime() - 15 * 86400000)
    : null;
  const nocDaysLeft = nocDeadline ? daysFromNow(nocDeadline.toISOString()) : null;

  const handleComplete = () => {
    updateStep.mutate({
      id: project.id,
      step: 'notice_of_commencement',
      complete: true,
      completedBy: user?.name,
    });
  };

  return (
    <Card className="mx-4 sm:mx-6 mt-4 border-amber-200/60 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10">
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-amber-100 dark:bg-amber-900/30 p-2 shrink-0 mt-0.5">
            <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">Notice of Commencement — Pending</h3>
              {nocDeadline && nocDaysLeft !== null && (
                <span className={cn(
                  'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md',
                  nocDaysLeft <= 7
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : nocDaysLeft <= 14
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                )}>
                  <Clock className="h-3 w-3" />
                  {nocDaysLeft <= 0
                    ? 'Deadline passed!'
                    : `${nocDaysLeft}d left`}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              File per O.C.G.A. § 44-14-361.5 before {nocDeadline ? dateFmt(nocDeadline.toISOString()) : 'project start'}.
            </p>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <DataRow label="Owner" value={project.customer_name} />
              <DataRow label="Contractor" value="Northwind Contracting Group" />
              <DataRow label="Project Address" value={project.address} />
              <DataRow label="Filing Deadline" value={nocDeadline ? dateFmt(nocDeadline.toISOString()) : '—'} />
              <DataRow label="Project Start" value={dateFmt(project.start_date)} />
            </div>
          </div>
          <button
            onClick={handleComplete}
            className={cn(
              'shrink-0 mt-0.5 h-7 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer',
              'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            Mark Complete
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers for Checklists tab ───────────────────────────────────────────────

export const STEP_LABELS: Record<string, string> = {
  paycom: 'Paycom — Add Job Code',
  viewpoint: 'Viewpoint Team — Project Setup',
  aia_a105: 'AIA A105 — Contract Document',
  permits: 'Apply for Permits',
  notice_of_commencement: 'Notice of Commencement',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function DataRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-medium', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  );
}

function HowTo({ steps, linkUrl, linkLabel }: { steps: string[]; linkUrl?: string; linkLabel?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3 space-y-2 mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How-To</p>
      <ol className="space-y-1 text-xs text-muted-foreground list-decimal list-inside">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {linkUrl && linkLabel && (
        <ExternalLinkButton href={linkUrl} label={linkLabel} />
      )}
    </div>
  );
}

function ExternalLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline mt-1"
    >
      {label} <ExternalLink className="h-3 w-3" />
    </a>
  );
}
