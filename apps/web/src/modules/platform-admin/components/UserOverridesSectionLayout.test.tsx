import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserOverridesSectionLayout } from "@/modules/platform-admin/components/UserOverridesSectionLayout";
import type { AdminUser } from "@/modules/platform-admin/types/admin";

const users: AdminUser[] = [
  {
    id: "user-1",
    azure_id: null,
    email: "taylor@northwindcg.example",
    name: "Taylor One",
    role_id: "role-ops",
    is_active: true,
    job_title: "Project Engineer",
    phone: null,
    avatar_url: null,
    role_version: 3,
    last_login_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: null,
    role: { id: "role-ops", name: "Operations", description: null, is_system: false },
  },
];

describe("UserOverridesSectionLayout", () => {
  it("renders the header and user count", () => {
    render(
      <UserOverridesSectionLayout
        users={users}
        selectedUser={null}
        missingRequestedUserId={null}
        search=""
        showDataError={false}
        errorDescription=""
        showDataLoading={false}
        moduleEntries={[]}
        inheritedPermissions={new Set()}
        overrideModeMap={{}}
        summaryCounts={{ inheritedCount: 0, grantCount: 0, revokeCount: 0 }}
        canManagePermissions={true}
        isSaving={false}
        isDirty={false}
        feedback={null}
        onSearchChange={vi.fn()}
        onSelectUser={vi.fn()}
        onRetryData={vi.fn()}
        onModeChange={vi.fn()}
        onReset={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText(/explicit user permission overrides/i)).toBeInTheDocument();
    expect(screen.getByText(/1 users/i)).toBeInTheDocument();
  });
});