'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  FolderOpen,
  Plus,
  ClipboardList,
  ClipboardCheck,
  LayoutGrid,
  GanttChart as GanttIcon,
  Users,
} from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/modules/shared/components/ui/select';
import { Button } from '@/modules/shared/components/ui/button';
import { Card, CardContent } from '@/modules/shared/components/ui/card';
import { Skeleton } from '@/modules/shared/components/ui/skeleton';
import { Switch } from '@/modules/shared/components/ui/switch';
import { cn } from '@/modules/shared/lib/utils';
import { InlinePageSearch } from '@/modules/shared/components/layout/InlinePageSearch';
import { useProjects, useCurrentUser, useUsers, useProjectStats } from '@/modules/projects/hooks/queries';
import { canAccess } from '@/modules/projects/lib/permissions';
import type {
  Project,
  ProjectFilters,
  HealthStatus,
  Phase,
} from '@/modules/projects/types/project';
import type { User } from '@/modules/shared/types/user';
import { getTeamForProject } from '@/modules/projects/mock/index';
import { StatsBar } from '@/modules/projects/components/dashboard/StatsBar';
import { ProjectCard } from '@/modules/projects/components/dashboard/ProjectCard';
import { SupervisorRollUp } from '@/modules/projects/components/dashboard/SupervisorRollUp';
import { JobSetupWizard } from '@/modules/projects/components/setup/JobSetupWizard';
import { GanttChart } from '@/modules/projects/components/dashboard/GanttChart';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MAP_DEBUG_KEY = 'toolbox:debug-map';
const DESKTOP_MAP_BREAKPOINT = 1024;
const MAP_BOTTOM_GUTTER = 16;

interface ProjectDashboardMapProps {
  projects: Project[];
  onProjectClick: (id: string) => void;
  height?: number | string;
}

const ProjectDashboardMap = dynamic<ProjectDashboardMapProps>(
  () =>
    import('@/modules/projects/components/dashboard/MapboxMap').then(
      (mod) => mod.MapboxMap,
    ),
  {
    ssr: false,
    loading: ProjectMapFallback,
  },
);

function ProjectMapFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/20 p-6">
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
    </div>
  );
}

function isProjectMapDebugEnabled(): boolean {
  void MAP_DEBUG_KEY;
  return true;
}

