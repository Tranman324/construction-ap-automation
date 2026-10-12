import {
  getBackendUserPhotoUrl,
  getFallbackAvatarUrl,
  type GraphUserPhotoSize,
} from "@/modules/shared/lib/graphPhoto";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PLATFORM_PROFILE_PHOTO_SIZE: GraphUserPhotoSize = "648x648";

/**
 * Common display fallbacks for nullable profile fields.
 * Components choose the appropriate fallback for their context.
 */
export const PLATFORM_PROFILE_FALLBACKS = {
  jobTitle: "No job title on file",
  jobTitleShort: "No title",
  lastLogin: "Never",
  lastLoginInvalid: "Unknown",
  role: "Unassigned",
  phone: "—",
} as const;

// ─── Interfaces ───────────────────────────────────────────────────────────────

/**
 * Minimum shape required for platform-level user profile normalization.
 * All fields beyond `id` are optional — modules pass their full user type
 * and the normalizer enriches only the fields present.
 */
export interface PlatformUserProfileSource {
  id: string;
  azure_id?: string | null;
  avatar_url?: string | null;
  name?: string | null;
  email?: string | null;
  job_title?: string | null;
  phone?: string | null;
  last_login_at?: string | null;
}

export interface ResolvePlatformUserPhotoOptions {
  preferredSize?: GraphUserPhotoSize;
  fallbackToGeneratedAvatar?: boolean;
}

export interface NormalizePlatformUserOptions extends ResolvePlatformUserPhotoOptions {
  /** When true, normalizes email to lowercase. Defaults to true. */
  lowercaseEmail?: boolean;
}

// ─── Photo Resolution (existing) ─────────────────────────────────────────────

function addPhotoSize(url: string, preferredSize?: GraphUserPhotoSize): string {
  if (!preferredSize || !url.startsWith("/api/backend/users/") || !url.includes("/photo")) {
    return url;
  }

  const [path, queryString = ""] = url.split("?");
  const params = new URLSearchParams(queryString);
  params.set("size", preferredSize);

  return `${path}?${params.toString()}`;
}

function normalizePhotoUrl(avatarUrl: string | null | undefined, preferredSize?: GraphUserPhotoSize): string {
  const trimmedAvatarUrl = avatarUrl?.trim() ?? "";

  if (!trimmedAvatarUrl) {
    return "";
  }

  const normalizedUrl = trimmedAvatarUrl.startsWith("/api/backend/")
    ? trimmedAvatarUrl
    : trimmedAvatarUrl.replace(/^\/api\//, "/api/backend/");

  return addPhotoSize(normalizedUrl, preferredSize);
}

export function resolvePlatformUserPhotoUrl(
  user: PlatformUserProfileSource,
  options: ResolvePlatformUserPhotoOptions = {},
): string | null {
  const explicitAvatarUrl = normalizePhotoUrl(user.avatar_url, options.preferredSize);

  if (explicitAvatarUrl) {
    return explicitAvatarUrl;
  }

  const photoIdentity = user.azure_id?.trim() || user.id.trim();

  if (photoIdentity) {
    return getBackendUserPhotoUrl(photoIdentity, { size: options.preferredSize });
  }

  const displayName = user.name?.trim() ?? "";

  return options.fallbackToGeneratedAvatar && displayName ? getFallbackAvatarUrl(displayName) : null;
}

export function resolvePlatformUserProfile<TUser extends PlatformUserProfileSource>(
  user: TUser,
  options: ResolvePlatformUserPhotoOptions = {},
): TUser & { avatar_url: string | null } {
  return {
    ...user,
    avatar_url: resolvePlatformUserPhotoUrl(user, options),
  };
}

// ─── String Field Normalization ───────────────────────────────────────────────

/** Trim a nullable string, converting empty/whitespace-only to null. */
export function normalizeProfileString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

/** Trim and lowercase a nullable email string. */
export function normalizeProfileEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

// ─── Display Formatters ───────────────────────────────────────────────────────

const platformDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * Format a last_login_at ISO timestamp for display.
 * Returns the configured fallbacks for null/invalid values.
 */
export function formatPlatformLastLogin(iso: string | null | undefined): string {
  if (!iso) {
    return PLATFORM_PROFILE_FALLBACKS.lastLogin;
  }

  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? PLATFORM_PROFILE_FALLBACKS.lastLoginInvalid : platformDateFormatter.format(value);
}

/**
 * Get a display-ready job title with configurable fallback.
 */
export function formatPlatformJobTitle(
  jobTitle: string | null | undefined,
  fallback: string = PLATFORM_PROFILE_FALLBACKS.jobTitle,
): string {
  const normalized = normalizeProfileString(jobTitle);
  return normalized ?? fallback;
}

/**
 * Get a display-ready phone number with configurable fallback.
 */
export function formatPlatformPhone(
  phone: string | null | undefined,
  fallback: string = PLATFORM_PROFILE_FALLBACKS.phone,
): string {
  const normalized = normalizeProfileString(phone);
  return normalized ?? fallback;
}

// ─── Full Profile Normalization ───────────────────────────────────────────────

/**
 * Normalize all common platform user profile fields.
 * Trims strings, lowercases email, converts empty strings to null,
 * and resolves avatar_url through the photo pipeline.
 *
 * Generic — preserves the caller's full type while enriching common fields.
 */
export function normalizePlatformUser<TUser extends PlatformUserProfileSource>(
  user: TUser,
  options: NormalizePlatformUserOptions = {},
): TUser & { avatar_url: string | null } {
  const { lowercaseEmail = true, ...photoOptions } = options;

  const normalized: Partial<PlatformUserProfileSource> = {
    avatar_url: resolvePlatformUserPhotoUrl(user, photoOptions),
  };

  if ("name" in user && user.name !== undefined) {
    normalized.name = normalizeProfileString(user.name);
  }

  if ("email" in user && user.email !== undefined) {
    normalized.email = lowercaseEmail
      ? normalizeProfileEmail(user.email)
      : normalizeProfileString(user.email);
  }

  if ("job_title" in user && user.job_title !== undefined) {
    normalized.job_title = normalizeProfileString(user.job_title);
  }

  if ("phone" in user && user.phone !== undefined) {
    normalized.phone = normalizeProfileString(user.phone);
  }

  return { ...user, ...normalized } as TUser & { avatar_url: string | null };
}
