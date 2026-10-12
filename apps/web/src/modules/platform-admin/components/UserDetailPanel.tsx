"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { useUpdateAdminUser } from "@/modules/platform-admin/hooks/mutations";
import {
  type InlineFeedback,
  UserAccessStatusSection,
  UserRoleAssignmentSection,
} from "@/modules/platform-admin/components/UserDetailPanelSections";
import {
  UserDetailEmptyState,
  UserDetailSummary,
} from "@/modules/platform-admin/components/UserDetailPanelSummary";
import {
  buildAdminOverridesHref,
  isAdminEquivalentRole,
} from "@/modules/platform-admin/lib/adminUsers";
import { formatAdminRoleName } from "@/modules/platform-admin/lib/adminRoles";
import type { AdminRole, AdminUser } from "@/modules/platform-admin/types/admin";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/modules/shared/components/ui/alert-dialog";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Card,
  CardContent,
} from "@/modules/shared/components/ui/card";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";
import { useAuth } from "@/modules/shared/lib/auth";

interface UserDetailPanelProps {
  user: AdminUser | null;
  roles: AdminRole[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The update could not be saved. Try again.";
}

export function UserDetailPanel({ user, roles }: UserDetailPanelProps) {
  const router = useRouter();
  const { user: authUser } = useAuth();
  const { hasPermission } = usePermissions();
  const roleMutation = useUpdateAdminUser();
  const statusMutation = useUpdateAdminUser();
  const canManageUsers = hasPermission("platform.manage_users");
  const isSelf = !!user && user.id === authUser?.userId;

  const [selectedRoleId, setSelectedRoleId] = useState(user?.role_id ?? "");
  const [roleBaselineId, setRoleBaselineId] = useState(user?.role_id ?? "");
  const [isActive, setIsActive] = useState(user?.is_active ?? false);
  const [approvalConfirmation, setApprovalConfirmation] = useState("");
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const [roleFeedback, setRoleFeedback] = useState<InlineFeedback | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<InlineFeedback | null>(null);

  if (!user) {
    return <UserDetailEmptyState />;
  }

  const currentUser = user;

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const roleDirty = selectedRoleId.length > 0 && selectedRoleId !== roleBaselineId;
  const requiresEmailConfirmation = roleDirty && isAdminEquivalentRole(selectedRole);
  const roleDisabledReason = [
    !canManageUsers ? "Requires platform.manage_users." : "",
    isSelf ? "You cannot change your own role." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const statusDisabledReason = [
    !canManageUsers ? "Requires platform.manage_users." : "",
    isSelf ? "You cannot change your own active state." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const approvalMatches = approvalConfirmation.trim().toLowerCase() === "approved";
  const roleSaveDisabled =
    !!roleDisabledReason || !roleDirty || roleMutation.isPending || (requiresEmailConfirmation && !approvalMatches);
  const statusActionDisabled = !!statusDisabledReason || statusMutation.isPending;

  async function handleRoleSave() {
    if (roleSaveDisabled) {
      return;
    }

    try {
      await roleMutation.mutateAsync({ userId: currentUser.id, payload: { role_id: selectedRoleId } });
      setRoleBaselineId(selectedRoleId);
      setApprovalConfirmation("");
      setRoleFeedback({
        tone: "success",
        message: `Role updated to ${selectedRole ? formatAdminRoleName(selectedRole.name) : "the selected role"}.`,
      });
    } catch (error) {
      setRoleFeedback({ tone: "error", message: getErrorMessage(error) });
    }
  }

  async function handleStatusUpdate(nextActive: boolean) {
    if (statusActionDisabled) {
      return;
    }

    try {
      await statusMutation.mutateAsync({ userId: currentUser.id, payload: { is_active: nextActive } });
      setIsActive(nextActive);
      setConfirmDeactivateOpen(false);
      setStatusFeedback({
        tone: "success",
        message: nextActive ? "User access restored." : "User deactivated.",
      });
    } catch (error) {
      setStatusFeedback({ tone: "error", message: getErrorMessage(error) });
    }
  }

  return (
    <>
      <Card data-testid="user-detail-panel" className="border-border/60 bg-card/90 shadow-sm shadow-primary/5">
        <UserDetailSummary user={currentUser} isActive={isActive} />
        <CardContent className="space-y-5 px-5 py-5">
          <UserRoleAssignmentSection
            roles={roles}
            selectedRoleId={selectedRoleId}
            onRoleChange={setSelectedRoleId}
            requiresEmailConfirmation={requiresEmailConfirmation}
            approvalConfirmation={approvalConfirmation}
            onApprovalConfirmationChange={setApprovalConfirmation}
            roleDisabledReason={roleDisabledReason}
            roleSaveDisabled={roleSaveDisabled}
            isSaving={roleMutation.isPending}
            onSave={() => void handleRoleSave()}
            feedback={roleFeedback}
          />

          <UserAccessStatusSection
            isActive={isActive}
            statusDisabledReason={statusDisabledReason}
            isSaving={statusMutation.isPending}
            onDeactivate={() => setConfirmDeactivateOpen(true)}
            onReactivate={() => void handleStatusUpdate(true)}
            feedback={statusFeedback}
          />

          <Button
            data-testid="manage-overrides-button"
            variant="outline"
            size="sm"
            onClick={() => router.push(buildAdminOverridesHref(currentUser.id))}
          >
            <ArrowUpRight className="h-4 w-4" />
            Manage Overrides
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDeactivateOpen} onOpenChange={setConfirmDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Deactivate ${currentUser.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately prevents the user from signing in until access is restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleStatusUpdate(false)}
            >
              Confirm deactivation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}