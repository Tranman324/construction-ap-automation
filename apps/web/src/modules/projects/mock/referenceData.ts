// ─── Mock Reference Data ─────────────────────────────────────────────────────
// Customer list, SOV divisions, and org constants.
// Future: replaced by Spectrum / CRM API endpoints.

// ─── Organization Constants ──────────────────────────────────────────────────

export const ORG_NAME = 'Northwind Contracting Group';
export const DEFAULT_RETAINAGE_PERCENT = 10;

// ─── Customer Options ────────────────────────────────────────────────────────

export const CUSTOMER_OPTIONS = [
  'Kinsley Properties',
  'Riverside Market LLC',
  'Graystone Living',
  'Harbor Hospitality',
  'Allied Southeast',
];

// ─── Schedule of Values (SOV) Divisions ──────────────────────────────────────

export interface SovItem {
  code: string;
  description: string;
}

export const SOV_ITEMS: SovItem[] = [
  { code: '01', description: 'Permitting & Fees' },
  { code: '02', description: 'Demolition' },
  { code: '03', description: 'Concrete & Masonry' },
  { code: '04', description: 'Metals' },
  { code: '05', description: 'Rough Carpentry' },
  { code: '06', description: 'Millwork' },
  { code: '07', description: 'Thermal & Moisture' },
  { code: '08', description: 'Doors, Frames, Hardware' },
  { code: '09', description: 'Glass, Glazing, Curtain Wall' },
  { code: '10', description: 'Drywall & Ceilings' },
  { code: '11', description: 'Marble & Stone' },
  { code: '12', description: 'Flooring' },
  { code: '13', description: 'Painting & Wall Coverings' },
  { code: '14', description: 'Specialties' },
  { code: '15', description: 'Equipment' },
  { code: '16', description: 'Elevators' },
  { code: '17', description: 'Fire Protection' },
  { code: '18', description: 'Plumbing' },
  { code: '19', description: 'HVAC' },
  { code: '20', description: 'Electrical' },
  { code: '21', description: 'Fire Alarm' },
  { code: '22', description: 'General Conditions' },
  { code: '23', description: 'Profit & Overhead' },
  { code: 'AA1', description: 'Add Alternate 1' },
  { code: 'AA2', description: 'Add Alternate 2' },
  { code: 'AA3', description: 'Add Alternate 3' },
  { code: 'AA4', description: 'Add Alternate 4' },
  { code: 'AA5', description: 'Add Alternate 5' },
  { code: 'AA6', description: 'Add Alternate 6' },
  { code: 'VA1', description: 'Voluntary Alternate 1' },
  { code: 'VA2', description: 'Voluntary Alternate 2' },
  { code: 'VA3', description: 'Voluntary Alternate 3' },
  { code: 'VA4', description: 'Voluntary Alternate 4' },
  { code: 'VA5', description: 'Voluntary Alternate 5' },
  { code: 'VA6', description: 'Voluntary Alternate 6' },
  { code: 'VE1', description: 'VE Alternate 1' },
  { code: 'VE2', description: 'VE Alternate 2' },
  { code: 'VE3', description: 'VE Alternate 3' },
];
