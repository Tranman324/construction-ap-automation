'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  startOfQuarter,
  addMonths,
  subMonths,
  eachMonthOfInterval,
  differenceInCalendarDays,
  format,
  max as dateMax,
  min as dateMin,
  isWithinInterval,
  startOfMonth,
  endOfMonth,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Waves,
  UserMinus,
  Check,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/modules/shared/components/ui/button';
import { Switch } from '@/modules/shared/components/ui/switch';
import { Card } from '@/modules/shared/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/shared/components/ui/tooltip';
import { cn } from '@/modules/shared/lib/utils';
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import { type Project, type ProjectTeamMember } from '@/modules/projects/types/project';
import type { User } from '@/modules/shared/types/user';
import type { HealthStatus } from '@/modules/projects/types/project';
import { getProjectHealth } from '@/modules/projects/mock/index';
import { useAssignSuperintendent, useRemoveSuperintendent } from '@/modules/projects/hooks/mutations';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GanttChartProps {
  projects: Project[];
  teamMembers: Record<string, ProjectTeamMember[]>;
  users: User[];
}

interface GanttRow {
  project: Project;
  superintendent: User | null;
}

interface ContextMenuState {
  x: number;
  y: number;
  projectId: string;
  projectName: string;
  currentSuper: User | null;
  /** All superintendent team-member entries for this project */
  superMembers: ProjectTeamMember[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 56;
const SWIM_LANE_HEADER = 32;
const MIN_DAY_WIDTH = 3;
const MAX_DAY_WIDTH = 20;
const ZOOM_LEVELS = [3, 5, 8, 12, 20] as const;
const LABEL_COL_WIDTH = 220;

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  active:             { bg: 'bg-primary',    border: 'border-primary',    text: 'Active' },
  pending_approval:   { bg: 'bg-amber-400',  border: 'border-amber-500',  text: 'Pending' },
  completed:          { bg: 'bg-emerald-500',border: 'border-emerald-600',text: 'Completed' },
};

/** Determine how many months to show based on viewport width */
function getSpanMonths(): number {
  if (typeof window === 'undefined') return 3;
  const w = window.innerWidth;
  if (w < 768) return 3;       // mobile → 1 quarter
  if (w < 1280) return 6;      // tablet/laptop → 6 months
  return 9;                    // large desktop → 9 months
}

const PHASE_LABELS: Record<number, string> = {
  1: 'Job Setup',
  2: 'Execution',
  3: 'Close Out',
  4: 'Complete',
};

const HEALTH_DOT: Record<HealthStatus, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getViewLabel(start: Date, end: Date): string {
  const s = format(start, 'MMM yyyy');
  const e = format(end, 'MMM yyyy');
  return `${s} — ${e}`;
}

function getSuperintendent(
  projectId: string,
  teamMembers: Record<string, ProjectTeamMember[]>,
  users: User[],
): User | null {
  const members = teamMembers[projectId] ?? [];
  const superMember = members.find((m) => m.role === 'superintendent' && m.is_primary);
  if (!superMember) return null;
  return users.find((u) => u.id === superMember.user_id) ?? null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GanttChart({ projects, teamMembers, users }: GanttChartProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Mutations
  const assignSuper = useAssignSuperintendent();
  const removeSuper = useRemoveSuperintendent();

  // Superintendent-eligible users for context menu
  const superUsers = useMemo(
    () => users.filter((u) => u.role.name === 'superintendent' && u.is_active),
    [users],
  );

  // State
  const [zoomIdx, setZoomIdx] = useState(2); // default 8px/day
  const [showSwimLanes, setShowSwimLanes] = useState(false);
  const [spanMonths, setSpanMonths] = useState(getSpanMonths);
  const [viewStart, setViewStart] = useState<Date>(() => startOfQuarter(new Date()));
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const dayWidth = ZOOM_LEVELS[zoomIdx];

  // Close context menu on click outside or scroll
  useEffect(() => {
    if (!contextMenu) return;
    function handleClose() { setContextMenu(null); }
    document.addEventListener('click', handleClose);
    document.addEventListener('scroll', handleClose, true);
    return () => {
      document.removeEventListener('click', handleClose);
      document.removeEventListener('scroll', handleClose, true);
    };
  }, [contextMenu]);

  // Responsive: adjust span when window resizes
  useEffect(() => {
    function onResize() { setSpanMonths(getSpanMonths()); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // View window spans `spanMonths` from viewStart
  const viewEnd = useMemo(
    () => endOfMonth(addMonths(viewStart, spanMonths - 1)),
    [viewStart, spanMonths],
  );
  const totalDays = differenceInCalendarDays(viewEnd, viewStart) + 1;
  const chartWidth = totalDays * dayWidth;

  // Month columns for the header
  const months = useMemo(
    () => eachMonthOfInterval({ start: viewStart, end: viewEnd }),
    [viewStart, viewEnd],
  );

  // Build rows with superintendent
  const rows: GanttRow[] = useMemo(() => {
    return projects.map((project) => ({
      project,
      superintendent: getSuperintendent(project.id, teamMembers, users),
    }));
  }, [projects, teamMembers, users]);

  // Group by superintendent for swim lanes
  const swimLanes = useMemo(() => {
    if (!showSwimLanes) return null;
    const map = new Map<string, { super: User | null; rows: GanttRow[] }>();
    for (const row of rows) {
      const key = row.superintendent?.id ?? '__unassigned__';
      if (!map.has(key)) {
        map.set(key, { super: row.superintendent, rows: [] });
      }
      map.get(key)!.rows.push(row);
    }
    // Sort: assigned supers alphabetically, unassigned last
    return Array.from(map.values()).sort((a, b) => {
      if (!a.super) return 1;
      if (!b.super) return -1;
      return a.super.name.localeCompare(b.super.name);
    });
  }, [rows, showSwimLanes]);

  // Today marker position
  const today = new Date();
  const todayOffset = differenceInCalendarDays(today, viewStart);
  const showTodayMarker = todayOffset >= 0 && todayOffset <= totalDays;

  // Navigation — shift by the current span
  const shiftBack = useCallback(() => setViewStart((d) => startOfMonth(subMonths(d, spanMonths))), [spanMonths]);
  const shiftForward = useCallback(() => setViewStart((d) => startOfMonth(addMonths(d, spanMonths))), [spanMonths]);
  const goToToday = useCallback(() => setViewStart(startOfQuarter(new Date())), []);
  const zoomIn = useCallback(() => setZoomIdx((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1)), []);
  const zoomOut = useCallback(() => setZoomIdx((i) => Math.max(i - 1, 0)), []);

  // Bar renderer
  function renderBar(row: GanttRow, rowIndex: number) {
    const { project } = row;
    const start = new Date(project.start_date);
    const end = new Date(project.end_date);
    const projected = project.projected_end_date ? new Date(project.projected_end_date) : null;

    const barStart = dateMax([start, viewStart]);
    const barEnd = dateMin([end, viewEnd]);

    const startOffset = differenceInCalendarDays(barStart, viewStart);
    const barDays = differenceInCalendarDays(barEnd, barStart) + 1;

    // Skip if bar isn't in view at all
    const startsInView = isWithinInterval(start, { start: viewStart, end: viewEnd }) ||
                         isWithinInterval(end, { start: viewStart, end: viewEnd }) ||
                         (start <= viewStart && end >= viewEnd);
    if (!startsInView) return null;

    const barLeft = startOffset * dayWidth;
    const barWidth = Math.max(barDays * dayWidth, 4);

    // Overrun extension (dashed red)
    let overrunWidth = 0;
    if (projected && projected > end) {
      const overrunEnd = dateMin([projected, viewEnd]);
      const overrunDays = differenceInCalendarDays(overrunEnd, end);
      overrunWidth = overrunDays * dayWidth;
    }

    const statusStyle = STATUS_COLORS[project.status] ?? STATUS_COLORS.active;
    const { health, flagCount } = getProjectHealth(project);

    return (
      <div
        key={project.id}
        className="absolute flex items-center"
        style={{
          top: rowIndex * ROW_HEIGHT,
          left: barLeft,
          height: ROW_HEIGHT,
        }}
      >
        {/* Superintendent avatar pinned to start of bar (flat view only) */}
        {!showSwimLanes && row.superintendent && (
          <div className="shrink-0 -mr-1 z-[1]">
            <UserAvatar user={{ name: row.superintendent.name, image: row.superintendent.avatar_url }} size="sm" />
          </div>
        )}

        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push(`/projects/${project.id}`)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const members = teamMembers[project.id] ?? [];
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    projectId: project.id,
                    projectName: `${project.job_number} ${project.job_name}`,
                    currentSuper: row.superintendent,
                    superMembers: members.filter((m) => m.role === 'superintendent'),
                  });
                }}
                className={cn(
                  'h-6 rounded-md border cursor-pointer transition-[filter,box-shadow] hover:brightness-110 hover:shadow-md',
                  statusStyle.bg,
                  statusStyle.border,
                )}
                style={{ width: barWidth, minWidth: 4 }}
                aria-label={`${project.job_number} ${project.job_name}`}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium">{project.job_number}</span>
                  <span className="font-semibold text-sm">{project.job_name}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Status</span>
                  <span>{statusStyle.text}</span>
                  <span className="text-muted-foreground">Phase</span>
                  <span>{PHASE_LABELS[project.phase] ?? project.phase}</span>
                  <span className="text-muted-foreground">Health</span>
                  <span className="flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 rounded-full', HEALTH_DOT[health])} />
                    {health}{flagCount > 0 && ` (${flagCount} flag${flagCount > 1 ? 's' : ''})`}
                  </span>
                  <span className="text-muted-foreground">Start</span>
                  <span>{format(start, 'MMM d, yyyy')}</span>
                  <span className="text-muted-foreground">End</span>
                  <span>{format(end, 'MMM d, yyyy')}</span>
                  {projected && projected > end && (
                    <>
                      <span className="text-muted-foreground">Projected</span>
                      <span className="text-red-500 font-medium">{format(projected, 'MMM d, yyyy')}</span>
                    </>
                  )}
                  {row.superintendent && (
                    <>
                      <span className="text-muted-foreground">Super</span>
                      <span>{row.superintendent.name}</span>
                    </>
                  )}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Overrun extension — dashed red */}
        {overrunWidth > 0 && (
          <div
            className="h-6 border-t-2 border-b-2 border-r-2 border-dashed border-red-500 rounded-r-md bg-red-500/10"
            style={{ width: overrunWidth }}
          />
        )}
      </div>
    );
  }

