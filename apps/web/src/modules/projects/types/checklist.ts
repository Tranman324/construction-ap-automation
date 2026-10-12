// ─── Checklist Types ─────────────────────────────────────────────────────────

export type ChecklistType = 'preflight' | 'in_process' | 'final_inspections';

// ─── Checklist Item ──────────────────────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  section: string;
  item_text: string;
  requires_photo: boolean;
  /** When true, the item requires a text input (e.g. location, hours, procedure). */
  requires_input: boolean;
  /** Placeholder hint shown inside the text input when requires_input is true. */
  input_placeholder: string;
  /** User-entered text value for input-required items. */
  input_value: string;
  is_completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  photo_url: string | null;
  photo_gps_lat: number | null;
  photo_gps_lng: number | null;
  notes: string;
}

// ─── Checklist Section ───────────────────────────────────────────────────────

export interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
}

// ─── Checklist Instance ──────────────────────────────────────────────────────

export interface ChecklistInstance {
  id: string;
  project_id: string;
  type: ChecklistType;
  started_at: string | null;
  completed_at: string | null;
  sections: ChecklistSection[];
}
