import type { Trade, DocField } from '@/modules/projects/types/closeout';

// ─── Master Trade List ───────────────────────────────────────────────────────
// Docs array defines which documents are tracked for each trade, derived from
// NCG's actual closeout spreadsheet patterns.

export const MASTER_TRADES: Trade[] = [
  { id: 'hvac',        name: 'HVAC',        color: '#0070C0', docs: ['asBuilts', 'om', 'tab', 'warranty', 'finalLienWaiver'] },
  { id: 'electrical',  name: 'Electrical',  color: '#FFD700', docs: ['asBuilts', 'om', 'warranty', 'finalLienWaiver'] },
  { id: 'plumbing',    name: 'Plumbing',    color: '#92D050', docs: ['asBuilts', 'om', 'warranty', 'finalLienWaiver'] },
  { id: 'fire-alarm',  name: 'Fire Alarm',  color: '#FF0000', docs: ['asBuilts', 'om', 'warranty', 'finalLienWaiver'] },
  { id: 'sprinkler',   name: 'Sprinkler',   color: '#FFC000', docs: ['asBuilts', 'om', 'warranty', 'finalLienWaiver'] },
  { id: 'glass',       name: 'Glass',       color: '#00B0F0', docs: ['warranty', 'finalLienWaiver'] },
  { id: 'millwork',    name: 'Millwork',    color: '#00B050', docs: ['warranty', 'finalLienWaiver'] },
  { id: 'flooring',    name: 'Flooring',    color: '#996633', docs: ['om', 'warranty', 'finalLienWaiver'] },
  { id: 'paint',       name: 'Paint',       color: '#FFCCFF', docs: ['om', 'warranty', 'finalLienWaiver'] },
  { id: 'low-voltage', name: 'Low Voltage', color: '#F56262', docs: ['asBuilts', 'warranty', 'finalLienWaiver'] },
];

const _tradeMap = new Map(MASTER_TRADES.map((t) => [t.id, t]));

export function getTradeById(id: string): Trade | undefined {
  return _tradeMap.get(id);
}

/** All possible doc field keys */
export const ALL_DOC_FIELDS: DocField[] = ['asBuilts', 'om', 'tab', 'warranty', 'finalLienWaiver'];
