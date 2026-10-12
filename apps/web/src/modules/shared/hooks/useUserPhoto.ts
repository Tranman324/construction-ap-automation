import { useQuery } from '@tanstack/react-query';
import { getUserPhotoUrl } from '@/modules/shared/lib/graphPhoto';

export function useUserPhoto(azureId: string | null | undefined) {
  return useQuery<string | null>({
    queryKey: ['user-photo', azureId],
    queryFn: async () => {
      // STUB: Graph API photo fetch requires access_token in the NextAuth session.
      // The current jwt callback in src/app/api/auth/[...nextauth]/route.ts does not
      // persist access_token to the session. To enable real photo fetching:
      //   1. Add `if (account?.access_token) token.accessToken = account.access_token;` to jwt callback
      //   2. Extend next-auth.d.ts to include accessToken on session.user
      //   3. Replace this stub with: fetch(getUserPhotoUrl(azureId), { headers: { Authorization: `Bearer ${session.accessToken}` } })
      //      then convert response to blob URL via URL.createObjectURL(await response.blob())
      // For MVP: UserAvatar renders initials fallback when image is null.
      void getUserPhotoUrl; // reference to prevent unused import warning
      return null;
    },
    enabled: !!azureId,
    staleTime: 60 * 60 * 1000, // 1 hour — photo URLs are stable
  });
}