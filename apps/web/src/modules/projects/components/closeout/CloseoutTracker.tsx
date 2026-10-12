'use client';

import { useState } from 'react';
import { Upload, ChevronDown, FolderCheck, ArrowUpRight } from 'lucide-react';
import { useProject, useCloseout, useSubcontractors } from '@/modules/projects/hooks/queries';
import { useUpgradeCloseout } from '@/modules/projects/hooks/mutations';
import type { CloseoutItem, CloseoutSubItem, CloseoutStatus } from '@/modules/projects/types/closeout';
import { cn } from '@/modules/shared/lib/utils';
import type { Subcontractor } from '@/modules/projects/types/subcontractor';
import { Badge } from '@/modules/shared/components/ui/badge';
import { Button } from '@/modules/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/modules/shared/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/shared/components/ui/select';
import { Textarea } from '@/modules/shared/components/ui/textarea';

export interface CloseoutTrackerProps {
  projectId: string;
}

const STATUS_LABELS: Record<CloseoutStatus, string> = {
  not_started: 'Not Started',
  requested: 'Requested',
  received: 'Received',
  verified: 'Verified',
};

const STATUS_COLORS: Record<CloseoutStatus, string> = {
  not_started: '',
  requested: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
  received: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
  verified: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
};

function statusVariant(status: CloseoutStatus): 'outline' | 'secondary' | 'default' {
  if (status === 'not_started') return 'outline';
  if (status === 'verified') return 'default';
  return 'secondary';
}