  // Label renderer
  function renderLabel(row: GanttRow, rowIndex: number) {
    const { project } = row;
    return (
      <div
        key={project.id}
        className="flex items-center gap-2 px-3 border-b border-border/50 cursor-pointer hover:bg-muted/40 transition-colors"
        style={{ height: ROW_HEIGHT }}
        onClick={() => router.push(`/projects/${project.id}`)}
      >
        <span className="font-mono text-[11px] text-muted-foreground shrink-0 w-12 tabular-nums">
          {project.job_number}
        </span>
        <span className="text-sm font-medium truncate flex-1">{project.job_name}</span>
      </div>
    );
  }

  // Render flat rows or swim lanes
  function renderRows() {
    if (swimLanes) {
      let globalIdx = 0;
      return swimLanes.map((lane) => {
        const laneRows = lane.rows;
        const startIdx = globalIdx;
        globalIdx += laneRows.length;
        return (
          <div key={lane.super?.id ?? 'unassigned'}>
            {/* Swim lane header */}
            <div
              className="sticky left-0 z-[2] flex items-center gap-2 px-3 bg-muted/60 border-y border-border/50"
              style={{ height: SWIM_LANE_HEADER }}
            >
              <Waves className="h-3.5 w-3.5 text-muted-foreground" />
              {lane.super ? (
                <div className="flex items-center gap-2">
                  <UserAvatar user={{ name: lane.super.name, image: lane.super.avatar_url }} size="sm" />
                  <span className="text-xs font-semibold">{lane.super.name}</span>
                </div>
              ) : (
                <span className="text-xs font-semibold text-muted-foreground">Unassigned</span>
              )}
              <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                {laneRows.length} project{laneRows.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Labels + bars side by side */}
            <div className="flex">
              {/* Labels column */}
              <div className="shrink-0" style={{ width: LABEL_COL_WIDTH }}>
                {laneRows.map((row, i) => renderLabel(row, startIdx + i))}
              </div>
              {/* Chart area */}
              <div className="relative flex-1 overflow-hidden" style={{ height: laneRows.length * ROW_HEIGHT }}>
                {/* Row grid lines */}
                {laneRows.map((_, i) => (
                  <div
                    key={i}
                    className="absolute w-full border-b border-border/30"
                    style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                  />
                ))}
                {laneRows.map((row, i) => renderBar(row, i))}
              </div>
            </div>
          </div>
        );
      });
    }

    // Flat view
    return (
      <div className="flex">
        {/* Labels column */}
        <div className="shrink-0" style={{ width: LABEL_COL_WIDTH }}>
          {rows.map((row, i) => renderLabel(row, i))}
        </div>
        {/* Chart area */}
        <div className="relative flex-1 overflow-hidden" style={{ height: rows.length * ROW_HEIGHT }}>
          {/* Row grid lines */}
          {rows.map((_, i) => (
            <div
              key={i}
              className="absolute w-full border-b border-border/30"
              style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
            />
          ))}
          {rows.map((row, i) => renderBar(row, i))}
        </div>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden animate-in fade-in duration-300">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          {/* Quarter navigation */}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={shiftBack} aria-label="Previous quarter">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <button
            onClick={goToToday}
            className="text-sm font-semibold px-2 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
          >
            {getViewLabel(viewStart, viewEnd)}
          </button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={shiftForward} aria-label="Next quarter">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>

          <div className="h-4 w-px bg-border mx-1" />

          {/* Zoom */}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomOut} disabled={zoomIdx === 0} aria-label="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomIn} disabled={zoomIdx === ZOOM_LEVELS.length - 1} aria-label="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Swim lane toggle */}
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <Switch checked={showSwimLanes} onCheckedChange={setShowSwimLanes} />
          <Waves className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="hidden sm:inline text-xs text-muted-foreground">Swim Lanes</span>
        </label>
      </div>