function projectMapDebug(event: string, details?: Record<string, unknown>) {
  if (isProjectMapDebugEnabled()) {
    console.warn(`[ProjectsMap] ${event}`, details ?? {});
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProjectDashboard() {
  const router = useRouter();
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const { data: usersData } = useUsers();
  const users: User[] = usersData ?? [];
  const [wizardOpen, setWizardOpen] = useState(false);
  const pmUsers = users.filter((u) => u.role.name === 'pm' && u.is_active);
  const superUsers = users.filter((u) => u.role.name === 'superintendent' && u.is_active);

  // ── Filter state ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pmFilter, setPmFilter] = useState('');
  const [superFilter, setSuperFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<number[]>([]);
  const [healthFilter, setHealthFilter] = useState<HealthStatus | ''>('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [sort, setSort] = useState<'name' | 'job_number' | 'phase' | 'date'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [view, setView] = useState<'grid' | 'gantt'>('grid');
  const [mapHeight, setMapHeight] = useState<number | null>(null);

  // ── Map collapse ────────────────────────────────────────────────────────────
  const [mapCollapsed, setMapCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? localStorage.getItem('projects-map-collapsed') === 'true'
      : false,
  );

  function toggleMap() {
    const next = !mapCollapsed;
    setMapCollapsed(next);
    localStorage.setItem('projects-map-collapsed', String(next));
  }

  // ── Debounce search ─────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Filters object ──────────────────────────────────────────────────────────
  const filters: ProjectFilters = {
    search: debouncedSearch || undefined,
    pm: pmFilter || undefined,
    superintendent: superFilter || undefined,
    phase: phaseFilter.length > 0 ? (phaseFilter as Phase[]) : undefined,
    health: healthFilter || undefined,
    showCompleted,
    sort,
    sortDir,
  };

  // ── Data fetch ──────────────────────────────────────────────────────────────
  const { data: raw, isLoading } = useProjects(filters);
  const projects: Project[] = raw?.data ?? [];

  useEffect(() => {
    projectMapDebug('dashboard state', {
      mapCollapsed,
      mapMounted: !mapCollapsed,
      projectCount: projects.length,
      tokenPresent: Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN),
      tokenLength: process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.length ?? 0,
      viewport: typeof window === 'undefined'
        ? null
        : { width: window.innerWidth, height: window.innerHeight },
    });
  }, [mapCollapsed, projects.length]);

  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role.name === 'admin';
  const isSuperintendent = currentUser?.role.name === 'superintendent';

  // suppress unused-var warning until feature is used
  void isAdmin;

  // Auto-set superintendent filter for supers so they only see their projects by default
  useEffect(() => {
    if (isSuperintendent && currentUser && !superFilter) {
      setSuperFilter(currentUser.id);
    }
    // Only run on mount / when currentUser resolves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, isSuperintendent]);

  // ── Reset ───────────────────────────────────────────────────────────────────
  function resetFilters() {
    setSearch('');
    setDebouncedSearch('');
    setPmFilter('');
    setSuperFilter('');
    setPhaseFilter([]);
    setHealthFilter('');
    setShowCompleted(false);
    setSort('name');
    setSortDir('asc');
  }

  const hasActiveFilter =
    !!search ||
    !!pmFilter ||
    !!superFilter ||
    phaseFilter.length > 0 ||
    !!healthFilter ||
    showCompleted;

  const { data: statsData } = useProjectStats();

  useEffect(() => {
    if (mapCollapsed) {
      setMapHeight(null);
      return;
    }

    let frameId = 0;
    const timeoutIds: number[] = [];

    const measureMapHeight = () => {
      if (window.innerWidth < DESKTOP_MAP_BREAKPOINT) {
        setMapHeight(null);
        return;
      }

      const panel = mapPanelRef.current;
      if (!panel) {
        return;
      }

      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const panelTop = panel.getBoundingClientRect().top;
      const nextHeight = Math.max(350, Math.floor(viewportHeight - panelTop - MAP_BOTTOM_GUTTER));

      setMapHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
      projectMapDebug('map panel height measured', {
        viewportHeight,
        panelTop,
        nextHeight,
      });
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(measureMapHeight);
    };

    scheduleMeasure();
    timeoutIds.push(window.setTimeout(scheduleMeasure, 100));
    timeoutIds.push(window.setTimeout(scheduleMeasure, 500));
    timeoutIds.push(window.setTimeout(scheduleMeasure, 1000));

    window.addEventListener('resize', scheduleMeasure);
    window.visualViewport?.addEventListener('resize', scheduleMeasure);

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasure);

    if (resizeObserver) {
      resizeObserver.observe(document.body);
      if (mapPanelRef.current?.parentElement) {
        resizeObserver.observe(mapPanelRef.current.parentElement);
      }
    }

    return () => {
      cancelAnimationFrame(frameId);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      window.removeEventListener('resize', scheduleMeasure);
      window.visualViewport?.removeEventListener('resize', scheduleMeasure);
      resizeObserver?.disconnect();
    };
  }, [currentUser?.id, mapCollapsed, projects.length, statsData]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex flex-col gap-4 p-4">
        {/* ── Action strip — primary CTA ──────────────────────────────────── */}
        {!!currentUser && (canAccess(currentUser, null, 'create') || canAccess(currentUser, null, 'approve')) && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-xl border border-primary/15 bg-gradient-to-r from-primary/[0.04] to-transparent px-4 sm:px-5 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Quick Actions</p>
              <p className="text-xs text-muted-foreground">Create a new project or review pending approvals</p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-9 flex-1 sm:flex-initial"
                onClick={() => router.push('/projects/closeouts')}
              >
                <ClipboardCheck className="h-4 w-4 mr-1.5" />
                Closeout Tracker
              </Button>
              {canAccess(currentUser, null, 'approve') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 flex-1 sm:flex-initial"
                  onClick={() => router.push('/projects/pending')}
                >
                  <ClipboardList className="h-4 w-4 mr-1.5" />
                  Pending Approval
                </Button>
              )}
              {canAccess(currentUser, null, 'create') && (
                <Button size="sm" className="h-9 flex-1 sm:flex-initial" onClick={() => setWizardOpen(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  New Project
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Hero row: Map (left) + KPI tiles (right) ───────────────────────── */}
        <div>
          <button
            type="button"
            onClick={toggleMap}
            className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-transparent border-0 cursor-pointer hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            {mapCollapsed ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
            {mapCollapsed ? 'Show map' : 'Hide map'}
          </button>

          {!mapCollapsed && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
              {/* Map — fills left column, stretches to match tile height */}
              <div
                ref={mapPanelRef}
                className="h-[350px] rounded-lg overflow-hidden border border-border lg:h-[calc(100dvh-10rem)]"
                style={mapHeight === null ? undefined : { height: mapHeight }}
              >
                <ProjectDashboardMap
                  projects={projects}
                  onProjectClick={(id) => router.push('/projects/' + id)}
                  height={mapHeight ?? '100%'}
                />
              </div>

              {/* Stacked KPI tiles — right column */}
              <StatsBar isSuperintendent={isSuperintendent} layout="stack" />
            </div>
          )}
        </div>

        {/* ── Controls bar ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 items-center">
        <InlinePageSearch
          ariaLabel="Search projects"
          className="min-w-[220px] flex-1 sm:max-w-sm"
          onValueChange={setSearch}
          placeholder="Search projects..."
          value={search}
        />
        {/* PM filter */}
        {!isSuperintendent && (
        <Select value={pmFilter || '__all__'} onValueChange={(v) => setPmFilter(v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All PMs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All PMs</SelectItem>
            {pmUsers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        )}

        {/* Super filter */}
        <Select value={superFilter || '__all__'} onValueChange={(v) => setSuperFilter(v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Supers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Supers</SelectItem>
            {superUsers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Phase filter */}
        <Select
          value={phaseFilter[0]?.toString() ?? '__all__'}
          onValueChange={(v) => setPhaseFilter(v === '__all__' ? [] : [parseInt(v, 10)])}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Phases" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Phases</SelectItem>
            {([1, 2, 3, 4] as Phase[]).map((p) => {
              const phaseLabel = ['Job Setup', 'Execution', 'Close Out', 'Complete'][p - 1];
              return (
                <SelectItem key={p} value={p.toString()}>
                  {phaseLabel}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* Health filter */}
        <Select value={healthFilter || '__all__'} onValueChange={(v) => setHealthFilter(v === '__all__' ? '' : v as HealthStatus | '')}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="All Health" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Health</SelectItem>
            <SelectItem value="green">Green</SelectItem>
            <SelectItem value="yellow">Yellow</SelectItem>
            <SelectItem value="red">Red</SelectItem>
          </SelectContent>
        </Select>

        {/* Show completed toggle */}
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <Switch checked={showCompleted} onCheckedChange={setShowCompleted} />
          Show completed
        </label>

        {/* Sort */}
        <Select value={sort} onValueChange={(v) => setSort(v as 'name' | 'job_number' | 'phase' | 'date')}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name (A-Z)</SelectItem>
            <SelectItem value="job_number">Job Number</SelectItem>
            <SelectItem value="phase">Phase</SelectItem>
            <SelectItem value="date">Date created</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          aria-label="Toggle sort direction"
        >
          {sortDir === 'asc' ? (
            <ArrowUp className="h-4 w-4" />
          ) : (
            <ArrowDown className="h-4 w-4" />
          )}
        </Button>

        {/* Reset */}
        {hasActiveFilter && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Reset
          </Button>
        )}
      </div>

      {/* ── Projects section header ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-2">
        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground tracking-wide uppercase">
          Projects
        </h2>
        {!isLoading && (
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full tabular-nums">
            {projects.length}
          </span>
        )}

        {/* View toggle */}
        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
          <button
            onClick={() => setView('grid')}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-[background-color,color,box-shadow]',
              view === 'grid'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Grid</span>
          </button>
          <button
            onClick={() => setView('gantt')}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-[background-color,color,box-shadow]',
              view === 'gantt'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label="Timeline view"
          >
            <GanttIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Timeline</span>
          </button>
        </div>
      </div>

      {/* Card grid or Gantt timeline */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} style={{ animation: 'card-enter 0.4s ease-out both', animationDelay: `${i * 60}ms` }}>
              <CardContent className="h-48">
                <Skeleton className="h-full w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <FolderOpen className="h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">No projects match your filters.</p>
          <Button variant="outline" size="sm" onClick={resetFilters}>
            Reset filters
          </Button>
        </div>
      ) : view === 'gantt' ? (
        <GanttChart
          projects={projects}
          teamMembers={Object.fromEntries(projects.map((p) => [p.id, getTeamForProject(p.id)]))}
          users={users}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project, i) => (
            <ProjectCard
              key={project.id}
              project={project}
              teamMembers={getTeamForProject(project.id)}
              users={users}
              index={i}
            />
          ))}
        </div>
      )}

      {/* ── Superintendent summary section header ──────────────────────── */}
      <div className="flex items-center gap-2 pt-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground tracking-wide uppercase">
          Superintendent Summary
        </h2>
      </div>

      {/* Supervisor Roll-Up */}
      <SupervisorRollUp />
      </div>

      {/* Job Setup Wizard Modal */}
      <JobSetupWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
