"use client"

import { toast } from "sonner"

import { FormSection } from "@/modules/shared/components/patterns/FormSection"
import { Field } from "@/modules/shared/components/patterns/Field"
import { SaveBar } from "@/modules/shared/components/patterns/SaveBar"
import { Input } from "@/modules/shared/components/ui/input"

import { useProfileForm } from "@/modules/settings/hooks/useProfileForm"
import type { ProfileValues } from "@/modules/settings/types"

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProfileSectionProps {
  initialValues?: Partial<ProfileValues>
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ProfileSection — first consumer of the DS form pattern components.
 * Demonstrates Field (with dirty/optional/success), FormSection (2-col grid),
 * and SaveBar (sticky with dirtyCount) working together.
 */
export function ProfileSection({ initialValues }: ProfileSectionProps) {
  const { values, setField, errors, touch, validateAll, isDirty, dirtyCount, markClean, discard } =
    useProfileForm(initialValues)

  function handleSave() {
    const valid = validateAll()
    if (!valid) return
    // TODO: wire to real mutation when Settings API is implemented
    setTimeout(() => {
      markClean()
      toast.success("Profile saved", {
        description: "Your display name and contact info have been updated.",
      })
    }, 600)
  }

  return (
    <>
      <FormSection
        title="Profile"
        description="How you appear to other team members"
      >
        <Field
          label="Display name"
          htmlFor="settings-display-name"
          required
          dirty={isDirty}
          error={errors.displayName}
          hint="Shown on invoices and team views"
        >
          <Input
            id="settings-display-name"
            value={values.displayName}
            onChange={(e) => setField("displayName", e.target.value)}
            onBlur={() => touch("displayName")}
            placeholder="Your name"
          />
        </Field>

        <Field
          label="Email"
          htmlFor="settings-email"
          required
          dirty={isDirty}
          error={errors.email}
        >
          <Input
            id="settings-email"
            type="email"
            value={values.email}
            onChange={(e) => setField("email", e.target.value)}
            onBlur={() => touch("email")}
            placeholder="you@northwindcg.example"
          />
        </Field>

        <Field
          label="Title"
          htmlFor="settings-title"
          optional
          error={errors.title}
          hint="e.g. Project Manager, AP Coordinator"
        >
          <Input
            id="settings-title"
            value={values.title}
            onChange={(e) => setField("title", e.target.value)}
            onBlur={() => touch("title")}
            placeholder="Your role"
          />
        </Field>
      </FormSection>

      {isDirty && (
        <SaveBar
          dirtyCount={dirtyCount}
          message="Unsaved profile changes"
          onSave={handleSave}
          onDiscard={discard}
        />
      )}
    </>
  )
}
