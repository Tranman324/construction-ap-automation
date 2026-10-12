import type {
  CloseoutProject,
  TradeCloseout,
  DocStatus,
  DocField,
} from '@/modules/projects/types/closeout';

// ─── Completion Calculation ──────────────────────────────────────────────────
// N/A items are excluded from both numerator and denominator (shrinks total,
// moves completion % toward 100%).

/** Count applicable (non-null, non-na) and received docs for a trade */
export function tradeDocCounts(tc: TradeCloseout): { total: number; received: number } {
  const fields: DocField[] = ['asBuilts', 'om', 'tab', 'warranty', 'finalLienWaiver'];
  let total = 0;
  let received = 0;
  for (const f of fields) {
    const val = tc[f] as DocStatus | null;
    if (val === null || val === 'na') continue;
    total++;
    if (val === 'received') received++;
  }
  return { total, received };
}

/** Compute completion % for a trade (0-100) */
export function tradeCompletionPct(tc: TradeCloseout): number {
  const { total, received } = tradeDocCounts(tc);
  return total === 0 ? 100 : Math.round((received / total) * 100);
}

/** Compute overall project completion % */
export function projectCompletionPct(project: CloseoutProject): number {
  let total = 0;
  let completed = 0;

  // General checklist: 7 items, all binary
  const gc = project.generalChecklist;
  const gcKeys = Object.keys(gc) as (keyof typeof gc)[];
  total += gcKeys.length;
  completed += gcKeys.filter((k) => gc[k].complete).length;

  // Trade docs
  for (const tc of project.trades) {
    const counts = tradeDocCounts(tc);
    total += counts.total;
    completed += counts.received;
  }

  // Lien waivers
  total += project.lienWaivers.length;
  completed += project.lienWaivers.filter((lw) => lw.received).length;

  return total === 0 ? 100 : Math.round((completed / total) * 100);
}

/** Cycle doc status: pending → requested → received → na → pending */
export function cycleDocStatus(current: DocStatus): DocStatus {
  const order: DocStatus[] = ['pending', 'requested', 'received', 'na'];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

/** Status color info for rendering */
export function docStatusColor(status: DocStatus): {
  bg: string;
  text: string;
  label: string;
} {
  switch (status) {
    case 'received':
      return { bg: 'bg-emerald-500', text: 'text-white', label: 'Received' };
    case 'pending':
      return { bg: 'bg-amber-400', text: 'text-amber-900', label: 'Pending' };
    case 'requested':
      return { bg: 'bg-blue-500', text: 'text-white', label: 'Requested' };
    case 'na':
      return { bg: 'bg-gray-200 dark:bg-gray-700', text: 'text-gray-500 dark:text-gray-400', label: 'N/A' };
  }
}
