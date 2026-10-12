"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";
import { UserDetailPanel } from "@/modules/platform-admin/components/UserDetailPanel";
import { UsersDirectoryContent } from "@/modules/platform-admin/components/UsersDirectoryContent";
import { useAdminRoles, useAdminUsers } from "@/modules/platform-admin/hooks/queries";
import { formatAdminRoleName } from "@/modules/platform-admin/lib/adminRoles";
import {
  ALL_ROLES_FILTER,
  type AdminUserStatusFilter,
  deriveAdminRoleOptions,
  matchesAdminUserSearch,
} from "@/modules/platform-admin/lib/adminUsers";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/modules/shared/components/ui/card";
import { Input } from "@/modules/shared/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/modules/shared/components/ui/sheet";

const DESKTOP_DETAIL_QUERY = "(min-width: 1024px)";

function useDesktopDetailPane() {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }

    return window.matchMedia(DESKTOP_DETAIL_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia(DESKTOP_DETAIL_QUERY);

    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches);
    }

    mediaQueryList.addEventListener("change", handleChange);

    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }, []);

  return matches;
}

export function UsersSection() {
  const usersQuery = useAdminUsers();
  const rolesQuery = useAdminRoles();
  const showDesktopDetailPane = useDesktopDetailPane();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState(ALL_ROLES_FILTER);
  const [statusFilter, setStatusFilter] = useState<AdminUserStatusFilter>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const users = usersQuery.data ?? [];
  const roleOptions = rolesQuery.data?.length ? rolesQuery.data : deriveAdminRoleOptions(users);
  const filteredUsers = users.filter((user) => {
    const matchesRole = roleFilter === ALL_ROLES_FILTER || user.role_id === roleFilter;
    const matchesStatus =
      statusFilter === "all" || (statusFilter === "active" ? user.is_active : !user.is_active);

    return matchesRole && matchesStatus && matchesAdminUserSearch(user, search);
  });
  const activeSelectedUserId =
    selectedUserId && filteredUsers.some((user) => user.id === selectedUserId)
      ? selectedUserId
      : null;
  const selectedUser = filteredUsers.find((user) => user.id === activeSelectedUserId) ?? null;
  const hasFilters = search.trim().length > 0 || roleFilter !== ALL_ROLES_FILTER || statusFilter !== "all";
  const usersErrorMessage =
    usersQuery.error instanceof Error ? usersQuery.error.message : "User inventory is temporarily unavailable.";

  function resetFilters() {
    setSearch("");
    setRoleFilter(ALL_ROLES_FILTER);
    setStatusFilter("all");
  }

  return (
    <section data-testid="admin-section-users" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="border-border/60 bg-card/90 shadow-sm shadow-primary/5">
        <CardHeader className="gap-4 border-b border-border/50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-bold text-foreground">User directory</CardTitle>
              <CardDescription>Search, filter, and inspect live user access without leaving the admin route.</CardDescription>
            </div>
            <Badge variant="outline">{`${filteredUsers.length} shown`}</Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_10rem]">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <label htmlFor="admin-user-search" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Search</label>
                <AdminFieldHelp label="Search users" description="Filters the directory by name, email, or job title without leaving the current admin section." />
              </div>
              <div className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="admin-user-search" aria-label="Search users" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search name, email, or job title" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <label htmlFor="admin-role-filter" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Role</label>
                <AdminFieldHelp label="Role filter" description="Narrows the directory to users assigned to a specific baseline role." />
              </div>
              <select
                id="admin-role-filter"
                aria-label="Role filter"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                <option value={ALL_ROLES_FILTER}>All roles</option>
                {roleOptions.map((role) => (
                  <option key={role.id} value={role.id}>
                    {formatAdminRoleName(role.name)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <label htmlFor="admin-status-filter" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Status</label>
                <AdminFieldHelp label="Active status filter" description="Filters users by whether their account can currently sign in." />
              </div>
              <select
                id="admin-status-filter"
                aria-label="Active status filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as AdminUserStatusFilter)}
                className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                <option value="all">All users</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-5 py-4">
          <UsersDirectoryContent
            isLoading={usersQuery.isLoading && !usersQuery.data}
            isError={usersQuery.isError}
            errorMessage={usersErrorMessage}
            filteredUsers={filteredUsers}
            selectedUserId={activeSelectedUserId}
            hasFilters={hasFilters}
            onResetFilters={resetFilters}
            onSelectUser={setSelectedUserId}
          />
        </CardContent>
      </Card>

      <div className="hidden lg:block">
        <UserDetailPanel key={selectedUser?.id ?? "empty"} user={selectedUser} roles={roleOptions} />
      </div>

      <Sheet
        open={Boolean(selectedUser && !showDesktopDetailPane)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedUserId(null);
          }
        }}
      >
        <SheetContent className="w-full max-w-full overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="sr-only">
            <SheetTitle>{selectedUser ? `${selectedUser.name} details` : "User details"}</SheetTitle>
            <SheetDescription>
              Inspect role assignment, access status, and override access for the selected admin user.
            </SheetDescription>
          </SheetHeader>
          <UserDetailPanel key={`${selectedUser?.id ?? "empty"}-sheet`} user={selectedUser} roles={roleOptions} />
        </SheetContent>
      </Sheet>
    </section>
  );
}