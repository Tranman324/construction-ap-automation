"use client"

import { FormPage } from "@/modules/shared/components/patterns/FormSection"
import { ProfileSection } from "@/modules/settings/components/ProfileSection"

// ─── SettingsPage ─────────────────────────────────────────────────────────────

/**
 * SettingsPage — Layer 4 shell.
 * Sections are added per-tab as they're built; Profile is first.
 * Vertical tab navigation (P2 VerticalTabs) will be composed in here.
 */
export function SettingsPage() {
  return (
    <FormPage
      title="Settings"
      description="Manage your account and workspace preferences"
    >
      <ProfileSection />
    </FormPage>
  )
}
