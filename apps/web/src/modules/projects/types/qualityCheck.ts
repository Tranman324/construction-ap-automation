// ─── Job Site Quality Check ────────────────────────────────────────────────

export type QCRating = 1 | 2 | 3 | 4 | 5;

export interface QCCategory {
  rating: QCRating;
  notes: string;
  photo_urls: string[];
}

export interface QCActionItem {
  id: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assigned_to: string | null;
  due_date: string | null;
  resolved: boolean;
  resolved_at: string | null;
}

export interface QualityCheck {
  id: string;
  project_id: string;
  completed_by: string;
  completed_at: string;
  overall_score: number;           // 1−5, derived average
  safety_ppe: QCCategory;
  site_conditions: QCCategory;
  issues_concerns: QCCategory;
  other_notes: QCCategory;
  action_items: QCActionItem[];
  weather: string;
  crew_count: number | null;
}

export const QC_RATING_LABELS: Record<QCRating, string> = {
  1: 'Critical',
  2: 'Poor',
  3: 'Acceptable',
  4: 'Good',
  5: 'Excellent',
};

export const QC_RATING_COLORS: Record<QCRating, { text: string; bg: string }> = {
  1: { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30' },
  2: { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  3: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
  4: { text: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' },
  5: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
};
