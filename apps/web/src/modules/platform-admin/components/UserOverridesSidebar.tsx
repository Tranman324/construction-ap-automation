"use client";

import { useMemo } from "react";
import { Search } from "lucide-react";

import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";
import { ADMIN_OVERRIDE_COPY } from "@/modules/platform-admin/lib/adminCopy";
import {
  getAdminUserRoleLabel,
  matchesAdminUserSearch,
} from "@/modules/platform-admin/lib/adminUsers";
import type { AdminUser } from "@/modules/platform-admin/types/admin";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Input } from "@/modules/shared/components/ui/input";
import { cn } from "@/modules/shared/lib/utils";

interface UserOverridesSidebarProps {
  users: AdminUser[];
  selectedUserId: string | null;
  search: string;
  missingRequestedUserId?: string | null;
  onSearchChange: (value: string) => void;
  onSelectUser: (userId: string) => void;
}

export function UserOverridesSidebar({
  users,
  selectedUserId,
  search,
  missingRequestedUserId,
  onSearchChange,
  onSelectUser,
}: UserOverridesSidebarProps) {
  const filteredUsers = useMemo(
    () => users.filter((user) => matchesAdminUserSearch(user, search)),
    [users, search],
  );

  return (
    <div className="space-y-4 rounded-2xl border border-border/50 bg-background/70 p-4 shadow-sm shadow-primary/5">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Select a user</p>
        <p className="text-sm leading-6 text-muted-foreground">{ADMIN_OVERRIDE_COPY.description}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <label htmlFor="user-overrides-search" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Search</label>
          <AdminFieldHelp label="Search override users" description="Filters users by name, email, or job title before selecting whose direct overrides to edit." />
        </div>
        <div className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="user-overrides-search"
            aria-label="Search override users"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="pl-9"
            placeholder="Search name, email, or job title"
          />
        </div>
      </div>

      {missingRequestedUserId ? (
        <div
          data-testid="user-overrides-missing-user"
          className="rounded-xl border border-amber-500/35 bg-amber-500/8 px-4 py-3 text-sm text-amber-900 dark:text-amber-100"
        >
          {`Requested user ${missingRequestedUserId} is not available. Choose another user to continue.`}
        </div>
      ) : null}

      <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        {filteredUsers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-background/80 px-4 py-5 text-sm text-muted-foreground">
            No users match the current search.
          </div>
        ) : (
          filteredUsers.map((user) => {
            const selected = selectedUserId === user.id;

            return (
              <button
                key={user.id}
                type="button"
                data-testid={`override-user-option-${user.id}`}
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                  selected
                    ? "border-primary/25 bg-primary/[0.07] shadow-sm shadow-primary/5"
                    : "border-border/60 bg-card/90 hover:border-primary/20 hover:bg-primary/[0.04]",
                )}
                onClick={() => onSelectUser(user.id)}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <Badge variant={user.is_active ? "default" : "outline"}>
                    {user.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">{getAdminUserRoleLabel(user)}</Badge>
                  <Badge variant="outline">{user.job_title ?? "No title"}</Badge>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}