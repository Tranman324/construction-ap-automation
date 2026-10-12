"use client";

import type { ComponentType } from "react";
import { useSearchParams } from "next/navigation";

import {
  AdminHeader,
} from "@/modules/platform-admin/components/AdminHeader";
import { AdminOverview } from "@/modules/platform-admin/components/AdminOverview";
import { RolePermissionsSection } from "@/modules/platform-admin/components/RolePermissionsSection";
import { RolesSection } from "@/modules/platform-admin/components/RolesSection";
import { TitleRulesSection } from "@/modules/platform-admin/components/TitleRulesSection";
import { UserOverridesSection } from "@/modules/platform-admin/components/UserOverridesSection";
import { UsersSection } from "@/modules/platform-admin/components/UsersSection";
import {
  ADMIN_SECTION_QUERY_PARAM,
  ADMIN_USER_ID_QUERY_PARAM,
  normalizeAdminSection,
  type AdminSectionId,
} from "@/modules/platform-admin/lib/constants";

interface AdminSectionComponentProps {
  userId?: string | null;
}

const SECTION_COMPONENTS: Record<AdminSectionId, ComponentType<AdminSectionComponentProps>> = {
  overview: AdminOverview,
  users: UsersSection,
  roles: RolesSection,
  "role-perms": RolePermissionsSection,
  overrides: UserOverridesSection,
  rules: TitleRulesSection,
};

export function AdminPanel() {
  const searchParams = useSearchParams();
  const sectionId = normalizeAdminSection(searchParams.get(ADMIN_SECTION_QUERY_PARAM));
  const SectionComponent = SECTION_COMPONENTS[sectionId];
  const userId =
    sectionId === "overrides"
      ? searchParams.get(ADMIN_USER_ID_QUERY_PARAM)?.trim() || null
      : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gradient-to-b from-primary/[0.03] via-background to-background">
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <AdminHeader sectionId={sectionId} />
          <SectionComponent userId={userId} />
        </div>
      </div>
    </div>
  );
}