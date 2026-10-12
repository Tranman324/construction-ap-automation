'use client';

import { Suspense, useMemo, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  HardHat,
  ClipboardCheck,
  FolderCheck,
  FileStack,
} from 'lucide-react';
import { ChecklistsTab } from '@/modules/projects/components/detail/ChecklistsTab';
import { CloseoutDetailTab } from '@/modules/projects/components/closeout/CloseoutDetailTab';
import { SubcontractorsTab } from '@/modules/projects/components/detail/SubcontractorsTab';
import { DocumentsTab } from '@/modules/projects/components/detail/DocumentsTab';
import { ProjectHeader } from '@/modules/projects/components/detail/ProjectHeader';
import { OverviewTab } from '@/modules/projects/components/detail/OverviewTab';
import { OnboardingGate, NocBanner, useOnboardingGate, useNocBanner } from '@/modules/projects/components/detail/OnboardingGate';
import { CheckCircle2 } from 'lucide-react';
import { useProjects } from '@/modules/projects/hooks/queries';
import { useResetOnboarding } from '@/modules/projects/hooks/mutations';
import type { Project } from '@/modules/projects/types/project';
import { Button } from '@/modules/shared/components/ui/button';
import { cn } from '@/modules/shared/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/modules/shared/components/ui/tooltip';

const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'subcontractors', label: 'Subcontractors', icon: HardHat },
  { value: 'checklists', label: 'Checklists', icon: ClipboardCheck },
  { value: 'closeout', label: 'Closeout', icon: FolderCheck },
  { value: 'documents', label: 'Documents', icon: FileStack },
] as const;

export function ProjectDetail({ id }: { id: string }) {
  const router = useRouter();
  const resetOnboarding = useResetOnboarding();

  // Auto-reset onboarding when leaving this project (demo convenience)
  useEffect(() => {
    return () => {
      resetOnboarding.mutate({ id });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Fetch project list for prev/next navigation (unfiltered, default sort)
  const { data: projectListData } = useProjects();
  const projects = useMemo<Project[]>(
    () => projectListData?.data ?? [],
    [projectListData?.data],
  );

  const { prevProject, nextProject, currentIndex, totalCount } = useMemo(() => {
    if (projects.length === 0) return { prevProject: null, nextProject: null, currentIndex: -1, totalCount: 0 };
    const idx = projects.findIndex((p) => p.id === id);
    return {
      prevProject: idx > 0 ? projects[idx - 1] : null,
      nextProject: idx < projects.length - 1 ? projects[idx + 1] : null,
      currentIndex: idx,
      totalCount: projects.length,
    };
  }, [projects, id]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Navigation bar: back + prev/next */}
      <div className="flex items-center justify-between px-4 sm:px-6 pt-3 pb-1">
        <button
          onClick={() => router.push('/projects')}
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          All Projects
        </button>

        {totalCount > 0 && currentIndex >= 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground tabular-nums mr-2">
              {currentIndex + 1} of {totalCount}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={!prevProject}
                  onClick={() => prevProject && router.push(`/projects/${prevProject.id}`)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {prevProject ? prevProject.job_name : 'No previous project'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={!nextProject}
                  onClick={() => nextProject && router.push(`/projects/${nextProject.id}`)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {nextProject ? nextProject.job_name : 'No next project'}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Header — always visible (has its own loading skeleton) */}
      <ProjectHeader projectId={id} />

      {/* useSearchParams() requires Suspense boundary in Next.js App Router */}
      <Suspense>
        <ProjectTabNav id={id} />
      </Suspense>
    </div>
  );
}

/* ─── Tab navigation (uses useSearchParams → requires Suspense wrapper) ─── */

function ProjectTabNav({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'overview';
  const { blocked } = useOnboardingGate(id);
  const { show: showNocBanner } = useNocBanner(id);

  // Track gate → unblocked transition (no timers — CSS-driven)
  const prevBlocked = useRef(blocked);
  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    let frameId: number | null = null;

    if (prevBlocked.current && !blocked) {
      frameId = window.requestAnimationFrame(() => {
        setShowCelebration(true);
      });
    }

    prevBlocked.current = blocked;

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [blocked]);

  function handleTabChange(value: string) {
    if (blocked) return;
    router.replace('?tab=' + value, { scroll: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const tabContent: Record<string, React.ReactNode> = {
    overview: <OverviewTab projectId={id} />,
    subcontractors: <SubcontractorsTab projectId={id} />,
    checklists: <ChecklistsTab projectId={id} />,
    closeout: <CloseoutDetailTab projectId={id} />,
    documents: <DocumentsTab projectId={id} />,
  };

  return (
    <>
      {/* NOC banner — shown above tabs when steps 1-4 done but NOC pending */}
      {!blocked && showNocBanner && <NocBanner projectId={id} />}

      {/* Celebration overlay — auto-removes after animation */}
      {showCelebration && (
        <div
          className="flex flex-col items-center justify-center py-20 gap-4 animate-in fade-in zoom-in-95 duration-500"
          onAnimationEnd={() => {
            // After the enter animation finishes, start the exit
            // We use a short RAF to allow the enter to fully paint, then fade out
            requestAnimationFrame(() => {
              setShowCelebration(false);
            });
          }}
          style={{ animationDuration: '1.6s' }}
        >
          <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-5 animate-in zoom-in-50 duration-500">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
          </div>
          <div className="text-center space-y-1 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200" style={{ animationFillMode: 'backwards' }}>
            <p className="text-lg font-semibold">Onboarding Complete</p>
            <p className="text-sm text-muted-foreground">Project dashboard is now unlocked</p>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className={cn(
        'sticky top-0 z-10 backdrop-blur-md border-b border-border transition-[opacity] duration-500',
        blocked && 'opacity-50 pointer-events-none',
        !blocked && !showCelebration && 'animate-in fade-in slide-in-from-top-2 duration-500',
      )}>
        <div className="px-4 sm:px-6">
          <nav className="flex gap-1 overflow-x-auto py-2 -mb-px" role="tablist">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = !blocked && activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  role="tab"
                  aria-selected={isActive}
                  aria-disabled={blocked}
                  onClick={() => handleTabChange(tab.value)}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-[background-color,color,box-shadow]',
                    blocked
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab content or onboarding gate */}
      {blocked ? (
        <OnboardingGate projectId={id} />
      ) : (
        <div className="flex-1 px-4 sm:px-6 py-6">
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-500">
            {tabContent[activeTab]}
          </div>
        </div>
      )}
    </>
  );
}
