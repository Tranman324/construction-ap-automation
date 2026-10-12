'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Users, X } from 'lucide-react';
import { cn } from '@/modules/shared/lib/utils';
import { useProjectTeam, useUsers } from '@/modules/projects/hooks/queries';
import { useUpdateProjectTeam } from '@/modules/projects/hooks/mutations';
import type { User } from '@/modules/shared/types/user';
import type { ProjectTeamMember } from '@/modules/projects/types/project';
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import { isPmEligible, isSuperEligible } from '@/modules/projects/lib/userFilters';
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
import { Button } from '@/modules/shared/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/modules/shared/components/ui/sheet';

// ─── Token Input (vertical stacking — matches wizard UX) ────────────────────

function TeamTokenInput({
  label,
  users,
  selectedIds,
  onChange,
  primaryLocked,
  placeholder,
}: {
  label: string;
  users: User[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  primaryLocked?: boolean;
  placeholder?: string;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedUsers = selectedIds
    .map((id) => users.find((u) => u.id === id))
    .filter(Boolean) as User[];

  const available = useMemo(
    () =>
      users.filter(
        (u) =>
          !selectedIds.includes(u.id) &&
          (search === '' || u.name.toLowerCase().includes(search.toLowerCase())),
      ),
    [users, selectedIds, search],
  );
  const activeHighlightIdx = available.length === 0
    ? 0
    : Math.min(highlightIdx, available.length - 1);

  function addUser(user: User) {
    onChange([...selectedIds, user.id]);
    setSearch('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeUser(id: string) {
    onChange(selectedIds.filter((sid) => sid !== id));
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && search === '' && selectedIds.length > 0) {
      const lastId = selectedIds[selectedIds.length - 1];
      const isFirstAndLocked = primaryLocked && selectedIds.length === 1;
      if (!isFirstAndLocked) {
        removeUser(lastId);
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || available.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => (Math.min(prev, available.length - 1) + 1) % available.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => (Math.min(prev, available.length - 1) - 1 + available.length) % available.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addUser(available[activeHighlightIdx]);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      <div className="relative">
        <div
          className={cn(
            'rounded-md border border-input bg-transparent px-2.5 py-2 flex flex-col gap-1.5 cursor-text transition-colors',
            'focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent',
          )}
          onClick={() => inputRef.current?.focus()}
        >
          {/* Selected tokens — stacked vertically */}
          {selectedUsers.map((user, idx) => {
            const isPrimary = primaryLocked && idx === 0;
            return (
              <div
                key={user.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors',
                  isPrimary
                    ? 'bg-primary/10 border-primary/30'
                    : 'bg-muted border-border hover:bg-muted/80',
                )}
              >
                <UserAvatar user={{ name: user.name, image: user.avatar_url }} size="sm" />
                <span className="flex-1 truncate font-medium">{user.name}</span>
                {user.job_title && (
                  <span className="text-[11px] text-muted-foreground truncate max-w-[140px] hidden sm:inline">
                    {user.job_title}
                  </span>
                )}
                {isPrimary ? (
                  <span className="text-[10px] text-primary font-semibold uppercase tracking-wider shrink-0">
                    Primary
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeUser(user.id);
                    }}
                    className="rounded-sm hover:bg-foreground/10 p-0.5 cursor-pointer shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {/* Search input at bottom */}
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHighlightIdx(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setTimeout(() => setOpen(false), 200);
            }}
            onKeyDown={handleKeyDown}
            placeholder={selectedIds.length === 0 ? (placeholder ?? 'Type a name...') : 'Add another...'}
            className="bg-transparent outline-none text-sm placeholder:text-muted-foreground py-1"
          />
        </div>

        {open && available.length > 0 && (
          <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
            {available.map((user, idx) => (
              <button
                key={user.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addUser(user);
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors cursor-pointer',
                  idx === activeHighlightIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                )}
              >
                <UserAvatar user={{ name: user.name, image: user.avatar_url }} size="sm" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium">{user.name}</span>
                  {user.job_title && (
                    <span className="text-[11px] text-muted-foreground truncate">{user.job_title}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
        {open && search !== '' && available.length === 0 && (
          <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg p-3">
            <p className="text-sm text-muted-foreground">No matching people</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TeamManagementSheet({ projectId, open, onOpenChange }: Props) {
  const { data: rawTeam } = useProjectTeam(projectId);
  const currentTeam: ProjectTeamMember[] = rawTeam ?? [];
  const { mutate: updateTeam, isPending } = useUpdateProjectTeam();
  const { data: usersData } = useUsers();
  const users: User[] = usersData ?? [];

  const PM_USERS = users.filter(isPmEligible);
  const SUPER_USERS = users.filter(isSuperEligible);

  const [pendingMembers, setPendingMembers] = useState<ProjectTeamMember[]>([]);
  const [removeTarget, setRemoveTarget] = useState<ProjectTeamMember | null>(null);

  // Derive token-input IDs from pendingMembers so token inputs drive the list
  const pmMemberIds = pendingMembers.filter((m) => m.role === 'pm').map((m) => m.user_id);
  const superMemberIds = pendingMembers.filter((m) => m.role === 'superintendent').map((m) => m.user_id);

  // Sync pending members from current team when modal opens
  useEffect(() => {
    if (open) {
      setPendingMembers(currentTeam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handlePmChange(ids: string[]) {
    setPendingMembers((prev) => {
      const nonPm = prev.filter((m) => m.role !== 'pm');
      const pmMembers = ids.map((uid, idx) => {
        const existing = prev.find((m) => m.user_id === uid && m.role === 'pm');
        return (
          existing ?? {
            id: `team-new-${uid}-${Date.now()}`,
            project_id: projectId,
            user_id: uid,
            role: 'pm' as const,
            is_primary: idx === 0,
          }
        );
      });
      // Ensure first PM is primary
      if (pmMembers.length > 0) {
        pmMembers.forEach((m, i) => { m.is_primary = i === 0; });
      }
      return [...nonPm, ...pmMembers];
    });
  }

  function handleSuperChange(ids: string[]) {
    setPendingMembers((prev) => {
      const nonSuper = prev.filter((m) => m.role !== 'superintendent');
      const superMembers = ids.map((uid, idx) => {
        const existing = prev.find((m) => m.user_id === uid && m.role === 'superintendent');
        return (
          existing ?? {
            id: `team-new-${uid}-${Date.now()}`,
            project_id: projectId,
            user_id: uid,
            role: 'superintendent' as const,
            is_primary: idx === 0,
          }
        );
      });
      if (superMembers.length > 0) {
        superMembers.forEach((m, i) => { m.is_primary = i === 0; });
      }
      return [...nonSuper, ...superMembers];
    });
  }

  function handleRemoveConfirm() {
    if (!removeTarget) return;
    setPendingMembers((prev) => prev.filter((m) => m.id !== removeTarget.id));
    setRemoveTarget(null);
  }

  function getUserById(userId: string): User | null {
    return users.find((u) => u.id === userId || u.azure_id === userId) ?? null;
  }

  function handleSave() {
    updateTeam(
      { projectId, members: pendingMembers },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const hasChanges = JSON.stringify(pendingMembers) !== JSON.stringify(currentTeam);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" showCloseButton={false} className="sm:max-w-md w-[90vw] p-0 gap-0 flex flex-col">
          {/* Header */}
          <SheetHeader className="px-6 py-5 border-b border-border/60 flex-row items-center gap-3 space-y-0">
            <span className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary shrink-0">
              <Users className="h-5 w-5" />
            </span>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base">Manage Team</SheetTitle>
              <SheetDescription className="text-xs">
                Add or remove project managers and superintendents
              </SheetDescription>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-sm opacity-70 hover:opacity-100 transition-opacity p-1 shrink-0 cursor-pointer"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </button>
          </SheetHeader>

          {/* Body */}
          <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
            {/* Project Managers — vertical token input */}
            <TeamTokenInput
              label="Project Managers"
              users={PM_USERS}
              selectedIds={pmMemberIds}
              onChange={handlePmChange}
              primaryLocked
              placeholder="Type a PM name..."
            />

            {/* Superintendents — vertical token input */}
            <TeamTokenInput
              label="Superintendents"
              users={SUPER_USERS}
              selectedIds={superMemberIds}
              onChange={handleSuperChange}
              primaryLocked
              placeholder="Type a superintendent name..."
            />
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border/60 flex items-center justify-end gap-3 bg-muted/30">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending || !hasChanges}>
              {isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove{' '}
              <strong>
                {removeTarget ? (getUserById(removeTarget.user_id)?.name ?? removeTarget.user_id) : ''}
              </strong>{' '}
              from this project team?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRemoveTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveConfirm}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
