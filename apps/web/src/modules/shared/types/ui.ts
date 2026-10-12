// ─── Status Colors ────────────────────────────────────────────────────────────

/** Maps each status string to a Tailwind color token string. */
export const StatusColor: Record<string, string> = {
  pending:          'text-yellow-600 bg-yellow-50',
  approved:         'text-green-600 bg-green-50',
  modified:         'text-blue-600 bg-blue-50',
  rejected:         'text-red-600 bg-red-50',
  discarded:        'text-gray-500 bg-gray-50',
  submitted:        'text-purple-600 bg-purple-50',
  'retry-pending':  'text-orange-600 bg-orange-50',
  duplicate:        'text-violet-600 bg-violet-50',
  reviewed:         'text-teal-600 bg-teal-50',
};
