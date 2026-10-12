// ─── Closeout Dashboard Types ────────────────────────────────────────────────
// Trade-based closeout tracking system. Replaces the old CloseoutItem model.

/** Document collection status */
export type DocStatus = 'pending' | 'received' | 'requested' | 'na';

/** Document field keys */
export type DocField = 'asBuilts' | 'om' | 'tab' | 'warranty' | 'finalLienWaiver';

/** Master trade definition */
export interface Trade {
  id: string;
  name: string;
  color: string;
  docs: DocField[];
}

/** Per-trade document tracking on a project */
export interface TradeCloseout {
  id: string;
  projectId: string;
  tradeId: string;
  trade: Trade;
  asBuilts: DocStatus | null;
  om: DocStatus | null;
  tab: DocStatus | null;
  warranty: DocStatus;
  finalLienWaiver: DocStatus;
  note: string | null;
}

// ─── General Checklist ───────────────────────────────────────────────────────

export interface ChecklistItemValue {
  complete: boolean;
  note?: string;
}

export interface CloseoutGeneralChecklist {
  changeOrder: ChecklistItemValue;
  permit: ChecklistItemValue;
  subList: ChecklistItemValue;
  viewpointArchive: ChecklistItemValue;
  atticStockReport: ChecklistItemValue;
  ncgWarranty: ChecklistItemValue;
  tenantAcceptance: ChecklistItemValue;
}

// ─── Subcontractor Lien Waivers ──────────────────────────────────────────────

export interface SubcontractorLienWaiver {
  id: string;
  projectId: string;
  subcontractorName: string;
  received: boolean;
}

// ─── Closeout Project ────────────────────────────────────────────────────────

export type CloseoutProjectStatus = 'active' | 'hold' | 'complete';

export interface CloseoutProject {
  id: string;
  /** Linked mock project ID (null if closeout-only) */
  projectId: string | null;
  jobNumber: string;
  jobName: string;
  pmId: string;
  status: CloseoutProjectStatus;
  generalChecklist: CloseoutGeneralChecklist;
  trades: TradeCloseout[];
  lienWaivers: SubcontractorLienWaiver[];
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface CloseoutFilters {
  status?: CloseoutProjectStatus;
  pmId?: string;
  search?: string;
  sortBy?: 'completion' | 'jobNumber';
  sortDir?: 'asc' | 'desc';
}

// ─── Label Maps ──────────────────────────────────────────────────────────────

export type GeneralChecklistKey = keyof CloseoutGeneralChecklist;

export const GENERAL_CHECKLIST_LABELS: Record<GeneralChecklistKey, string> = {
  changeOrder: 'CO / CC',
  permit: 'Permit Closed',
  subList: 'Sub List',
  viewpointArchive: 'Viewpoint Archive',
  atticStockReport: 'Attic Stock Report',
  ncgWarranty: 'NCG Warranty',
  tenantAcceptance: 'Tenant Acceptance',
};

export const DOC_FIELD_LABELS: Record<DocField, string> = {
  asBuilts: 'As-Builts',
  om: 'O&M',
  tab: 'TAB',
  warranty: 'Warranty',
  finalLienWaiver: 'Final Lien Waiver',
};

// ─── Legacy re-exports (keep for existing imports) ───────────────────────────

/** @deprecated Use CloseoutProjectStatus instead */
export type CloseoutType = 'short' | 'full';

/** @deprecated Use DocStatus instead */
export type CloseoutStatus = 'not_started' | 'requested' | 'received' | 'verified';

/** @deprecated Use TradeCloseout / CloseoutProject instead */
export interface CloseoutItem {
  id: string;
  item_name: string;
  item_category: 'short' | 'full';
  is_per_sub: boolean;
  status: CloseoutStatus;
  document_url: string | null;
  received_at: string | null;
  notes: string;
  sub_items?: CloseoutSubItem[];
}

/** @deprecated */
export interface CloseoutSubItem {
  id: string;
  closeout_item_id: string;
  subcontractor_id: string;
  status: CloseoutStatus;
  document_url: string | null;
  received_at: string | null;
}
