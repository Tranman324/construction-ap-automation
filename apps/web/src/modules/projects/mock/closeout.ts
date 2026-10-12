import type {
  CloseoutProject,
  CloseoutProjectStatus,
  CloseoutGeneralChecklist,
  TradeCloseout,
  SubcontractorLienWaiver,
  DocStatus,
  DocField,
  CloseoutItem,
  CloseoutFilters,
} from '@/modules/projects/types/closeout';
import { MASTER_TRADES } from './trades';
import { projectCompletionPct } from '@/modules/projects/lib/closeoutHelpers';

// ─── PM ID Constants ─────────────────────────────────────────────────────────

const PM = {
  CB: '07ccb78a-f5b3-4fff-bd06-55af8cdcbfc2',
  CH: '5d5f1e7f-e189-4f51-88fe-f19688babd5c',
  CS: '3116a10f-449d-46bc-bbaf-20efd809daf9',
  DW: '363bccfb-c51a-4e2a-9b6b-f3b3d5181e36',
  JS: '3751c68d-8660-4bce-b24f-d400f8a5798d',
  LP: 'b4f8b0dc-cae1-4c1b-ab72-17e5436969e4',
} as const;

// ─── Builders ────────────────────────────────────────────────────────────────

let _tcId = 0;
let _lwId = 0;

function tc(
  projectId: string,
  tradeId: string,
  docs: Partial<Record<DocField, DocStatus>>,
  note?: string,
): TradeCloseout {
  const trade = MASTER_TRADES.find((t) => t.id === tradeId)!;
  return {
    id: `tc-${String(++_tcId).padStart(3, '0')}`,
    projectId,
    tradeId,
    trade,
    asBuilts: trade.docs.includes('asBuilts') ? (docs.asBuilts ?? 'pending') : null,
    om: trade.docs.includes('om') ? (docs.om ?? 'pending') : null,
    tab: trade.docs.includes('tab') ? (docs.tab ?? 'pending') : null,
    warranty: docs.warranty ?? 'pending',
    finalLienWaiver: docs.finalLienWaiver ?? 'pending',
    note: note ?? null,
  };
}

function gc(
  co: boolean, permit: boolean, sub: boolean, archive: boolean,
  attic: boolean, warranty: boolean, tenant: boolean,
  tenantNote?: string,
): CloseoutGeneralChecklist {
  return {
    changeOrder: { complete: co },
    permit: { complete: permit },
    subList: { complete: sub },
    viewpointArchive: { complete: archive },
    atticStockReport: { complete: attic },
    ncgWarranty: { complete: warranty },
    tenantAcceptance: { complete: tenant, note: tenantNote },
  };
}

function lw(projectId: string, name: string, received: boolean): SubcontractorLienWaiver {
  return { id: `lw-${String(++_lwId).padStart(3, '0')}`, projectId, subcontractorName: name, received };
}

const R: DocStatus = 'received';
const P: DocStatus = 'pending';
const Q: DocStatus = 'requested';

// ─── Projects with Real Spreadsheet Data ─────────────────────────────────────