export function CloseoutTracker({ projectId }: CloseoutTrackerProps) {
  const { data: rawProject } = useProject(projectId);
  const project = rawProject ?? null;

  const { data: rawCloseout } = useCloseout(projectId);
  const allItems: CloseoutItem[] = rawCloseout ?? [];

  const { data: rawSubs } = useSubcontractors(projectId);
  const subs: Subcontractor[] = rawSubs ?? [];

  const shortItems = allItems.filter((i) => i.item_category === 'short');
  const fullItems = allItems.filter((i) => i.item_category === 'full');

  const allSubsSigned =
    subs.length > 0 &&
    subs.every((s) => s.subcontract_status === 'signed' || s.subcontract_status === 'active');

  const [localEdits, setLocalEdits] = useState<Record<string, Partial<CloseoutItem>>>({});

  function getItem(item: CloseoutItem): CloseoutItem {
    const merged = { ...item, ...(localEdits[item.id] ?? {}) } as CloseoutItem;
    if (item.item_name === 'Subcontractor List') {
      return { ...merged, status: allSubsSigned ? 'verified' : merged.status };
    }
    return merged;
  }

  function handleStatusChange(itemId: string, status: CloseoutStatus) {
    setLocalEdits((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] ?? {}),
        status,
        received_at:
          status === 'received'
            ? new Date().toISOString()
            : (prev[itemId]?.received_at ?? null),
      },
    }));
  }

  function handleNotesChange(itemId: string, notes: string) {
    setLocalEdits((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? {}), notes },
    }));
  }

  const [expandedSubItems, setExpandedSubItems] = useState<Record<string, boolean>>({});
  function toggleSubExpand(itemId: string) {
    setExpandedSubItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  const [subItemEdits, setSubItemEdits] = useState<Record<string, CloseoutStatus>>({});
  function getSubItemStatus(subItem: CloseoutSubItem): CloseoutStatus {
    return subItemEdits[subItem.id] ?? subItem.status;
  }
  function handleSubItemStatusChange(subItemId: string, status: CloseoutStatus) {
    setSubItemEdits((prev) => ({ ...prev, [subItemId]: status }));
  }

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const upgradeCloseout = useUpgradeCloseout();
  function confirmUpgrade() {
    if (!project) return;
    upgradeCloseout.mutate({ id: project.id, projectId: projectId });
    setUpgradeOpen(false);
  }

  // Progress stats
  const allTrackedItems = [...shortItems, ...fullItems];
  const totalItems = allTrackedItems.length;
  const verifiedCount = allTrackedItems.filter((i) => getItem(i).status === 'verified').length;
  const progressPct = totalItems > 0 ? Math.round((verifiedCount / totalItems) * 100) : 0;

  function renderCloseoutCard(rawItem: CloseoutItem, index: number) {
    const item = getItem(rawItem);
    return (
      <div
        key={item.id}
        className={cn(
          'rounded-xl border overflow-hidden transition-colors',
          item.status === 'verified'
            ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/10'
            : 'border-border bg-card',
        )}
        style={{ animation: `card-enter 0.4s ease-out ${index * 60}ms both` }}
      >
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className={cn(
                'mt-0.5 h-3 w-3 rounded-full shrink-0 ring-2',
                item.status === 'verified' ? 'bg-green-500 ring-green-500/20' :
                item.status === 'received' ? 'bg-blue-500 ring-blue-500/20' :
                item.status === 'requested' ? 'bg-amber-500 ring-amber-500/20' :
                'bg-muted-foreground/30 ring-muted-foreground/10',
              )} />
              <div>
                <p className="text-sm font-medium text-foreground">{item.item_name}</p>
                {(item.status === 'received' || item.status === 'verified') && item.received_at && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Received {new Date(item.received_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant={statusVariant(item.status)}
                className={cn('text-[10px] border', STATUS_COLORS[item.status])}
              >
                {STATUS_LABELS[item.status]}
              </Badge>
              <Select
                value={item.status}
                onValueChange={(val) => handleStatusChange(item.id, val as CloseoutStatus)}
                disabled={item.item_name === 'Subcontractor List'}
              >
                <SelectTrigger className="h-7 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">Not Started</SelectItem>
                  <SelectItem value="requested">Requested</SelectItem>
                  <SelectItem value="received">Received</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 gap-1.5"
              onClick={() => console.log('[STUB] Upload document for', item.item_name)}
            >
              <Upload className="h-3 w-3" />
              {item.document_url ? 'Replace' : 'Upload'}
            </Button>
            {item.document_url && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                <ArrowUpRight className="h-3 w-3" /> Attached
              </span>
            )}
          </div>

          <Textarea
            placeholder="Notes..."
            value={item.notes}
            onChange={(e) => handleNotesChange(item.id, e.target.value)}
            className="text-xs min-h-[52px] resize-none bg-muted/20 dark:bg-muted/10 border-muted focus:ring-1 focus:ring-primary/30"
          />

          {/* Per-sub items */}
          {item.is_per_sub && item.sub_items && item.sub_items.length > 0 && (
            <div>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => toggleSubExpand(item.id)}
              >
                <ChevronDown
                  className={cn(
                    'h-3 w-3 transition-transform duration-200',
                    expandedSubItems[item.id] && 'rotate-180',
                  )}
                />
                {expandedSubItems[item.id] ? 'Hide' : 'Show'} subcontractors ({item.sub_items.length})
              </button>

              {expandedSubItems[item.id] && (
                <div className="mt-2 space-y-1 pl-3 border-l-2 border-primary/30 bg-muted/10 rounded-r-lg py-2">
                  {item.sub_items.map((subItem) => {
                    const subStatus = getSubItemStatus(subItem);
                    const companyName = subs.find((s) => s.id === subItem.subcontractor_id)?.company_name ?? subItem.subcontractor_id;
                    return (
                      <div key={subItem.id} className="flex items-center justify-between gap-2 py-1.5">
                        <p className="text-xs text-foreground">{companyName}</p>
                        <div className="flex items-center gap-2">
                          {subItem.received_at && (
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(subItem.received_at).toLocaleDateString()}
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => console.log('[STUB] Upload for sub', subItem.subcontractor_id)}
                          >
                            <Upload className="h-3 w-3" />
                          </Button>
                          <Select
                            value={subStatus}
                            onValueChange={(val) => handleSubItemStatusChange(subItem.id, val as CloseoutStatus)}
                          >
                            <SelectTrigger className="h-6 w-[100px] text-[10px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="not_started">Not Started</SelectItem>
                              <SelectItem value="requested">Requested</SelectItem>
                              <SelectItem value="received">Received</SelectItem>
                              <SelectItem value="verified">Verified</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress header */}
      {totalItems > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <svg viewBox="0 0 36 36" className="h-14 w-14">
                <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-muted" />
                <circle
                  cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={`${progressPct * 0.974} 100`}
                  transform="rotate(-90 18 18)"
                  className={cn('transition-[stroke,stroke-dasharray] duration-700', progressPct === 100 ? 'stroke-emerald-500' : 'stroke-primary')}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold tabular-nums text-foreground">{progressPct}%</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <FolderCheck className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  {project?.closeout_type === 'full' ? 'Full' : 'Short'} Closeout
                </h3>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {verifiedCount} of {totalItems} items verified
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Short items */}
      {shortItems.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Short Closeout Items
          </h4>
          {shortItems.map(renderCloseoutCard)}
        </div>
      )}

      {/* Full items */}
      {fullItems.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Full Closeout Items
          </h4>
          {fullItems.map(renderCloseoutCard)}
        </div>
      )}

      {shortItems.length === 0 && fullItems.length === 0 && (
        <div className="rounded-xl border border-dashed border-border flex flex-col items-center justify-center py-16 gap-3">
          <div className="rounded-full bg-muted p-4">
            <FolderCheck className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No closeout items found for this project.</p>
        </div>
      )}

      {project?.closeout_type === 'short' && (
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => setUpgradeOpen(true)}>
            Upgrade to Full Closeout
          </Button>
        </div>
      )}

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade to Full Closeout?</DialogTitle>
            <DialogDescription>
              This adds 9 additional items for comprehensive closeout tracking. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeOpen(false)}>Cancel</Button>
            <Button onClick={confirmUpgrade} disabled={upgradeCloseout.isPending}>
              {upgradeCloseout.isPending ? 'Upgrading...' : 'Upgrade'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