      {/* Scrollable chart area */}
      <div ref={scrollRef} className="overflow-x-auto">
        <div style={{ minWidth: LABEL_COL_WIDTH + chartWidth }}>
          {/* Month header */}
          <div className="flex sticky top-0 z-[3] bg-card border-b border-border" style={{ height: HEADER_HEIGHT }}>
            {/* Label column header */}
            <div
              className="shrink-0 flex items-end px-3 pb-1.5 border-r border-border"
              style={{ width: LABEL_COL_WIDTH }}
            >
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Project</span>
            </div>

            {/* Month cells */}
            <div className="relative flex-1">
              {months.map((monthDate) => {
                const mStart = dateMax([startOfMonth(monthDate), viewStart]);
                const mEnd = dateMin([endOfMonth(monthDate), viewEnd]);
                const offset = differenceInCalendarDays(mStart, viewStart) * dayWidth;
                const width = (differenceInCalendarDays(mEnd, mStart) + 1) * dayWidth;

                return (
                  <div
                    key={monthDate.toISOString()}
                    className="absolute top-0 flex flex-col justify-end pb-1.5 px-2 border-r border-border/40 h-full"
                    style={{ left: offset, width }}
                  >
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {format(monthDate, 'MMM yyyy')}
                    </span>
                  </div>
                );
              })}

