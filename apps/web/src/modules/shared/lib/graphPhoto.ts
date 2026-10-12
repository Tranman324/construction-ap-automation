// Graph API photo URL builder.
// SCOPE WARNING: The current NextAuth config has scope: "openid profile email User.Read"
// which only permits reading the signed-in user's own photo, not other users' photos.
// For cross-user photo lookup, User.ReadBasic.All must be added to the authorization
// scope in src/app/api/auth/[...nextauth]/route.ts.
// MVP DECISION: avatar_url in mock/users.ts uses ui-avatars.com fallback URLs.
// This function is provided for future use when the scope is expanded.
export function getUserPhotoUrl(azureId: string): string {
  return `https://graph.microsoft.com/v1.0/users/${azureId}/photo/$value`;
}

export type GraphUserPhotoSize = "48x48" | "64x64" | "96x96" | "120x120" | "240x240" | "360x360" | "432x432" | "504x504" | "648x648";

interface BackendUserPhotoUrlOptions {
  size?: GraphUserPhotoSize;
}

export function getBackendUserPhotoUrl(userId: string, options: BackendUserPhotoUrlOptions = {}): string {
  const path = `/api/backend/users/${userId}/photo`;

  if (!options.size) {
    return path;
  }

  return `${path}?${new URLSearchParams({ size: options.size }).toString()}`;
}

export function getFallbackAvatarUrl(name: string): string {
  const params = new URLSearchParams({
    name,
    background: '0f2c4f',
    color: 'ffffff',
    size: '128',
    rounded: 'true',
    bold: 'true',
  });

  return `https://ui-avatars.com/api/?${params.toString()}`;
}