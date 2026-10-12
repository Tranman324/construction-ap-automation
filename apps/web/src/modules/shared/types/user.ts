// ─── User Roles ──────────────────────────────────────────────────────────────

export interface UserRole {
  id: string;
  name: string;
  isSystem: boolean;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  azure_id: string | null;
  name: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  job_title: string | null;
  role_version: number;
  department?: string;
  phone?: string | null;
}