const realProjects: CloseoutProject[] = [
  // ── 30-201 Alder Street Lofts ──
  {
    id: 'co-24-126', projectId: null, jobNumber: '30-201', jobName: 'Alder Street Lofts',
    pmId: PM.DW, status: 'active',
    generalChecklist: gc(false, false, true, false, false, true, true, 'Dan will send 2/25'),
    trades: [
      tc('co-24-126', 'electrical', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-24-126', 'glass', { warranty: R, finalLienWaiver: R }),
      tc('co-24-126', 'paint', { om: R, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-24-126', 'AK Glass', true), lw('co-24-126', 'voltline', false),
      lw('co-24-126', 'Structural Restorations', false), lw('co-24-126', 'VQD', false),
    ],
  },
  // ── 30-204 Birchwood Pediatrics ──
  {
    id: 'co-25-517', projectId: null, jobNumber: '30-204', jobName: 'Birchwood Pediatrics',
    pmId: PM.JS, status: 'active',
    generalChecklist: gc(false, true, true, false, false, false, false, 'JS will send 2/25'),
    trades: [
      tc('co-25-517', 'hvac', { asBuilts: R, om: P, tab: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-517', 'electrical', { asBuilts: P, om: P, warranty: R, finalLienWaiver: P }),
      tc('co-25-517', 'plumbing', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-517', 'sprinkler', { asBuilts: R, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-517', 'glass', { warranty: R, finalLienWaiver: P }),
      tc('co-25-517', 'millwork', { warranty: R, finalLienWaiver: P }),
      tc('co-25-517', 'flooring', { om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-517', 'paint', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-517', 'low-voltage', { asBuilts: P, warranty: P, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-517', 'Omega Glass', true), lw('co-25-517', 'Meridian Fire', false),
      lw('co-25-517', 'KQV', false), lw('co-25-517', 'Sam Ostrander', false),
      lw('co-25-517', 'Jx Electrical', false), lw('co-25-517', 'Spot On Plumbing', false),
      lw('co-25-517', 'KXM', false), lw('co-25-517', 'N&V Flooring', false),
      lw('co-25-517', 'VQD', false), lw('co-25-517', 'Keystone', false),
    ],
  },
  // ── 30-207 Copper Hollow Office ──
  {
    id: 'co-25-518', projectId: null, jobNumber: '30-207', jobName: 'Copper Hollow Office',
    pmId: PM.DW, status: 'active',
    generalChecklist: gc(true, true, true, false, false, true, true, 'Still with owner'),
    trades: [
      tc('co-25-518', 'hvac', { asBuilts: R, om: R, tab: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-518', 'electrical', { asBuilts: R, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-518', 'plumbing', { asBuilts: R, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-518', 'fire-alarm', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-518', 'sprinkler', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-518', 'millwork', { warranty: R, finalLienWaiver: P }),
      tc('co-25-518', 'paint', { om: R, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-518', 'Corvel', true), lw('co-25-518', 'Ashford Design', false),
      lw('co-25-518', 'Novus Electrical', false), lw('co-25-518', 'Heritage Mechanical', false),
      lw('co-25-518', 'QEP', false), lw('co-25-518', 'J&J Fire Protection', false),
      lw('co-25-518', 'VQD', false), lw('co-25-518', 'Pine Barrow', false),
      lw('co-25-518', 'Sparta Roofing', false),
    ],
  },
  // ── 30-210 Dunmore Supply Depot ──
  {
    id: 'co-25-521', projectId: null, jobNumber: '30-210', jobName: 'Dunmore Supply Depot',
    pmId: PM.JS, status: 'active',
    generalChecklist: gc(false, false, false, false, false, false, false, 'JS will send 2/25'),
    trades: [
      tc('co-25-521', 'hvac', { asBuilts: P, om: R, tab: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-521', 'electrical', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-521', 'plumbing', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-521', 'sprinkler', { asBuilts: P, om: P, warranty: P, finalLienWaiver: R }),
      tc('co-25-521', 'millwork', { warranty: R, finalLienWaiver: P }),
      tc('co-25-521', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-521', 'paint', { om: P, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-521', 'Meridian Fire', true), lw('co-25-521', 'CE Elite Plumbing', false),
      lw('co-25-521', 'Jx Electrical', false), lw('co-25-521', 'KXM', false),
      lw('co-25-521', 'VQD', false), lw('co-25-521', 'Keystone Mechanical', false),
      lw('co-25-521', 'Restora', false), lw('co-25-521', 'XLF', false), lw('co-25-521', 'WXS', false),
    ],
  },
  // ── 30-213 Elm Park Suite 101 ──
  {
    id: 'co-25-526', projectId: null, jobNumber: '30-213', jobName: 'Elm Park Suite 101',
    pmId: PM.CH, status: 'active',
    generalChecklist: gc(true, true, true, false, true, true, true),
    trades: [
      tc('co-25-526', 'hvac', { asBuilts: R, om: R, tab: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-526', 'electrical', { asBuilts: R, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-526', 'fire-alarm', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-526', 'sprinkler', { asBuilts: R, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-526', 'glass', { warranty: R, finalLienWaiver: P }),
      tc('co-25-526', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-526', 'paint', { om: R, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-526', 'LXD', true), lw('co-25-526', 'QRS Electrical', true),
      lw('co-25-526', 'PyroGuard', true), lw('co-25-526', 'G&EX', true),
      lw('co-25-526', 'Heritage Mechanical', true), lw('co-25-526', 'VQD', true),
      lw('co-25-526', 'QCF', true), lw('co-25-526', 'Signal Security', true),
    ],
  },
  // ── 30-216 Fernbrook Therapy East ──
  {
    id: 'co-25-530', projectId: null, jobNumber: '30-216', jobName: 'Fernbrook Therapy East',
    pmId: PM.CB, status: 'active',
    generalChecklist: gc(true, true, true, true, true, true, true),
    trades: [
      tc('co-25-530', 'hvac', { asBuilts: R, om: R, tab: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-530', 'electrical', { asBuilts: R, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-530', 'plumbing', { asBuilts: R, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-530', 'fire-alarm', { asBuilts: R, om: P, warranty: P, finalLienWaiver: Q }),
      tc('co-25-530', 'sprinkler', { asBuilts: R, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-530', 'glass', { warranty: R, finalLienWaiver: P }),
      tc('co-25-530', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-25-530', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-530', 'paint', { om: R, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-530', 'ZGM', false), lw('co-25-530', 'Ashford Design', false),
      lw('co-25-530', 'Meridian Fire', false), lw('co-25-530', 'CE Elite Plumbing', false),
      lw('co-25-530', 'Coating Applicators', false), lw('co-25-530', 'QRS', false),
      lw('co-25-530', 'Pine Barrow', false), lw('co-25-530', 'Keystone', false), lw('co-25-530', 'NV', false),
    ],
  },
  // ── 30-219 Glenview Studio ──
  {
    id: 'co-25-532', projectId: null, jobNumber: '30-219', jobName: 'Glenview Studio',
    pmId: PM.CH, status: 'active',
    generalChecklist: gc(false, false, true, false, false, true, true),
    trades: [
      tc('co-25-532', 'hvac', { asBuilts: P, om: R, tab: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-532', 'electrical', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-532', 'Regal Electric', true), lw('co-25-532', 'Keystone Mechanical', true),
      lw('co-25-532', 'Harborline Dock', true),
    ],
  },
  // ── 30-222 Hollis Labs Annex ──
  {
    id: 'co-25-535', projectId: null, jobNumber: '30-222', jobName: 'Hollis Labs Annex',
    pmId: PM.LP, status: 'active',
    generalChecklist: gc(false, false, true, false, false, true, false, 'LP sent to owner 04/08'),
    trades: [
      tc('co-25-535', 'hvac', { asBuilts: P, om: R, tab: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-535', 'electrical', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-535', 'plumbing', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-25-535', 'fire-alarm', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-25-535', 'sprinkler', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-25-535', 'glass', { warranty: P, finalLienWaiver: P }),
      tc('co-25-535', 'flooring', { om: P, warranty: P, finalLienWaiver: P }),
      tc('co-25-535', 'paint', { om: P, warranty: P, finalLienWaiver: P }),
    ],
    lienWaivers: [
      lw('co-25-535', 'Keystone Mechanical', true), lw('co-25-535', 'QRS Electrical', true),
      lw('co-25-535', 'Midland Roofing', false),
    ],
  },
  // ── 30-225 Ivy Lane Commons ──
  {
    id: 'co-25-537', projectId: null, jobNumber: '30-225', jobName: 'Ivy Lane Commons',
    pmId: PM.CB, status: 'active',
    generalChecklist: gc(true, true, true, true, false, false, false, 'Pine Barrow Requested'),
    trades: [
      tc('co-25-537', 'hvac', { asBuilts: P, om: P, tab: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-537', 'electrical', { asBuilts: R, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-537', 'plumbing', { asBuilts: R, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-537', 'fire-alarm', { asBuilts: P, om: P, warranty: P, finalLienWaiver: Q }),
      tc('co-25-537', 'sprinkler', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-537', 'glass', { warranty: R, finalLienWaiver: R }),
      tc('co-25-537', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-25-537', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-537', 'paint', { om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-537', 'low-voltage', { asBuilts: R, warranty: P, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-537', 'Nationwide Cabling', false), lw('co-25-537', 'CE Elite Plumbing', false),
      lw('co-25-537', 'G&EX', false), lw('co-25-537', 'Coating Applicators', false),
      lw('co-25-537', 'Thistle Electric', false), lw('co-25-537', 'Pine Barrow', false),
      lw('co-25-537', 'Keystone Mechanical', false), lw('co-25-537', 'Lark Interiors', false),
      lw('co-25-537', 'Prisma', false), lw('co-25-537', 'R&R Casework', false),
    ],
  },
  // ── 30-228 Juniper Therapy West ──
  {
    id: 'co-25-538', projectId: null, jobNumber: '30-228', jobName: 'Juniper Therapy West',
    pmId: PM.CB, status: 'active',
    generalChecklist: gc(true, true, true, true, true, true, false, 'CB to send 3/30'),
    trades: [
      tc('co-25-538', 'hvac', { asBuilts: R, om: R, tab: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-538', 'electrical', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-538', 'plumbing', { asBuilts: R, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-538', 'fire-alarm', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-25-538', 'sprinkler', { asBuilts: P, om: P, warranty: P, finalLienWaiver: R }),
      tc('co-25-538', 'glass', { warranty: R, finalLienWaiver: R }),
      tc('co-25-538', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-25-538', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-538', 'paint', { om: R, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-538', 'ZGM', true), lw('co-25-538', 'KXM', false),
      lw('co-25-538', 'Meridian Fire', false), lw('co-25-538', 'CE Elite Plumbing', false),
      lw('co-25-538', 'VQD', false), lw('co-25-538', 'QRS', false),
      lw('co-25-538', 'Keystone', false), lw('co-25-538', 'N&V', false), lw('co-25-538', 'WXS', false),
    ],
  },
  // ── 30-231 Kestrel Trust Office ──
  {
    id: 'co-25-544', projectId: null, jobNumber: '30-231', jobName: 'Kestrel Trust Office',
    pmId: PM.LP, status: 'active',
    generalChecklist: gc(true, true, true, true, true, true, false),
    trades: [
      tc('co-25-544', 'hvac', { asBuilts: P, om: P, tab: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-544', 'electrical', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-544', 'plumbing', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-544', 'fire-alarm', { asBuilts: R, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-25-544', 'sprinkler', { asBuilts: R, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-25-544', 'glass', { warranty: P, finalLienWaiver: P }),
      tc('co-25-544', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-25-544', 'paint', { om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-544', 'low-voltage', { asBuilts: R, warranty: P, finalLienWaiver: P }),
    ],
    lienWaivers: [
      lw('co-25-544', 'VQD', true), lw('co-25-544', 'LXD', true),
      lw('co-25-544', 'QRS', true), lw('co-25-544', 'QT', true),
      lw('co-25-544', 'KXM', false), lw('co-25-544', 'PRISMA', false),
      lw('co-25-544', 'SOP', true), lw('co-25-544', 'SENTINEL FIRE', false),
      lw('co-25-544', 'OMEGA GLASS', false), lw('co-25-544', 'NWX', false),
    ],
  },
  // ── 30-234 Larchmont Therapy North ──
  {
    id: 'co-25-552', projectId: null, jobNumber: '30-234', jobName: 'Larchmont Therapy North',
    pmId: PM.CS, status: 'active',
    generalChecklist: gc(true, true, true, true, true, true, false),
    trades: [
      tc('co-25-552', 'hvac', { asBuilts: R, om: R, tab: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-552', 'electrical', { asBuilts: R, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-552', 'plumbing', { asBuilts: R, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-552', 'sprinkler', { asBuilts: R, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-552', 'glass', { warranty: R, finalLienWaiver: R }),
      tc('co-25-552', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-25-552', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-552', 'paint', { om: P, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-552', 'Sentinel Fire', false), lw('co-25-552', 'QRS Electrical', false),
      lw('co-25-552', 'Ashford Designs', false), lw('co-25-552', 'CE Elite Plumbing', false),
      lw('co-25-552', 'G&EX', false), lw('co-25-552', 'Coating Applicators', false),
      lw('co-25-552', 'Keystone Mech', false), lw('co-25-552', 'XLF', false), lw('co-25-552', 'WXS', false),
    ],
  },
  // ── 30-237 Meadowbrook Engineering ──
  {
    id: 'co-25-554', projectId: null, jobNumber: '30-237', jobName: 'Meadowbrook Engineering',
    pmId: PM.CB, status: 'active',
    generalChecklist: gc(true, true, true, false, false, false, false),
    trades: [
      tc('co-25-554', 'hvac', { asBuilts: P, om: P, tab: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-554', 'electrical', { asBuilts: P, om: P, warranty: P, finalLienWaiver: R }),
      tc('co-25-554', 'plumbing', { asBuilts: P, om: P, warranty: P, finalLienWaiver: R }),
      tc('co-25-554', 'glass', { warranty: R, finalLienWaiver: R }),
      tc('co-25-554', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-25-554', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-554', 'paint', { om: P, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-554', 'QEP', true), lw('co-25-554', 'Keystone', false),
      lw('co-25-554', 'QRS', false), lw('co-25-554', 'Prisma', false),
      lw('co-25-554', 'Coating Applicators', false), lw('co-25-554', 'R&R Casework', false),
      lw('co-25-554', 'RZI', false), lw('co-25-554', 'WXS', false), lw('co-25-554', 'ZGM', false),
    ],
  },
  // ── 30-240 Northgate Data Room ──
  {
    id: 'co-25-555', projectId: null, jobNumber: '30-240', jobName: 'Northgate Data Room',
    pmId: PM.CB, status: 'active',
    generalChecklist: gc(true, true, true, false, false, false, false),
    trades: [
      tc('co-25-555', 'hvac', { asBuilts: R, om: R, tab: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-555', 'electrical', { asBuilts: P, om: P, warranty: P, finalLienWaiver: R }),
      tc('co-25-555', 'plumbing', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-555', 'glass', { warranty: R, finalLienWaiver: R }),
      tc('co-25-555', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-25-555', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-555', 'paint', { om: P, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-555', 'QEP', true), lw('co-25-555', 'Keystone', false),
      lw('co-25-555', 'QRS', false), lw('co-25-555', 'Prisma', false),
      lw('co-25-555', 'Coating Applicators', false), lw('co-25-555', 'R&R Casework', false),
      lw('co-25-555', 'RZI', false), lw('co-25-555', 'WXS', false), lw('co-25-555', 'ZGM', false),
    ],
  },
  // ── 30-243 Orchard Hill Office ──
  {
    id: 'co-25-556', projectId: null, jobNumber: '30-243', jobName: 'Orchard Hill Office',
    pmId: PM.LP, status: 'active',
    generalChecklist: gc(true, true, true, true, true, true, false, 'sent again 04/07'),
    trades: [
      tc('co-25-556', 'hvac', { asBuilts: P, om: P, tab: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-556', 'electrical', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-556', 'fire-alarm', { asBuilts: R, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-556', 'sprinkler', { asBuilts: R, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-556', 'glass', { warranty: R, finalLienWaiver: P }),
      tc('co-25-556', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-25-556', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-556', 'paint', { om: P, warranty: R, finalLienWaiver: Q }),
    ],
    lienWaivers: [
      lw('co-25-556', 'LXD', true), lw('co-25-556', 'QRS Electrical', false),
      lw('co-25-556', 'Suite Mechanical', false), lw('co-25-556', 'XLF', false),
      lw('co-25-556', 'Sentinel Fire', false), lw('co-25-556', 'ZGM', false),
      lw('co-25-556', 'R&R Casework', false), lw('co-25-556', 'Lark Interiors', false),
    ],
  },
  // ── 30-246 Northfield Added Scope ──
  {
    id: 'co-25-557', projectId: null, jobNumber: '30-246', jobName: 'Northfield Added Scope',
    pmId: PM.CH, status: 'active',
    generalChecklist: gc(false, false, false, false, false, false, true),
    trades: [
      tc('co-25-557', 'electrical', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-557', 'Regal Electric', true), lw('co-25-557', 'Harborline Dock', false),
    ],
  },
  // ── 30-249 Prairie View Clinic ──
  {
    id: 'co-25-559', projectId: null, jobNumber: '30-249', jobName: 'Prairie View Clinic',
    pmId: PM.CB, status: 'active',
    generalChecklist: gc(true, true, true, true, true, true, true),
    trades: [
      tc('co-25-559', 'hvac', { asBuilts: R, om: P, tab: P, warranty: P, finalLienWaiver: P }),
      tc('co-25-559', 'electrical', { asBuilts: R, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-25-559', 'plumbing', { asBuilts: P, om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-559', 'fire-alarm', { asBuilts: P, om: P, warranty: P, finalLienWaiver: Q }),
      tc('co-25-559', 'sprinkler', { asBuilts: P, om: P, warranty: P, finalLienWaiver: R }),
      tc('co-25-559', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-25-559', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-25-559', 'paint', { om: R, warranty: R, finalLienWaiver: R }),
    ],
    lienWaivers: [
      lw('co-25-559', 'Sentinel Fire', false), lw('co-25-559', 'Spot On Plumbing', false),
      lw('co-25-559', 'KX Painting', false), lw('co-25-559', 'Thistle Electric', false),
      lw('co-25-559', 'Pine Barrow', false), lw('co-25-559', 'Keystone Mechanical', false),
      lw('co-25-559', 'XLF', false), lw('co-25-559', 'R&R Casework', false), lw('co-25-559', 'LXD', false),
    ],
  },
  // ── 30-258 Harbor Point Annex ──
  {
    id: 'co-26-406', projectId: null, jobNumber: '30-258', jobName: 'Harbor Point Annex',
    pmId: PM.CS, status: 'active',
    generalChecklist: gc(false, true, true, true, false, false, false),
    trades: [
      tc('co-26-406', 'hvac', { asBuilts: P, om: P, tab: P, warranty: R, finalLienWaiver: R }),
      tc('co-26-406', 'electrical', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-406', 'plumbing', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-26-406', 'fire-alarm', { asBuilts: R, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-406', 'sprinkler', { asBuilts: P, om: P, warranty: P, finalLienWaiver: R }),
      tc('co-26-406', 'glass', { warranty: P, finalLienWaiver: P }),
      tc('co-26-406', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-26-406', 'flooring', { om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-406', 'paint', { om: P, warranty: P, finalLienWaiver: P }),
    ],
    lienWaivers: [
      lw('co-26-406', 'Meridian Fire', false), lw('co-26-406', 'Vantec Systems', false),
      lw('co-26-406', 'Coating Applicators', false), lw('co-26-406', 'Thistle Electric', false),
      lw('co-26-406', 'Prisma', false), lw('co-26-406', 'R&R', false),
      lw('co-26-406', 'Suite Mech', false), lw('co-26-406', 'Riverside Glass', false),
    ],
  },
  // ── 30-270 Upland Family Dental ──
  {
    id: 'co-26-412', projectId: null, jobNumber: '30-270', jobName: 'Upland Family Dental',
    pmId: PM.CB, status: 'active',
    generalChecklist: gc(false, false, true, true, true, true, false),
    trades: [
      tc('co-26-412', 'hvac', { asBuilts: P, om: P, tab: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-412', 'electrical', { asBuilts: P, om: P, warranty: R, finalLienWaiver: R }),
      tc('co-26-412', 'plumbing', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-412', 'fire-alarm', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-412', 'sprinkler', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-412', 'glass', { warranty: P, finalLienWaiver: P }),
      tc('co-26-412', 'millwork', { warranty: R, finalLienWaiver: R }),
      tc('co-26-412', 'flooring', { om: R, warranty: R, finalLienWaiver: R }),
      tc('co-26-412', 'paint', { om: P, warranty: P, finalLienWaiver: Q }),
    ],
    lienWaivers: [
      lw('co-26-412', 'RZI', false), lw('co-26-412', 'VQD', false),
      lw('co-26-412', 'XLF', false), lw('co-26-412', 'R&R', false), lw('co-26-412', 'Thistle', false),
    ],
  },
  // ── 30-273 Valemont Finance ──
  {
    id: 'co-26-413', projectId: null, jobNumber: '30-273', jobName: 'Valemont Finance',
    pmId: PM.LP, status: 'active',
    generalChecklist: gc(false, true, true, false, false, false, false),
    trades: [
      tc('co-26-413', 'hvac', { asBuilts: P, om: P, tab: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-413', 'electrical', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-413', 'plumbing', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-413', 'fire-alarm', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-413', 'sprinkler', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-413', 'glass', { warranty: P, finalLienWaiver: P }),
      tc('co-26-413', 'millwork', { warranty: P, finalLienWaiver: R }),
      tc('co-26-413', 'flooring', { om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-413', 'paint', { om: P, warranty: P, finalLienWaiver: P }),
    ],
    lienWaivers: [
      lw('co-26-413', 'XCI', false), lw('co-26-413', 'Precision Services', false),
      lw('co-26-413', 'Integrix', false), lw('co-26-413', 'ZGM', false),
      lw('co-26-413', 'KXM', false), lw('co-26-413', 'LARK', false),
      lw('co-26-413', 'Coating Applicators', true), lw('co-26-413', 'XLF', false),
      lw('co-26-413', 'Ironclad Fire Protection', false), lw('co-26-413', 'Halden Brookie', false),
      lw('co-26-413', 'Reid Calloway', false), lw('co-26-413', 'NWX', false),
    ],
  },
  // ── 31-126 Willow Creek Clinic ──
  {
    id: 'co-26-422', projectId: '31-126', jobNumber: '31-126', jobName: 'Willow Creek Clinic',
    pmId: PM.CS, status: 'active',
    generalChecklist: gc(false, false, true, true, false, false, false),
    trades: [
      tc('co-26-422', 'plumbing', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-422', 'flooring', { om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-422', 'paint', { om: P, warranty: P, finalLienWaiver: P }),
    ],
    lienWaivers: [
      lw('co-26-422', 'Spot On Plumbing', false), lw('co-26-422', 'VQD', false),
      lw('co-26-422', 'XLF', false),
    ],
  },
  // ── 30-276 Redwood 3rd Floor ──
  {
    id: 'co-26-429', projectId: null, jobNumber: '30-276', jobName: 'Redwood 3rd Floor',
    pmId: PM.LP, status: 'active',
    generalChecklist: gc(false, false, false, false, false, false, false),
    trades: [
      tc('co-26-429', 'hvac', { asBuilts: P, om: P, tab: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-429', 'electrical', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-429', 'plumbing', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-429', 'fire-alarm', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-429', 'sprinkler', { asBuilts: P, om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-429', 'glass', { warranty: P, finalLienWaiver: P }),
      tc('co-26-429', 'millwork', { warranty: P, finalLienWaiver: P }),
      tc('co-26-429', 'flooring', { om: P, warranty: P, finalLienWaiver: P }),
      tc('co-26-429', 'paint', { om: P, warranty: P, finalLienWaiver: P }),
    ],
    lienWaivers: [
      lw('co-26-429', 'LXD', false), lw('co-26-429', 'Regal Electric', false),
      lw('co-26-429', 'Suite Mechanical', false), lw('co-26-429', 'R & R Caseworks', false),
      lw('co-26-429', 'National Window Film', false), lw('co-26-429', 'Prisma Flooring', false),
      lw('co-26-429', 'VQD', false),
    ],
  },
];

// ─── Placeholder Projects (all trades pending, from spreadsheet) ─────────────

interface PlaceholderDef {
  jobNumber: string;
  jobName: string;
  pmId: string;
  linkedProjectId: string | null;
}

const placeholders: PlaceholderDef[] = [
  { jobNumber: '30-252', jobName: 'Quarry Point VSP', pmId: PM.JS, linkedProjectId: null },
  { jobNumber: '30-255', jobName: 'Redwood Phase 3', pmId: PM.LP, linkedProjectId: null },
  { jobNumber: '30-261', jobName: 'Stonegate Expansion', pmId: PM.JS, linkedProjectId: null },
  { jobNumber: '30-264', jobName: 'The Wexley', pmId: PM.CH, linkedProjectId: null },
  { jobNumber: '30-267', jobName: 'Tidewater Fabrication', pmId: PM.CH, linkedProjectId: null },
  { jobNumber: '31-144', jobName: 'Oakhurst Dental Suite', pmId: PM.JS, linkedProjectId: '31-144' },
  { jobNumber: '31-133', jobName: 'Northfield Training Center', pmId: PM.CH, linkedProjectId: '31-133' },
  { jobNumber: '31-130', jobName: 'Summit Plaza Lobby', pmId: PM.CH, linkedProjectId: '31-130' },
  { jobNumber: '31-140', jobName: 'Pinecrest Warehouse Office', pmId: PM.JS, linkedProjectId: '31-140' },
  { jobNumber: '31-121', jobName: 'Eastgate Office Refresh', pmId: PM.JS, linkedProjectId: '31-121' },
  { jobNumber: '31-118', jobName: 'Cedar Ridge Lab Fit-Out', pmId: PM.CS, linkedProjectId: '31-118' },
  { jobNumber: '31-112', jobName: 'Maple Commons Retail TI', pmId: PM.JS, linkedProjectId: '31-112' },
  { jobNumber: '31-107', jobName: 'Harbor Point Medical Office', pmId: PM.JS, linkedProjectId: '31-107' },
  { jobNumber: '30-279', jobName: 'Westbrook Ridge Office', pmId: PM.JS, linkedProjectId: null },
  { jobNumber: '30-282', jobName: 'Yarrow Pet Clinic', pmId: PM.CB, linkedProjectId: null },
  { jobNumber: '30-285', jobName: 'Zephyr and Lane', pmId: PM.CB, linkedProjectId: null },
  { jobNumber: '30-288', jobName: 'Brightmoor Commons', pmId: PM.DW, linkedProjectId: null },
];

function makePlaceholderProject(def: PlaceholderDef): CloseoutProject {
  const id = `co-${def.jobNumber}`;
  return {
    id,
    projectId: def.linkedProjectId,
    jobNumber: def.jobNumber,
    jobName: def.jobName,
    pmId: def.pmId,
    status: 'active',
    generalChecklist: gc(false, false, false, false, false, false, false),
    trades: MASTER_TRADES.map((trade) => tc(id, trade.id, {})),
    lienWaivers: [],
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const mockCloseoutProjects: CloseoutProject[] = [
  ...realProjects,
  ...placeholders.map(makePlaceholderProject),
];

export function getCloseoutProjects(filters?: CloseoutFilters): CloseoutProject[] {
  let results = [...mockCloseoutProjects];

  if (filters?.status) {
    results = results.filter((p) => p.status === filters.status);
  }
  if (filters?.pmId) {
    results = results.filter((p) => p.pmId === filters.pmId);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (p) => p.jobNumber.toLowerCase().includes(q) || p.jobName.toLowerCase().includes(q),
    );
  }

  // Sort
  const dir = filters?.sortDir === 'desc' ? -1 : 1;
  if (filters?.sortBy === 'jobNumber') {
    results.sort((a, b) => dir * a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true }));
  } else {
    // Default: sort by completion ascending (lowest first)
    results.sort((a, b) => dir * (projectCompletionPct(a) - projectCompletionPct(b)));
  }

  return results;
}

export function getCloseoutProjectById(id: string): CloseoutProject | undefined {
  return mockCloseoutProjects.find((p) => p.id === id);
}

export function getCloseoutByProjectId(projectId: string): CloseoutProject | undefined {
  return mockCloseoutProjects.find((p) => p.projectId === projectId);
}

// ─── Legacy Exports (backward compat for old CloseoutTracker) ────────────────

export const mockCloseoutItems: CloseoutItem[] = [];

export function getCloseoutForProject(_projectId: string): CloseoutItem[] {
  return [];
}
