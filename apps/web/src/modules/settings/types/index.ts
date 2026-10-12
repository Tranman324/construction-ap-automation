// ─── Settings domain types ────────────────────────────────────────────────────

export type SettingsSection = "profile" | "notifications" | "display" | "security"

export interface ProfileValues {
  displayName: string
  email: string
  title: string
}

export interface NotificationValues {
  emailDigest: boolean
  invoiceAlerts: boolean
  systemUpdates: boolean
}

export interface DisplayValues {
  theme: "light" | "dark"
  compactTables: boolean
}

export interface SecurityValues {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}
