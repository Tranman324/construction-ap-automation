export type DocumentCategory =
  | 'Permit'
  | 'Budget'
  | 'Contract'
  | 'Subcontract'
  | 'Closeout'
  | 'Photo'
  | 'Schedule'
  | 'Other';

export interface ProjectDocument {
  id: string;
  project_id: string;
  file_name: string;
  category: DocumentCategory;
  uploaded_by: string;
  uploaded_at: string;
  file_url: string;
  file_size_kb: number;
}
