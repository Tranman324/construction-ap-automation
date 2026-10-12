'use client';

import { useState, useCallback } from 'react';
import {
  Shield,
  HardHat,
  AlertTriangle,
  MessageSquare,
  Star,
  Plus,
  Camera,
  ChevronDown,
  ChevronRight,
  Cloud,
  Users,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/modules/shared/components/ui/dialog';
import { Button } from '@/modules/shared/components/ui/button';
import { Badge } from '@/modules/shared/components/ui/badge';
import { Textarea } from '@/modules/shared/components/ui/textarea';
import { Input } from '@/modules/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/shared/components/ui/select';
import { cn } from '@/modules/shared/lib/utils';
import { useQualityChecks } from '@/modules/projects/hooks/queries';
import { useCreateQualityCheck } from '@/modules/projects/hooks/mutations';
import { getUserById, MOCK_CURRENT_USER_ID } from '@/modules/projects/mock/index';
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import type {
  QualityCheck,
  QCRating,
  QCCategory,
  QCActionItem,
} from '@/modules/projects/types/qualityCheck';
import {
  QC_RATING_LABELS,
  QC_RATING_COLORS,
} from '@/modules/projects/types/qualityCheck';

// ─── Rating Labels with Icons ─────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'safety_ppe' as const, label: 'Safety & PPE Compliance', icon: Shield, desc: 'Hard hats, vests, glasses, toolbox talks, fall protection' },
  { key: 'site_conditions' as const, label: 'Job Site Conditions', icon: HardHat, desc: 'Cleanliness, protection, material staging, dust control' },
  { key: 'issues_concerns' as const, label: 'Issues & Concerns', icon: AlertTriangle, desc: 'Schedule, quality, coordination, weather impacts' },
  { key: 'other_notes' as const, label: 'General Notes', icon: MessageSquare, desc: 'Client visits, milestones, coordination updates' },
] as const;

type CatKey = typeof CATEGORIES[number]['key'];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRelative(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  return `${Math.floor(days / 7)} weeks ago`;
}

function scoreColor(score: number): string {
  if (score >= 4.5) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 3.5) return 'text-green-600 dark:text-green-400';
  if (score >= 2.5) return 'text-amber-600 dark:text-amber-400';
  if (score >= 1.5) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 4.5) return 'bg-emerald-100 dark:bg-emerald-900/30';
  if (score >= 3.5) return 'bg-green-100 dark:bg-green-900/30';
  if (score >= 2.5) return 'bg-amber-100 dark:bg-amber-900/30';
  if (score >= 1.5) return 'bg-orange-100 dark:bg-orange-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
}

// ─── Star Rating Input ────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
  readonly = false,
}: {
  value: QCRating;
  onChange?: (v: QCRating) => void;
  readonly?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value;

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readonly}
          className={cn(
            'transition-colors',
            readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110 transition-transform',
          )}
          onMouseEnter={() => !readonly && setHover(n)}
          onMouseLeave={() => !readonly && setHover(null)}
          onClick={() => onChange?.(n as QCRating)}
        >
          <Star
            className={cn(
              'h-5 w-5',
              n <= display
                ? QC_RATING_COLORS[(display as QCRating) || 3].text + ' fill-current'
                : 'text-muted-foreground/30',
            )}
          />
        </button>
      ))}
      <span className={cn(
        'text-xs font-medium ml-1.5',
        QC_RATING_COLORS[(display as QCRating) || 3].text,
      )}>
        {QC_RATING_LABELS[(display as QCRating) || 3]}
      </span>
    </div>
  );
}

// ─── Overview Card (for OverviewTab) ──────────────────────────────────────────

