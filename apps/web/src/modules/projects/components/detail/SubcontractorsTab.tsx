'use client';

import { useState } from 'react';
import { Plus, CheckCircle2, Trash2, Users2, DollarSign, Receipt, Wallet } from 'lucide-react';
import { useSubcontractors } from '@/modules/projects/hooks/queries';
import { addSubcontractor, updateSubStatus, removeSubcontractor } from '@/modules/projects/hooks/subMutations';
import type { Subcontractor, SubcontractStatus, CloseoutDocsStatus } from '@/modules/projects/types/subcontractor';
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
import { Input } from '@/modules/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/shared/components/ui/select';
import { cn } from '@/modules/shared/lib/utils';

export interface SubcontractorsTabProps {
  projectId: string;
}

const STATUS_LABELS: Record<SubcontractStatus, string> = {
  not_started: 'Not Started',
  generated: 'Generated',
  sent: 'Sent',
  signed: 'Signed',
  active: 'Active',
};

const CLOSEOUT_LABELS: Record<CloseoutDocsStatus, string> = {
  not_started: 'Not Started',
  partial: 'Partial',
  complete: 'Complete',
};

const moneyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function statusVariant(s: SubcontractStatus): 'outline' | 'secondary' | 'default' {
  if (s === 'active') return 'default';
  if (s === 'signed') return 'secondary';
  return 'outline';
}

function closeoutVariant(s: CloseoutDocsStatus): 'outline' | 'secondary' | 'default' {
  if (s === 'complete') return 'default';
  if (s === 'partial') return 'secondary';
  return 'outline';
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  return moneyFmt.format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value}%`;
}

export function SubcontractorsTab({ projectId }: SubcontractorsTabProps) {
  const { data: rawSubs, refetch } = useSubcontractors(projectId);
  const subs: Subcontractor[] = rawSubs ?? [];
  const totalContracted = subs.reduce((sum, sub) => sum + (sub.contract_amount ?? 0), 0);
  const totalBilled = subs.reduce((sum, sub) => sum + (sub.billed_amount ?? 0), 0);
  const totalOutstandingAp = subs.reduce((sum, sub) => sum + (sub.outstanding_ap_balance ?? 0), 0);

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Subcontractor | null>(null);

  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    trade: '',
    subcontract_number: '',
    subcontract_status: 'not_started' as SubcontractStatus,
    project_id: projectId,
  });

  function resetForm() {
    setForm({
      company_name: '',
      contact_name: '',
      email: '',
      phone: '',
      trade: '',
      subcontract_number: '',
      subcontract_status: 'not_started',
      project_id: projectId,
    });
  }

  async function handleAdd() {
    await addSubcontractor({ ...form });
    await refetch();
    resetForm();
    setAddOpen(false);
  }

  async function handleRemove() {
    if (!removeTarget) return;
    await removeSubcontractor(removeTarget.id);
    await refetch();
    setRemoveTarget(null);
  }

  async function handleStatusChange(subId: string, status: SubcontractStatus) {
    await updateSubStatus(subId, status);
    await refetch();
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {subs.length} Subcontractor{subs.length !== 1 ? 's' : ''}
          </h3>
          {subs.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              AP Balance reflects invoices submitted but not yet paid
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => console.log('[STUB] Import subs from Spectrum for project', projectId)}
          >
            Import from Spectrum
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => console.log('[STUB] Export subcontractor list as PDF')}
          >
            Export PDF
          </Button>
          <Button size="sm" className="h-8" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {/* Metric cards */}
      {subs.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <MetricCard
            icon={Users2}
            label="Active Subs"
            value={String(subs.length)}
            accent="text-blue-600 dark:text-blue-400"
            accentBg="bg-blue-100 dark:bg-blue-900/30"
            index={0}
          />
          <MetricCard
            icon={DollarSign}
            label="Total Contracted"
            value={formatCurrency(totalContracted)}
            accent="text-violet-600 dark:text-violet-400"
            accentBg="bg-violet-100 dark:bg-violet-900/30"
            index={1}
          />
          <MetricCard
            icon={Receipt}
            label="Billed To Date"
            value={formatCurrency(totalBilled)}
            accent="text-amber-600 dark:text-amber-400"
            accentBg="bg-amber-100 dark:bg-amber-900/30"
            index={2}
          />
          <MetricCard
            icon={Wallet}
            label="Outstanding AP"
            value={formatCurrency(totalOutstandingAp)}
            accent="text-rose-600 dark:text-rose-400"
            accentBg="bg-rose-100 dark:bg-rose-900/30"
            index={3}
          />
        </div>
      )}

      {/* Table or empty */}
      {subs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border flex flex-col items-center justify-center py-16 gap-3">
          <div className="rounded-full bg-muted p-4">
            <Users2 className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm">No subcontractors yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 dark:bg-muted/10">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Contact</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Trade</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Contract</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">Billed</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">AP Balance</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs">% Billed</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Signed</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Closeout</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs"></th>
                </tr>
              </thead>
              <tbody>
                {subs.map((sub) => (
                  <tr key={sub.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{sub.company_name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{sub.subcontract_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-foreground">{sub.contact_name}</p>
                      <p className="text-[11px] text-muted-foreground">{sub.email}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{sub.trade}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(sub.contract_amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(sub.billed_amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(sub.outstanding_ap_balance)}</td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant="secondary" className="text-xs tabular-nums">
                        {formatPercent(sub.billed_percent)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={sub.subcontract_status}
                        onValueChange={(val) => void handleStatusChange(sub.id, val as SubcontractStatus)}
                      >
                        <SelectTrigger className="h-7 w-[120px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_started">Not Started</SelectItem>
                          <SelectItem value="generated">Generated</SelectItem>
                          <SelectItem value="sent">Sent</SelectItem>
                          <SelectItem value="signed">Signed</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      {sub.signed_at ? (
                        <div className="flex items-center gap-1 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          {new Date(sub.signed_at).toLocaleDateString()}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={closeoutVariant(sub.closeout_docs_status)} className="text-xs">
                        {CLOSEOUT_LABELS[sub.closeout_docs_status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setRemoveTarget(sub)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Subcontractor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Company Name</label>
                <Input
                  value={form.company_name}
                  onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Subcontract #</label>
                <Input
                  value={form.subcontract_number}
                  onChange={(e) => setForm((f) => ({ ...f, subcontract_number: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Contact Name</label>
                <Input
                  value={form.contact_name}
                  onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Email</label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Phone</label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Trade / Scope</label>
                <Input
                  value={form.trade}
                  onChange={(e) => setForm((f) => ({ ...f, trade: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); resetForm(); }}>Cancel</Button>
            <Button onClick={() => void handleAdd()} disabled={!form.company_name.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove dialog */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Subcontractor?</DialogTitle>
            <DialogDescription>
              Remove {removeTarget?.company_name} from this project? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleRemove()}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  accent,
  accentBg,
  index = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
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
      </div>
    </div>
  );
}
