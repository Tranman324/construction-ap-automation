// ─── Mock Team Scraper / Viewpoint Data ──────────────────────────────────────
// Per-project submittals, RFIs, daily log streaks, and photo URLs.
// Future: replaced by Viewpoint Team scraper API.

export interface TeamScraperData {
  submittals: { open: number; approved: number; total: number };
  rfis: { open: number; closed: number };
  dailyLog: { lastCompleted: string; streak: number };
  photos: string[];
}

const mockTeamScraperData: Record<string, TeamScraperData> = {
  '31-107': { submittals: { open: 0, approved: 0, total: 0 }, rfis: { open: 0, closed: 0 }, dailyLog: { lastCompleted: '—', streak: 0 }, photos: [] },
  '31-112': { submittals: { open: 1, approved: 2, total: 3 }, rfis: { open: 1, closed: 0 }, dailyLog: { lastCompleted: '2026-03-28', streak: 2 }, photos: [] },
  '31-118': { submittals: { open: 4, approved: 18, total: 22 }, rfis: { open: 3, closed: 12 }, dailyLog: { lastCompleted: '2026-04-08', streak: 14 }, photos: [] },
  '31-121': { submittals: { open: 3, approved: 12, total: 15 }, rfis: { open: 2, closed: 8 }, dailyLog: { lastCompleted: '2026-04-08', streak: 5 }, photos: [] },
  '31-126': { submittals: { open: 2, approved: 24, total: 26 }, rfis: { open: 1, closed: 15 }, dailyLog: { lastCompleted: '2026-04-07', streak: 9 }, photos: [] },
  '31-130': { submittals: { open: 0, approved: 31, total: 31 }, rfis: { open: 0, closed: 19 }, dailyLog: { lastCompleted: '2026-03-25', streak: 0 }, photos: [] },
  '31-133': { submittals: { open: 5, approved: 14, total: 19 }, rfis: { open: 4, closed: 6 }, dailyLog: { lastCompleted: '2026-04-08', streak: 7 }, photos: [] },
  '31-137': { submittals: { open: 0, approved: 28, total: 28 }, rfis: { open: 0, closed: 22 }, dailyLog: { lastCompleted: '2026-02-15', streak: 0 }, photos: [] },
  '31-140': { submittals: { open: 0, approved: 19, total: 19 }, rfis: { open: 0, closed: 11 }, dailyLog: { lastCompleted: '2026-01-10', streak: 0 }, photos: [] },
  '31-144': { submittals: { open: 0, approved: 8, total: 8 }, rfis: { open: 0, closed: 5 }, dailyLog: { lastCompleted: '2025-12-20', streak: 0 }, photos: [] },
  '32-301': { submittals: { open: 0, approved: 15, total: 15 }, rfis: { open: 0, closed: 9 }, dailyLog: { lastCompleted: '2025-11-30', streak: 0 }, photos: [] },
  '32-303': { submittals: { open: 0, approved: 22, total: 22 }, rfis: { open: 0, closed: 14 }, dailyLog: { lastCompleted: '2025-10-15', streak: 0 }, photos: [] },
  '32-305': { submittals: { open: 0, approved: 10, total: 10 }, rfis: { open: 0, closed: 7 }, dailyLog: { lastCompleted: '2025-09-28', streak: 0 }, photos: [] },
};

export function getTeamScraperData(projectId: string): TeamScraperData | null {
  return mockTeamScraperData[projectId] ?? null;
}
