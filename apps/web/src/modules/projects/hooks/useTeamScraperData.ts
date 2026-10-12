import { useQuery } from '@tanstack/react-query';

export interface TeamScraperData {
  submittals: { open: number; approved: number; total: number };
  rfis: { open: number; closed: number };
  dailyLog: { lastCompleted: string; streak: number };
  photos: string[];
}

export function useTeamScraperData(projectId: string) {
  return useQuery<TeamScraperData | null>({
    queryKey: ['project-team-scraper', projectId],
    enabled: !!projectId,
    staleTime: 60_000,
    // TODO: Replace with Viewpoint Team scraper API
    queryFn: async () => {
      const { getTeamScraperData } = await import('@/modules/projects/mock/index');
      return getTeamScraperData(projectId);
    },
  });
}
