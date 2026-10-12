'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  MapPin,
  Calendar,
  DollarSign,
  Hash,
  CheckCircle2,
  XCircle,
  Trash2,
  Pencil,
  FileText,
  ClipboardList,
  Loader2,
  Camera,
  Briefcase,
  Users,
} from 'lucide-react';
import { useAuth } from '@/modules/shared/lib/auth';
import { useProject, useProjectTeam } from '@/modules/projects/hooks/queries';
import {
  useApproveProject,
  useRejectProject,
  useRequestChanges,
  useSoftDeleteProject,
} from '@/modules/projects/hooks/mutations';
import { ProjectStatus, type Project, type ProjectTeamMember, type ProjectPhaseCode, type ProjectBillingItem } from '@/modules/projects/types/project';
import { getUserById } from '@/modules/projects/mock';
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/shared/components/ui/card';
import { Button } from '@/modules/shared/components/ui/button';
import { Skeleton } from '@/modules/shared/components/ui/skeleton';
import { Textarea } from '@/modules/shared/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/modules/shared/components/ui/alert-dialog';
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import { cn } from '@/modules/shared/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const currencyFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const dateFmt = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

// ─── Main Component ───────────────────────────────────────────────────────────

export function PendingReview({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const { data: project, isLoading } = useProject(id);
  const { data: rawTeam } = useProjectTeam(id);
  const team: ProjectTeamMember[] = rawTeam ?? [];

  const approveProject = useApproveProject();
  const rejectProject = useRejectProject();
  const requestChanges = useRequestChanges();
  const softDelete = useSoftDeleteProject();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [dialogText, setDialogText] = useState('');
  const [approving, setApproving] = useState(false);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium text-foreground">Project not found.</p>
        <Button variant="ghost" className="mt-4" onClick={() => router.push('/projects/pending')}>
          Back to queue
        </Button>
      </div>
    );
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const isApproved = project.status === ProjectStatus.active || project.status === ProjectStatus.onboarding;
  const isPending = project.status === ProjectStatus.pending_approval;
  const pmMember = team.find((m) => m.role === 'pm' && m.is_primary);
  const superMember = team.find((m) => m.role === 'superintendent' && m.is_primary);
  const pm = pmMember ? getUserById(pmMember.user_id) : null;
  const superUser = superMember ? getUserById(superMember.user_id) : null;

  const allPms = team.filter((m) => m.role === 'pm').map((m) => {
    const u = getUserById(m.user_id);
    return { name: u?.name ?? 'Unknown', avatar_url: u?.avatar_url, is_primary: m.is_primary };
  });
  const allSupers = team.filter((m) => m.role === 'superintendent').map((m) => {
    const u = getUserById(m.user_id);
    return { name: u?.name ?? 'Unknown', avatar_url: u?.avatar_url, is_primary: m.is_primary };
  });

  const phaseTotal = project.phase_codes.reduce((s: number, pc: { amount: number }) => s + pc.amount, 0);
  const billingTotal = project.billing_items.reduce((s: number, bi: { amount: number }) => s + bi.amount, 0);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleApprove = () => {
    if (!user) return;
    setApproveOpen(false);
    setApproving(true);
    approveProject.mutate(
      { id: project.id, approvedBy: user.name },
      {
        onSuccess: (data: Project) => {
          // Hold the spinner for a moment before navigating
          setTimeout(() => {
            router.push(`/projects/${data.id}`);
          }, 1200);
        },
      },
    );
  };

  const handleReject = () => {
    rejectProject.mutate(
      { id: project.id, reason: dialogText },
      {
        onSuccess: () => {
          setRejectOpen(false);
          setDialogText('');
          router.push('/projects/pending');
        },
      },
    );
  };

  const handleRequestChanges = () => {
    requestChanges.mutate(
      { id: project.id, notes: dialogText },
      {
        onSuccess: () => {
          setChangesOpen(false);
          setDialogText('');
          router.push('/projects/pending');
        },
      },
    );
  };

  const handleDelete = () => {
    softDelete.mutate(
      { id: project.id, reason: dialogText },
      {
        onSuccess: () => {
          setDeleteOpen(false);
          setDialogText('');
          router.push('/projects/pending');
        },
      },
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      {/* Approve overlay */}
      {approving && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-300">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="mt-4 text-lg font-medium text-foreground animate-in fade-in slide-in-from-bottom-2 duration-500">Approving project&hellip;</p>
        </div>
      )}

      {/* Back nav */}
      <div className="px-4 sm:px-6 pt-3 pb-1">
        <button
          onClick={() => router.push('/projects/pending')}
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Pending Queue
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-28">
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="py-6 space-y-4 animate-in fade-in-5 duration-200">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {isApproved ? (
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    {project.job_number}
                  </span>
                ) : (
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Pending
                  </span>
                )}
                <span className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {project.job_type}
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight">{project.job_name}</h1>
              <p className="text-sm text-muted-foreground">{project.customer_name}</p>
            </div>

            {isApproved && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5" />
                <div className="text-right">
                  <p className="font-medium">Approved</p>
                  <p className="text-xs text-muted-foreground">{dateFmt(project.approved_at ?? '')}</p>
                </div>
              </div>
            )}
          </div>

          {/* Team strip */}
          <div className="space-y-3">
            {/* Project Managers */}
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                <Users className="h-3 w-3" /> Project Managers
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {allPms.map((u) => (
                  <div key={u.name} className="flex items-center gap-2">
                    <UserAvatar user={{ name: u.name, image: u.avatar_url ?? '' }} size="sm" />
                    <span className="text-sm font-medium">{u.name}</span>
                    {u.is_primary && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">Primary</span>
                    )}
                  </div>
                ))}
                {allPms.length === 0 && <span className="text-sm text-muted-foreground">None assigned</span>}
              </div>
            </div>

            {/* Superintendents */}
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                <Users className="h-3 w-3" /> Superintendents
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {allSupers.map((u) => (
                  <div key={u.name} className="flex items-center gap-2">
                    <UserAvatar user={{ name: u.name, image: u.avatar_url ?? '' }} size="sm" />
                    <span className="text-sm font-medium">{u.name}</span>
                    {u.is_primary && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">Primary</span>
                    )}
                  </div>
                ))}
                {allSupers.length === 0 && <span className="text-sm text-muted-foreground">None assigned</span>}
              </div>
            </div>
          </div>
        </div>

        {/* ── Onboarding section removed — now lives in ProjectDetail ─── */}

        {/* ── Project Details ──────────────────────────────────── */}
        <div className="space-y-6 animate-in fade-in-5 slide-in-from-bottom-2 duration-300" style={{ animationDelay: '100ms', animationFillMode: 'backwards' }}>
          {/* Info grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <InfoCard icon={DollarSign} label="Contract Value" value={currency.format(project.contract_value)} />
            <InfoCard icon={MapPin} label="Address" value={project.address} />
            <InfoCard icon={Calendar} label="Start / End" value={`${dateFmt(project.start_date)} — ${dateFmt(project.end_date)}`} />
            <InfoCard icon={Hash} label="Cost Center" value={project.cost_center || '—'} />
          </div>

          {/* Detail info row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Estimate #</p>
              <p className="font-mono font-medium">{project.estimate_number || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Who Sold</p>
              <p className="font-medium">{project.who_sold || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Closeout Type</p>
              <p className="font-medium capitalize">{project.closeout_type}</p>
            </div>
            <div className="flex items-center gap-4">
              {project.job_type === 'Service' && (
                <div className="flex items-center gap-1.5 text-sm">
                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">Service Job</span>
                </div>
              )}
              {project.photos_required && (
                <div className="flex items-center gap-1.5 text-sm">
                  <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">Photos Required</span>
                </div>
              )}
            </div>
          </div>

          {/* Phase Codes Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                Phase Codes
                <span className="text-xs font-normal text-muted-foreground ml-auto">
                  {project.phase_codes.length} codes — {currency.format(phaseTotal)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">Code</th>
                      <th className="text-left px-4 py-2 font-medium">Description</th>
                      <th className="text-center px-4 py-2 font-medium">Type</th>
                      <th className="text-right px-4 py-2 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.phase_codes.map((pc: ProjectPhaseCode) => (
                      <tr key={pc.phase_code} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2 font-mono text-xs">{pc.phase_code}</td>
                        <td className="px-4 py-2">{pc.description}</td>
                        <td className="px-4 py-2 text-center">
                          <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded">
                            {pc.cost_type}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{currencyFull.format(pc.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 font-semibold text-xs">
                      <td colSpan={3} className="px-4 py-2 text-right">Total</td>
                      <td className="px-4 py-2 text-right font-mono">{currencyFull.format(phaseTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Billing / SOV Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Schedule of Values
                <span className="text-xs font-normal text-muted-foreground ml-auto">
                  {project.billing_items.length} items — {currency.format(billingTotal)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">#</th>
                      <th className="text-left px-4 py-2 font-medium">Code</th>
                      <th className="text-left px-4 py-2 font-medium">Description</th>
                      <th className="text-right px-4 py-2 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.billing_items.map((bi: ProjectBillingItem) => (
                      <tr key={bi.item_number} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2 font-mono text-xs">{bi.item_number}</td>
                        <td className="px-4 py-2 font-mono text-xs">{bi.code ?? '—'}</td>
                        <td className="px-4 py-2">{bi.description}</td>
                        <td className="px-4 py-2 text-right font-mono">{currencyFull.format(bi.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 font-semibold text-xs">
                      <td colSpan={3} className="px-4 py-2 text-right">Total</td>
                      <td className="px-4 py-2 text-right font-mono">{currencyFull.format(billingTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Sticky Action Bar (pending only) ───────────────────── */}
      {isPending && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 max-w-screen-xl mx-auto">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDialogText('');
                  setChangesOpen(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Request Changes
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  setDialogText('');
                  setRejectOpen(true);
                }}
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Reject
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  setDialogText('');
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete
              </Button>
            </div>
            <Button
              size="sm"
              className="min-w-[140px]"
              onClick={() => setApproveOpen(true)}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Approve Project
            </Button>
          </div>
        </div>
      )}

      {/* ── Dialogs ────────────────────────────────────────────── */}
      {/* Approve */}
      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve project?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove} disabled={approveProject.isPending}>
              {approveProject.isPending ? 'Approving…' : 'Approve'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject */}
      <AlertDialog open={rejectOpen} onOpenChange={(o) => { setRejectOpen(o); if (!o) setDialogText(''); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Project</AlertDialogTitle>
            <AlertDialogDescription>
              Provide a reason for rejecting &ldquo;{project.job_name}&rdquo;. The PM will be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason for rejection…"
            value={dialogText}
            onChange={(e) => setDialogText(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={!dialogText.trim() || rejectProject.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Request Changes */}
      <AlertDialog open={changesOpen} onOpenChange={(o) => { setChangesOpen(o); if (!o) setDialogText(''); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request Changes</AlertDialogTitle>
            <AlertDialogDescription>
              Describe the changes needed for &ldquo;{project.job_name}&rdquo;. The PM will be able to edit and resubmit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Changes required…"
            value={dialogText}
            onChange={(e) => setDialogText(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRequestChanges}
              disabled={!dialogText.trim() || requestChanges.isPending}
            >
              Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete */}
      <AlertDialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setDialogText(''); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{project.job_name}&rdquo; will be soft-deleted and retained for 30 days before permanent removal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reason for deletion…"
            value={dialogText}
            onChange={(e) => setDialogText(e.target.value)}
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={!dialogText.trim() || softDelete.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Team Member ──────────────────────────────────────────────────────────────

function TeamMember({ label, user }: { label: string; user: { name: string; avatar_url: string } | null }) {
  return (
    <div className="flex items-center gap-2">
      {user ? (
        <UserAvatar user={{ name: user.name, image: user.avatar_url }} size="sm" />
      ) : (
        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground">?</div>
      )}
      <div className="text-xs">
        <p className="text-muted-foreground">{label}</p>
        <p className="font-medium">{user?.name ?? 'Unassigned'}</p>
      </div>
    </div>
  );
}

// ─── Info Card ────────────────────────────────────────────────────────────────

function InfoCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <Card className="bg-card">
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 shrink-0">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-sm font-medium truncate">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