              {/* Today marker header dot */}
              {showTodayMarker && (
                <div
                  className="absolute bottom-0 w-0.5 h-3 bg-red-500 rounded-full"
                  style={{ left: todayOffset * dayWidth }}
                />
              )}
            </div>
          </div>

          {/* Body */}
          <div className="relative">
            {renderRows()}

            {/* Today vertical line — spans full height */}
            {showTodayMarker && (
              <div
                className="absolute top-0 bottom-0 w-px bg-red-500/60 z-[1] pointer-events-none"
                style={{ left: LABEL_COL_WIDTH + todayOffset * dayWidth }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4 px-4 py-2 border-t border-border bg-muted/20 text-[10px] text-muted-foreground">
        {Object.entries(STATUS_COLORS).map(([key, style]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={cn('h-2.5 w-5 rounded-sm', style.bg)} />
            {style.text}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-5 rounded-sm border-2 border-dashed border-red-500 bg-red-500/10" />
          Overrun
        </span>
        <span className="flex items-center gap-1 ml-auto">
          <span className="h-3 w-px bg-red-500" />
          Today
        </span>
      </div>

      {/* Right-click context menu for superintendent management */}
      {contextMenu && (() => {
        const isPrimarySuper = contextMenu.currentSuper
          ? contextMenu.superMembers.some(
              (m) => m.user_id === contextMenu.currentSuper!.id && m.is_primary,
            )
          : false;
        const hasSecondarySupers = contextMenu.superMembers.some((m) => !m.is_primary);

        return (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[240px] rounded-md border border-border bg-popover text-popover-foreground shadow-lg animate-in fade-in zoom-in-95 duration-150"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-border/50">
            <p className="text-xs font-semibold truncate">{contextMenu.projectName}</p>
            <p className="text-[10px] text-muted-foreground">
              {contextMenu.currentSuper
                ? `Primary: ${contextMenu.currentSuper.name}`
                : 'No super assigned'}
            </p>
          </div>

          <div className="py-1 max-h-60 overflow-y-auto">
            <p className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Assign Superintendent
            </p>
            {superUsers.map((u) => {
              const memberEntry = contextMenu.superMembers.find((m) => m.user_id === u.id);
              const isCurrent = contextMenu.currentSuper?.id === u.id;
              const isPrimary = memberEntry?.is_primary === true;
              return (
                <button
                  key={u.id}
                  type="button"
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors cursor-pointer',
                    isCurrent
                      ? 'bg-primary/10 text-foreground'
                      : 'hover:bg-muted',
                  )}
                  onClick={() => {
                    if (!isCurrent) {
                      assignSuper.mutate({ projectId: contextMenu.projectId, userId: u.id });
                    }
                    setContextMenu(null);
                  }}
                >
                  <UserAvatar user={{ name: u.name, image: u.avatar_url }} size="sm" />
                  <span className="truncate flex-1">{u.name}</span>
                  {isPrimary && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                      <ShieldAlert className="h-2.5 w-2.5" />
                      Primary
                    </span>
                  )}
                  {isCurrent && !isPrimary && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>

          {contextMenu.currentSuper && (
            <div className="border-t border-border/50 py-1">
              {isPrimarySuper ? (
                <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground cursor-not-allowed opacity-60">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>Cannot remove primary super</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                  onClick={() => {
                    removeSuper.mutate({ projectId: contextMenu.projectId, userId: contextMenu.currentSuper!.id });
                    setContextMenu(null);
                  }}
                >
                  <UserMinus className="h-3.5 w-3.5" />
                  Remove Superintendent
                </button>
              )}
            </div>
          )}
        </div>
        );
      })()}
    </Card>
  );
}
