import { Clock3, Users } from "lucide-react";

import { formatAdminLastLogin, getAdminUserAvatarUrl, getAdminUserRoleLabel } from "@/modules/platform-admin/lib/adminUsers";
import type { AdminUser } from "@/modules/platform-admin/types/admin";
import { UserAvatar } from "@/modules/shared/components/UserAvatar";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/modules/shared/components/ui/card";

export function UserDetailEmptyState() {
  return (
    <Card data-testid="user-detail-empty" className="border-border/60 bg-card/90 shadow-sm shadow-primary/5">
      <CardHeader className="px-5 py-5">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-primary/10 bg-primary/[0.07] text-primary">
          <Users className="h-4 w-4" />
        </div>
        <CardTitle className="text-base">Select a user</CardTitle>
        <CardDescription>Choose a row to inspect role assignment, activity status, and override access.</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function UserDetailSummary({ user, isActive }: { user: AdminUser; isActive: boolean }) {
  return (
    <>
      <CardHeader className="gap-4 border-b border-border/50 px-5 py-5">
        <div className="flex items-start gap-3">
          <UserAvatar user={{ name: user.name, image: getAdminUserAvatarUrl(user) }} size="xl" />
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base text-foreground">{user.name}</CardTitle>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            <p className="text-xs font-bold text-foreground">{user.job_title ?? "No job title on file"}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={isActive ? "default" : "outline"}>{isActive ? "Active" : "Inactive"}</Badge>
          <Badge variant="outline">{getAdminUserRoleLabel(user)}</Badge>
          <Badge variant="outline">Role v{user.role_version}</Badge>
        </div>
      </CardHeader>
      <div className="mx-5 mt-5 grid gap-3 rounded-xl border border-border/50 bg-background/70 p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Current access</span>
          <span className="font-medium text-foreground">{getAdminUserRoleLabel(user)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Last login
          </span>
          <span className="font-medium text-foreground">{formatAdminLastLogin(user.last_login_at)}</span>
        </div>
      </div>
    </>
  );
}