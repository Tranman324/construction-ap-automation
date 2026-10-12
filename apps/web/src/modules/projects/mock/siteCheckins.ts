// ─── Mock Site Check-In Data ─────────────────────────────────────────────────
// Represents daily personnel check-ins for each project job site.

export interface DailyCheckin {
  date: string;   // ISO date string (day only)
  count: number;  // Number of personnel checked in that day
}

export interface SiteCheckinSummary {
  project_id: string;
  todayCount: number;
  yesterdayCount: number;
  weekAvg: number;
  trend: DailyCheckin[];  // Last 30 days
}

function generateTrend(baseCount: number, volatility: number): DailyCheckin[] {
  const trend: DailyCheckin[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayOfWeek = d.getDay();
    // Weekends are lower
    const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.2 : 1;
    const noise = Math.round((Math.random() - 0.5) * volatility * 2);
    const count = Math.max(0, Math.round(baseCount * weekendFactor + noise));
    trend.push({
      date: d.toISOString().split('T')[0],
      count,
    });
  }
  return trend;
}

const mockCheckins: SiteCheckinSummary[] = [
  { project_id: '31-107', todayCount: 0, yesterdayCount: 0, weekAvg: 0, trend: generateTrend(0, 0) },
  { project_id: '31-112', todayCount: 4, yesterdayCount: 3, weekAvg: 3, trend: generateTrend(3, 2) },
  { project_id: '31-118', todayCount: 14, yesterdayCount: 12, weekAvg: 11, trend: generateTrend(12, 4) },
  { project_id: '31-121', todayCount: 22, yesterdayCount: 19, weekAvg: 18, trend: generateTrend(18, 6) },
  { project_id: '31-126', todayCount: 8, yesterdayCount: 10, weekAvg: 9, trend: generateTrend(9, 3) },
  { project_id: '31-130', todayCount: 16, yesterdayCount: 15, weekAvg: 14, trend: generateTrend(14, 5) },
  { project_id: '31-133', todayCount: 6, yesterdayCount: 8, weekAvg: 7, trend: generateTrend(7, 3) },
  { project_id: '31-137', todayCount: 3, yesterdayCount: 4, weekAvg: 5, trend: generateTrend(5, 2) },
  { project_id: '31-140', todayCount: 2, yesterdayCount: 3, weekAvg: 4, trend: generateTrend(4, 2) },
  { project_id: '31-144', todayCount: 0, yesterdayCount: 1, weekAvg: 2, trend: generateTrend(2, 1) },
];

export function getSiteCheckins(projectId: string): SiteCheckinSummary | null {
  return mockCheckins.find((c) => c.project_id === projectId) ?? null;
}
