'use client';

import {
  Building2,
  AlertTriangle,
  ClipboardCheck,
  ListChecks,
  Hourglass,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent } from '@/modules/shared/components/ui/card';
import { Skeleton } from '@/modules/shared/components/ui/skeleton';
import { StatGrid, MetricCard } from '@/modules/shared/components/patterns';
import { useProjectStats } from '@/modules/projects/hooks/queries';

interface StatsBarProps {
  isSuperintendent?: boolean;
  layout?: 'grid' | 'stack';
}

export function StatsBar({ isSuperintendent = false, layout = 'grid' }: StatsBarProps) {
  const { data, isLoading } = useProjectStats();

  if (isLoading) {
    return (
      <div
        className={
          layout === 'stack'
            ? 'flex flex-col gap-3'
            : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'
        }
      >
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const pendingApproval = data?.pendingApproval ?? 0;
  const needsAttention = data?.needsAttention ?? 0;
  const closeouts = data?.closeoutsInProgress ?? 0;
  const pending = data?.checklistsPending ?? 0;
  const qualityIssues =
    (data?.qualityChecksOverdue ?? 0) + (data?.qualityOpenActions ?? 0);

  const completionPct =
    (data?.checklistsTotal ?? 0) > 0
      ? Math.round(
          (((data?.checklistsTotal ?? 0) - (data?.checklistsPending ?? 0)) /
            (data?.checklistsTotal ?? 1)) *
            100,
        )
      : 100;

  const isStack = layout === 'stack';
  const cardClass = isStack ? 'flex-1' : undefined;

  const cards = (
    <>
      {/* Active Projects (admin) or Checklist Completion (superintendent) */}
      {isSuperintendent ? (
        <MetricCard
          label="Checklist Completion"
          value={`${completionPct}%`}
          icon={ListChecks}
          className={cardClass}
        />
      ) : (
        <MetricCard
          label="Active Projects"
          value={data?.activeProjects ?? 0}
          icon={Building2}
          className={cardClass}
        />
      )}

      {/* Pending Approval — navigates to /projects/pending */}
      <MetricCard
        label="Pending Approval"
        value={pendingApproval}
        icon={Hourglass}
        tone="cyan"
        active={pendingApproval > 0}
        href="/projects/pending"
        className={cardClass}
      />

      {/* Needs Attention */}
      <MetricCard
        label="Needs Attention"
        value={needsAttention}
        icon={AlertTriangle}
        tone="red"
        active={needsAttention > 0}
        pulsing
        className={cardClass}
      />

      {/* Closeouts In Progress */}
      <MetricCard
        label="Closeouts In Progress"
        value={closeouts}
        icon={ClipboardCheck}
        tone="amber"
        active={closeouts > 0}
        className={cardClass}
      />

      {/* Field Checklists Pending */}
      <MetricCard
        label="Field Checklists Pending"
        value={pending}
        icon={ListChecks}
        tone="orange"
        active={pending > 0}
        className={cardClass}
      />

      {/* QC Open Items */}
      <MetricCard
        label="QC Open Items"
        value={qualityIssues}
        icon={ShieldCheck}
        tone="violet"
        active={qualityIssues > 0}
        className={cardClass}
      />
    </>
  );

  if (isStack) {
    return <div className="flex flex-col gap-3 h-full">{cards}</div>;
  }

  return (
    <StatGrid cols={6}>
      {cards}
    </StatGrid>
  );
}
