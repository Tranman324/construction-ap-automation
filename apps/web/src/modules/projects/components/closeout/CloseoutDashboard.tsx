'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/modules/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/shared/components/ui/select';
import { Search, CheckCircle2, Clock, Pause, Link2, Link2Off } from 'lucide-react';
import { useCloseoutProjects, useUsers } from '@/modules/projects/hooks/queries';
import type { CloseoutFilters, CloseoutProject } from '@/modules/projects/types/closeout';
import { projectCompletionPct } from '@/modules/projects/lib/closeoutHelpers';
import { CloseoutProjectCard } from './CloseoutProjectCard';

export function CloseoutDashboard() {
  const [search, setSearch] = useState('');
  const [pmFilter, setPmFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filters: CloseoutFilters = {
    search: search || undefined,
    pmId: pmFilter !== 'all' ? pmFilter : undefined,
    status: statusFilter !== 'all' ? (statusFilter as CloseoutFilters['status']) : undefined,
    sortBy: 'jobNumber',
    sortDir: 'asc',
  };

  const { data: projects = [] } = useCloseoutProjects(filters);
  const { data: users } = useUsers();
  const pms = users?.filter((u) => u.role.name === 'pm') ?? [];

  const activeCount = projects.filter((p: CloseoutProject) => p.status === 'active').length;
  const completeCount = projects.filter((p: CloseoutProject) => p.status === 'complete').length;
  const holdCount = projects.filter((p: CloseoutProject) => p.status === 'hold').length;
  const avgPct = projects.length > 0
    ? Math.round(projects.reduce((s: number, p: CloseoutProject) => s + projectCompletionPct(p), 0) / projects.length)
    : 0;

  // Group projects: linked (have a real project) vs unlinked
  const { linked, unlinked } = useMemo(() => {
    const linked: CloseoutProject[] = [];
    const unlinked: CloseoutProject[] = [];
    for (const p of projects) {
      if (p.projectId) linked.push(p);
      else unlinked.push(p);
    }
    return { linked, unlinked };
  }, [projects]);

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">Closeout Tracker</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{projects.length} projects &middot; {avgPct}% avg completion</p>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
          <Clock className="h-3 w-3 text-blue-500" />
          <span className="font-medium text-foreground">{activeCount}</span>
          <span className="text-muted-foreground">Active</span>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          <span className="font-medium text-foreground">{completeCount}</span>
          <span className="text-muted-foreground">Complete</span>
        </div>
        {holdCount > 0 && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
            <Pause className="h-3 w-3 text-amber-500" />
            <span className="font-medium text-foreground">{holdCount}</span>
            <span className="text-muted-foreground">On Hold</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search job # or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={pmFilter} onValueChange={setPmFilter}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="All PMs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All PMs</SelectItem>
            {pms.map((u: { id: string; name: string }) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
            <SelectItem value="hold">On Hold</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No closeout projects match your filters.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Linked projects — can navigate to detail */}
          {linked.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-muted-foreground tracking-wide uppercase">
                  Active Projects
                </h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full tabular-nums">
                  {linked.length}
                </span>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {linked.map((project: CloseoutProject, i: number) => (
                  <CloseoutProjectCard key={project.id} project={project} index={i} />
                ))}
              </div>
            </section>
          )}

          {/* Unlinked projects — no project detail page */}
          {unlinked.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Link2Off className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-muted-foreground tracking-wide uppercase">
                  Unlinked
                </h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full tabular-nums">
                  {unlinked.length}
                </span>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {unlinked.map((project: CloseoutProject, i: number) => (
                  <CloseoutProjectCard key={project.id} project={project} index={linked.length + i} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
