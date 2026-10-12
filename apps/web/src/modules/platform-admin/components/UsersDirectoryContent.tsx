"use client";

import { AlertTriangle, Users } from "lucide-react";

import { formatAdminLastLogin, getAdminUserRoleLabel } from "@/modules/platform-admin/lib/adminUsers";
import type { AdminUser } from "@/modules/platform-admin/types/admin";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/shared/components/ui/table";
import { cn } from "@/modules/shared/lib/utils";

interface UsersDirectoryContentProps {
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  filteredUsers: AdminUser[];
  selectedUserId: string | null;
  hasFilters: boolean;
  onResetFilters: () => void;
  onSelectUser: (userId: string) => void;
}

export function UsersDirectoryContent({
  isLoading,
  isError,
  errorMessage,
  filteredUsers,
  selectedUserId,
  hasFilters,
  onResetFilters,
  onSelectUser,
}: UsersDirectoryContentProps) {
  if (isLoading) {
    return (
      <div className="space-y-3 px-5 py-5">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Unable to load users</p>
          <p className="max-w-md text-sm text-muted-foreground">{errorMessage}</p>
        </div>
      </div>
    );
  }

  if (filteredUsers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-primary/10 bg-primary/[0.07] text-primary">
          <Users className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {hasFilters ? "No users match the current filters" : "No users available"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {hasFilters
              ? "Adjust the search, role filter, or active-status filter to widen the result set."
              : "Admin users will appear here once the backend returns a directory inventory."}
          </p>
        </div>
        {hasFilters ? (
          <Button variant="outline" size="sm" onClick={onResetFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div data-testid="users-mobile-list" className="space-y-3 md:hidden">
        {filteredUsers.map((user) => {
          const selected = selectedUserId === user.id;

          return (
            <button
              key={user.id}
              type="button"
              data-testid={`user-card-${user.id}`}
              aria-pressed={selected}
              className={cn(
                "w-full rounded-xl border px-4 py-4 text-left transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected
                  ? "border-primary/30 bg-primary/[0.08] shadow-sm shadow-primary/10"
                  : "border-border/60 bg-background/75 hover:border-primary/20 hover:bg-background",
              )}
              onClick={() => onSelectUser(user.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  <p className="text-xs text-muted-foreground">{user.job_title ?? "No job title on file"}</p>
                </div>
                <Badge variant={user.is_active ? "default" : "outline"}>
                  {user.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">{getAdminUserRoleLabel(user)}</Badge>
                <Badge variant="outline">Role v{user.role_version}</Badge>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Last login: {formatAdminLastLogin(user.last_login_at)}
              </p>
            </button>
          );
        })}
      </div>

      <div data-testid="users-table" className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Job title</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Role version</TableHead>
              <TableHead>Last login</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => {
              const selected = selectedUserId === user.id;

              return (
                <TableRow
                  key={user.id}
                  data-state={selected ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => onSelectUser(user.id)}
                >
                  <TableCell>
                    <button
                      type="button"
                      data-testid={`user-row-${user.id}`}
                      className="w-full text-left"
                      onClick={() => onSelectUser(user.id)}
                    >
                      <p className="font-medium text-foreground">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </button>
                  </TableCell>
                  <TableCell className="text-sm text-foreground">{user.job_title ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{getAdminUserRoleLabel(user)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? "default" : "outline"}>
                      {user.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">v{user.role_version}</TableCell>
                  <TableCell className="text-sm text-foreground">{formatAdminLastLogin(user.last_login_at)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}