export function QualityCheckOverview({ projectId }: { projectId: string }) {
  const { data: checks } = useQualityChecks(projectId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [renderNow] = useState(() => Date.now());

  const latest = checks?.[0] ?? null;
  const totalChecks = checks?.length ?? 0;
  const openActions = checks?.flatMap((c: QualityCheck) => c.action_items.filter((a: QCActionItem) => !a.resolved)) ?? [];
  const avgScore = totalChecks > 0
    ? Math.round((checks!.reduce((s: number, c: QualityCheck) => s + c.overall_score, 0) / totalChecks) * 10) / 10
    : null;

  const isOverdue = latest
    ? renderNow - new Date(latest.completed_at).getTime() > 7 * 86_400_000
    : true;

  return (
    <>
      <div className={cn(
        'rounded-xl border p-5 space-y-4 transition-colors',
        isOverdue && totalChecks > 0
          ? 'border-amber-200 dark:border-amber-500/20 bg-amber-50/30 dark:bg-amber-950/10'
          : 'border-border bg-card',
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn('rounded-lg p-2', isOverdue && totalChecks > 0 ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-primary/10')}>
              <Shield className={cn('h-4 w-4', isOverdue && totalChecks > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-primary')} />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Weekly Quality Check</h3>
          </div>
          <Button size="sm" className="gap-1.5 h-8" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            New Check
          </Button>
        </div>

        {latest ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Last Check</p>
              <p className={cn(
                'text-sm font-medium',
                isOverdue ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
              )}>
                {fmtRelative(latest.completed_at, renderNow)}
              </p>
              <p className="text-[11px] text-muted-foreground">{fmtDate(latest.completed_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Overall Score</p>
              <div className="flex items-baseline gap-1.5">
                <span className={cn('text-2xl font-bold tabular-nums', scoreColor(latest.overall_score))}>
                  {latest.overall_score.toFixed(1)}
                </span>
                <span className="text-xs text-muted-foreground">/ 5</span>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Average (All)</p>
              {avgScore ? (
                <div className="flex items-baseline gap-1.5">
                  <span className={cn('text-2xl font-bold tabular-nums', scoreColor(avgScore))}>
                    {avgScore.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">({totalChecks})</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Open Actions</p>
              <span className={cn(
                'text-2xl font-bold tabular-nums',
                openActions.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400',
              )}>
                {openActions.length}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">
            No quality checks recorded yet. Start a weekly check to track job site conditions.
          </p>
        )}

        {/* Compact action items preview */}
        {openActions.length > 0 && (
          <div className="border-t border-border pt-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Open Action Items</p>
            {openActions.slice(0, 3).map((ai: QCActionItem) => (
              <div key={ai.id} className="flex items-start gap-2 text-sm">
                <Circle className={cn(
                  'h-3 w-3 mt-1 shrink-0',
                  ai.priority === 'critical' ? 'text-red-500' : ai.priority === 'high' ? 'text-orange-500' : 'text-amber-500',
                )} />
                <span className="text-foreground">{ai.description}</span>
                <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">{ai.priority}</Badge>
              </div>
            ))}
            {openActions.length > 3 && (
              <p className="text-xs text-muted-foreground">+{openActions.length - 3} more</p>
            )}
          </div>
        )}
      </div>

      {/* New Quality Check Dialog */}
      <QualityCheckNewDialog projectId={projectId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

// ─── New Quality Check Dialog ─────────────────────────────────────────────────

interface NewDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function QualityCheckNewDialog({ projectId, open, onOpenChange }: NewDialogProps) {
  const createCheck = useCreateQualityCheck();

  const blankCat = (): QCCategory => ({ rating: 3 as QCRating, notes: '', photo_urls: [] });
  const [form, setForm] = useState({
    safety_ppe: blankCat(),
    site_conditions: blankCat(),
    issues_concerns: blankCat(),
    other_notes: blankCat(),
    weather: '',
    crew_count: '',
    action_items: [] as Array<{ description: string; priority: QCActionItem['priority'] }>,
  });

  const resetForm = useCallback(() => {
    setForm({
      safety_ppe: blankCat(),
      site_conditions: blankCat(),
      issues_concerns: blankCat(),
      other_notes: blankCat(),
      weather: '',
      crew_count: '',
      action_items: [],
    });
  }, []);

  function setCatField(key: CatKey, field: keyof QCCategory, value: QCCategory[keyof QCCategory]) {
    setForm((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  }

  function addActionItem() {
    setForm((prev) => ({
      ...prev,
      action_items: [...prev.action_items, { description: '', priority: 'medium' as const }],
    }));
  }

  function removeActionItem(idx: number) {
    setForm((prev) => ({
      ...prev,
      action_items: prev.action_items.filter((_, i) => i !== idx),
    }));
  }

  function updateActionItem(idx: number, field: string, value: string) {
    setForm((prev) => ({
      ...prev,
      action_items: prev.action_items.map((ai, i) =>
        i === idx ? { ...ai, [field]: value } : ai,
      ),
    }));
  }

  function handleSubmit() {
    const ratings = [form.safety_ppe.rating, form.site_conditions.rating, form.issues_concerns.rating, form.other_notes.rating];
    const overall = Math.round((ratings.reduce((s, r) => s + r, 0) / 4) * 10) / 10;

    const check: QualityCheck = {
      id: `qc-new-${Date.now()}`,
      project_id: projectId,
      completed_by: MOCK_CURRENT_USER_ID,
      completed_at: new Date().toISOString(),
      overall_score: overall,
      safety_ppe: form.safety_ppe,
      site_conditions: form.site_conditions,
      issues_concerns: form.issues_concerns,
      other_notes: form.other_notes,
      action_items: form.action_items.filter((ai) => ai.description.trim()).map((ai, i) => ({
        id: `qca-new-${Date.now()}-${i}`,
        description: ai.description,
        priority: ai.priority,
        assigned_to: MOCK_CURRENT_USER_ID,
        due_date: null,
        resolved: false,
        resolved_at: null,
      })),
      weather: form.weather,
      crew_count: form.crew_count ? parseInt(form.crew_count, 10) : null,
    };

    createCheck.mutate(check, {
      onSuccess: () => {
        resetForm();
        onOpenChange(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border bg-gradient-to-r from-primary/[0.04] to-transparent sticky top-0 z-10">
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="rounded-lg p-1.5 bg-primary/10">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            New Quality Check
          </DialogTitle>
          <DialogDescription>
            Weekly job site assessment. Rate each area and add notes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 px-6 py-5">
          {/* Weather & Crew Count */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <Cloud className="h-3 w-3" /> Weather
              </label>
              <Input
                placeholder="e.g. Clear, 72°F"
                value={form.weather}
                onChange={(e) => setForm((p) => ({ ...p, weather: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <Users className="h-3 w-3" /> Crew Count
              </label>
              <Input
                type="number"
                placeholder="e.g. 12"
                value={form.crew_count}
                onChange={(e) => setForm((p) => ({ ...p, crew_count: e.target.value }))}
              />
            </div>
          </div>

          {/* Rating Categories */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CATEGORIES.map(({ key, label, icon: Icon, desc }) => (
            <div key={key} className="space-y-2 rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <div className={cn('rounded-lg p-2 shrink-0', QC_RATING_COLORS[form[key].rating].bg)}>
                  <Icon className={cn('h-4 w-4', QC_RATING_COLORS[form[key].rating].text)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                  <div className="mt-2">
                    <StarRating value={form[key].rating} onChange={(v) => setCatField(key, 'rating', v)} />
                  </div>
                </div>
              </div>
              <Textarea
                placeholder={`Notes about ${label.toLowerCase()}...`}
                className="mt-2 min-h-[4rem] resize-none"
                value={form[key].notes}
                onChange={(e) => setCatField(key, 'notes', e.target.value)}
              />
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => {/* Photo attach stub */}}
              >
                <Camera className="h-3 w-3" />
                Attach Photo
              </button>
            </div>
          ))}
          </div>

          {/* Action Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Action Items</p>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addActionItem}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {form.action_items.length === 0 && (
              <p className="text-xs text-muted-foreground">No action items. Add if issues were found.</p>
            )}
            {form.action_items.map((ai, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <Input
                  className="flex-1 text-sm"
                  placeholder="Describe the action needed..."
                  value={ai.description}
                  onChange={(e) => updateActionItem(idx, 'description', e.target.value)}
                />
                <Select
                  value={ai.priority}
                  onValueChange={(v) => updateActionItem(idx, 'priority', v)}
                >
                  <SelectTrigger className="w-28 h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeActionItem(idx)}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>

          {/* Submit */}
          <div className="sticky bottom-0 bg-card border-t border-border -mx-6 px-6 py-4 mt-2">
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={createCheck.isPending}
            >
              {createCheck.isPending ? 'Saving...' : 'Submit Quality Check'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Quality Check History ────────────────────────────────────────────────────

export function QualityCheckHistory({ projectId }: { projectId: string }) {
  const { data: checks } = useQualityChecks(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renderNow] = useState(() => Date.now());

  if (!checks || checks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-center">
        <p className="text-sm text-muted-foreground">No quality checks recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Quality Check History</h3>
        <span className="text-xs text-muted-foreground">{checks.length} {checks.length === 1 ? 'check' : 'checks'}</span>
      </div>
      <div className="divide-y divide-border max-h-[32rem] overflow-y-auto">
        {checks.map((check: QualityCheck) => {
          const expanded = expandedId === check.id;
          const user = getUserById(check.completed_by);
          const openAI = check.action_items.filter((a: QCActionItem) => !a.resolved).length;

          return (
            <div key={check.id}>
              {/* Summary row */}
              <button
                className="w-full flex items-center gap-4 px-5 py-3 hover:bg-muted/30 transition-colors text-left"
                onClick={() => setExpandedId(expanded ? null : check.id)}
              >
                {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{fmtDate(check.completed_at)}</span>
                    <span className="text-xs text-muted-foreground">({fmtRelative(check.completed_at, renderNow)})</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {user && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <UserAvatar user={{ name: user.name, image: user.avatar_url }} size="sm" />
                        {user.name}
                      </span>
                    )}
                    {check.weather && <span className="text-xs text-muted-foreground">{check.weather}</span>}
                    {check.crew_count && <span className="text-xs text-muted-foreground">{check.crew_count} crew</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className={cn('flex items-center gap-1 rounded-full px-2.5 py-1', scoreBg(check.overall_score))}>
                    <Star className={cn('h-3.5 w-3.5 fill-current', scoreColor(check.overall_score))} />
                    <span className={cn('text-sm font-bold tabular-nums', scoreColor(check.overall_score))}>
                      {check.overall_score.toFixed(1)}
                    </span>
                  </div>
                  {openAI > 0 && (
                    <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-700">
                      {openAI} open
                    </Badge>
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              {expanded && (
                <div className="px-5 pb-4 pt-1 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                  {/* Category ratings */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {CATEGORIES.map(({ key, label, icon: Icon }) => {
                      const cat = check[key as CatKey] as QCCategory;
                      return (
                        <div key={key} className="rounded-lg border border-border/60 p-3 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Icon className={cn('h-3.5 w-3.5', QC_RATING_COLORS[cat.rating].text)} />
                            <span className="text-xs font-medium text-foreground">{label}</span>
                            <div className="ml-auto">
                              <StarRating value={cat.rating} readonly />
                            </div>
                          </div>
                          {cat.notes && <p className="text-xs text-muted-foreground leading-relaxed">{cat.notes}</p>}
                          {cat.photo_urls.length > 0 && (
                            <div className="flex gap-1.5">
                              {cat.photo_urls.map((url: string, i: number) => (
                                <div key={i} className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                                  <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Action items */}
                  {check.action_items.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Action Items</p>
                      {check.action_items.map((ai: QCActionItem) => (
                        <div key={ai.id} className="flex items-start gap-2 text-sm">
                          {ai.resolved
                            ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500" />
                            : <Circle className={cn(
                                'h-3.5 w-3.5 mt-0.5 shrink-0',
                                ai.priority === 'critical' ? 'text-red-500' : ai.priority === 'high' ? 'text-orange-500' : 'text-amber-500',
                              )} />
                          }
                          <span className={cn('flex-1', ai.resolved && 'line-through text-muted-foreground')}>{ai.description}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">{ai.priority}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
