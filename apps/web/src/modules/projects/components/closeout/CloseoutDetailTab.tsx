'use client';

import { cn } from '@/modules/shared/lib/utils';
import { Badge } from '@/modules/shared/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/shared/components/ui/select';
import { useCloseoutForLinkedProject, useUsers } from '@/modules/projects/hooks/queries';
import {
  useToggleGeneralItem,
  useUpdateTradeDocStatus,
  useToggleLienWaiver,
  useAddLienWaiver,
  useRemoveLienWaiver,
  useUpdateCloseoutStatus,
} from '@/modules/projects/hooks/mutations';
import { projectCompletionPct } from '@/modules/projects/lib/closeoutHelpers';
import type { DocField, DocStatus, CloseoutProjectStatus } from '@/modules/projects/types/closeout';
import { CompletionRing } from './CompletionRing';
import { GeneralChecklist } from './GeneralChecklist';
import { TradeAccordion } from './TradeAccordion';
import { LienWaiverTable } from './LienWaiverTable';

interface CloseoutDetailTabProps {
  projectId: string;
}

export function CloseoutDetailTab({ projectId }: CloseoutDetailTabProps) {
  const { data: closeout } = useCloseoutForLinkedProject(projectId);
  const { data: users } = useUsers();

  const toggleGeneral = useToggleGeneralItem();
  const updateDoc = useUpdateTradeDocStatus();
  const toggleLW = useToggleLienWaiver();
  const addLW = useAddLienWaiver();
  const removeLW = useRemoveLienWaiver();
  const updateStatus = useUpdateCloseoutStatus();

  if (!closeout) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
        <p className="text-sm text-muted-foreground mb-1">No closeout tracker linked to this project.</p>
        <p className="text-xs text-muted-foreground">Create one from the Closeout Dashboard.</p>
      </div>
    );
  }

  const pct = projectCompletionPct(closeout);
  const pm = users?.find((u: { id: string }) => u.id === closeout.pmId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <CompletionRing percent={pct} size={56} strokeWidth={4} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{closeout.jobNumber}</span>
            <Badge variant={closeout.status === 'complete' ? 'default' : 'secondary'} className="text-[9px] px-1.5 py-0">
              {closeout.status}
            </Badge>
          </div>
          <h2 className="text-base font-semibold">{closeout.jobName}</h2>
          {pm && <p className="text-xs text-muted-foreground">PM: {pm.name}</p>}
        </div>
        <Select
          value={closeout.status}
          onValueChange={(val) => updateStatus.mutate({ closeoutId: closeout.id, status: val as CloseoutProjectStatus })}
        >
          <SelectTrigger className="h-7 w-[110px] text-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Two-column layout */}
      <div className={cn('grid gap-6', closeout.trades.length > 3 ? 'lg:grid-cols-[1fr_1fr]' : 'lg:grid-cols-[280px_1fr]')}>
        {/* Left: General + Lien Waivers */}
        <div className="space-y-6">
          <GeneralChecklist
            checklist={closeout.generalChecklist}
            onToggle={(key) => toggleGeneral.mutate({ closeoutId: closeout.id, key })}
          />
          <LienWaiverTable
            waivers={closeout.lienWaivers}
            onToggle={(id) => toggleLW.mutate({ closeoutId: closeout.id, lienWaiverId: id })}
            onAdd={(name) => addLW.mutate({ closeoutId: closeout.id, subcontractorName: name })}
            onRemove={(id) => removeLW.mutate({ closeoutId: closeout.id, lienWaiverId: id })}
          />
        </div>

        {/* Right: Trade Accordion */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Trade Documents</h4>
          <TradeAccordion
            trades={closeout.trades}
            onStatusChange={(tcId, field, newStatus) =>
              updateDoc.mutate({
                closeoutId: closeout.id,
                tradeCloseoutId: tcId,
                field: field as DocField,
                status: newStatus as DocStatus,
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
