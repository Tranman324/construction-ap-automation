import { getAdminSectionLabel, type AdminSectionId } from "@/modules/platform-admin/lib/constants";
import { PlatformSectionHeader } from "@/modules/shared/components/patterns";

interface AdminHeaderProps {
  sectionId: AdminSectionId;
}

export function AdminHeader({ sectionId }: AdminHeaderProps) {
  return (
    <PlatformSectionHeader
      title="ADMIN PANEL"
      accentLabel={getAdminSectionLabel(sectionId).toUpperCase()}
      pulseTestId="admin-header-pulse"
    />
  );
}
