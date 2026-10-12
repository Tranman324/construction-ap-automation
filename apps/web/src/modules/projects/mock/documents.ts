import type { ProjectDocument } from '@/modules/projects/types/document';

let _d = 0;
const did = (): string => `doc-${String(++_d).padStart(3, '0')}`;

export const mockDocuments: ProjectDocument[] = [
  // ── 31-107 Harbor Point Medical Office ──
  { id: did(), project_id: '31-107', file_name: 'Building Permit Application.pdf',    category: 'Permit',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-04-01T09:00:00.000Z', file_url: '#', file_size_kb: 310  },
  { id: did(), project_id: '31-107', file_name: 'Owner Contract - B9 ATL.pdf',        category: 'Contract',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-03-28T14:00:00.000Z', file_url: '#', file_size_kb: 2400 },
  { id: did(), project_id: '31-107', file_name: 'Preliminary Budget v1.xlsx',         category: 'Budget',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-03-30T10:00:00.000Z', file_url: '#', file_size_kb: 185  },
  { id: did(), project_id: '31-107', file_name: 'Project Schedule Draft.xlsx',        category: 'Schedule',    uploaded_by: 'Josh Martinez',  uploaded_at: '2026-04-02T11:00:00.000Z', file_url: '#', file_size_kb: 145  },

  // ── 31-112 Maple Commons Retail TI ──
  { id: did(), project_id: '31-112', file_name: 'Building Permit.pdf',                category: 'Permit',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-03-20T09:00:00.000Z', file_url: '#', file_size_kb: 420  },
  { id: did(), project_id: '31-112', file_name: 'Owner Contract.pdf',                 category: 'Contract',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-03-18T14:00:00.000Z', file_url: '#', file_size_kb: 1950 },
  { id: did(), project_id: '31-112', file_name: 'Preliminary Budget.xlsx',            category: 'Budget',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-03-19T10:00:00.000Z', file_url: '#', file_size_kb: 210  },

  // ── 31-118 Cedar Ridge Lab Fit-Out ──
  { id: did(), project_id: '31-118', file_name: 'Building Permit - Approved.pdf',     category: 'Permit',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-02-15T09:00:00.000Z', file_url: '#', file_size_kb: 480  },
  { id: did(), project_id: '31-118', file_name: 'Owner Contract Executed.pdf',        category: 'Contract',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-02-10T14:00:00.000Z', file_url: '#', file_size_kb: 2200 },
  { id: did(), project_id: '31-118', file_name: 'Sub - Premier Plumbing.pdf',         category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2026-02-20T09:00:00.000Z', file_url: '#', file_size_kb: 780  },
  { id: did(), project_id: '31-118', file_name: 'Sub - Southeast Electrical.pdf',     category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2026-02-22T09:00:00.000Z', file_url: '#', file_size_kb: 850  },
  { id: did(), project_id: '31-118', file_name: 'Project Schedule v2.xlsx',           category: 'Schedule',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-03-01T11:00:00.000Z', file_url: '#', file_size_kb: 190  },
  { id: did(), project_id: '31-118', file_name: 'Budget Tracker - March.xlsx',        category: 'Budget',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-03-15T10:00:00.000Z', file_url: '#', file_size_kb: 340  },
  { id: did(), project_id: '31-118', file_name: 'Site Photos - Feb 2026.zip',         category: 'Photo',       uploaded_by: 'Eddie Thompson', uploaded_at: '2026-02-28T17:00:00.000Z', file_url: '#', file_size_kb: 24500 },

  // ── 31-121 Eastgate Office Refresh ──
  { id: did(), project_id: '31-121', file_name: 'Building Permit.pdf',                category: 'Permit',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-02-20T09:00:00.000Z', file_url: '#', file_size_kb: 390  },
  { id: did(), project_id: '31-121', file_name: 'Owner Contract.pdf',                 category: 'Contract',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-02-18T14:00:00.000Z', file_url: '#', file_size_kb: 1800 },
  { id: did(), project_id: '31-121', file_name: 'Sub - Metro Fire Protection.pdf',    category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2026-02-25T09:00:00.000Z', file_url: '#', file_size_kb: 720  },
  { id: did(), project_id: '31-121', file_name: 'Project Schedule v1.xlsx',           category: 'Schedule',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-03-05T11:00:00.000Z', file_url: '#', file_size_kb: 160  },
  { id: did(), project_id: '31-121', file_name: 'Site Photos - March 2026.zip',       category: 'Photo',       uploaded_by: 'Eddie Thompson', uploaded_at: '2026-03-20T17:00:00.000Z', file_url: '#', file_size_kb: 15800 },

  // ── 31-126 Willow Creek Clinic ──
  { id: did(), project_id: '31-126', file_name: 'Building Permit - Approved.pdf',     category: 'Permit',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-01-15T09:00:00.000Z', file_url: '#', file_size_kb: 510  },
  { id: did(), project_id: '31-126', file_name: 'Owner Contract Executed.pdf',        category: 'Contract',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-01-10T14:00:00.000Z', file_url: '#', file_size_kb: 2350 },
  { id: did(), project_id: '31-126', file_name: 'Budget Tracker - Current.xlsx',      category: 'Budget',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-03-25T10:00:00.000Z', file_url: '#', file_size_kb: 290  },
  { id: did(), project_id: '31-126', file_name: 'Project Schedule v3.xlsx',           category: 'Schedule',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-03-10T11:00:00.000Z', file_url: '#', file_size_kb: 175  },

  // ── 31-130 Summit Plaza Lobby ──
  { id: did(), project_id: '31-130', file_name: 'Building Permit - Final.pdf',        category: 'Permit',      uploaded_by: 'Josh Martinez',  uploaded_at: '2025-04-10T09:00:00.000Z', file_url: '#', file_size_kb: 440  },
  { id: did(), project_id: '31-130', file_name: 'Owner Contract Executed.pdf',        category: 'Contract',    uploaded_by: 'Eddie Thompson', uploaded_at: '2025-03-15T14:00:00.000Z', file_url: '#', file_size_kb: 2650 },
  { id: did(), project_id: '31-130', file_name: 'Sub - Georgia Drywall Inc.pdf',      category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2025-04-20T09:00:00.000Z', file_url: '#', file_size_kb: 920  },
  { id: did(), project_id: '31-130', file_name: 'Sub - Apex Mechanical.pdf',          category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2025-04-22T09:00:00.000Z', file_url: '#', file_size_kb: 810  },
  { id: did(), project_id: '31-130', file_name: 'Sub - Reliable Roofing.pdf',         category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2025-04-25T09:00:00.000Z', file_url: '#', file_size_kb: 680  },
  { id: did(), project_id: '31-130', file_name: 'Budget Final Reconciliation.xlsx',   category: 'Budget',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-03-20T10:00:00.000Z', file_url: '#', file_size_kb: 410  },
  { id: did(), project_id: '31-130', file_name: 'Project Schedule - Final.xlsx',      category: 'Schedule',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-01-15T11:00:00.000Z', file_url: '#', file_size_kb: 230  },
  { id: did(), project_id: '31-130', file_name: 'Closeout Checklist.pdf',             category: 'Closeout',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-03-25T16:00:00.000Z', file_url: '#', file_size_kb: 560  },
  { id: did(), project_id: '31-130', file_name: 'Site Photos - Final Walk.zip',       category: 'Photo',       uploaded_by: 'Eddie Thompson', uploaded_at: '2026-03-18T17:00:00.000Z', file_url: '#', file_size_kb: 32400 },

  // ── 31-133 Northfield Training Center ──
  { id: did(), project_id: '31-133', file_name: 'Building Permit.pdf',                category: 'Permit',      uploaded_by: 'Josh Martinez',  uploaded_at: '2025-10-05T09:00:00.000Z', file_url: '#', file_size_kb: 370  },
  { id: did(), project_id: '31-133', file_name: 'Owner Contract.pdf',                 category: 'Contract',    uploaded_by: 'Eddie Thompson', uploaded_at: '2025-09-28T14:00:00.000Z', file_url: '#', file_size_kb: 1950 },
  { id: did(), project_id: '31-133', file_name: 'Sub - Pinnacle Glass.pdf',           category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2025-10-15T09:00:00.000Z', file_url: '#', file_size_kb: 750  },
  { id: did(), project_id: '31-133', file_name: 'Sub - Southern Steel.pdf',           category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2025-10-18T09:00:00.000Z', file_url: '#', file_size_kb: 680  },
  { id: did(), project_id: '31-133', file_name: 'Budget Tracker - Current.xlsx',      category: 'Budget',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-03-01T10:00:00.000Z', file_url: '#', file_size_kb: 275  },
  { id: did(), project_id: '31-133', file_name: 'Project Schedule v2.xlsx',           category: 'Schedule',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-02-10T11:00:00.000Z', file_url: '#', file_size_kb: 195  },
  { id: did(), project_id: '31-133', file_name: 'Site Photos - Jan 2026.zip',         category: 'Photo',       uploaded_by: 'Eddie Thompson', uploaded_at: '2026-01-31T17:00:00.000Z', file_url: '#', file_size_kb: 19800 },

  // ── 31-137 Bayview Coffee Roastery ──
  { id: did(), project_id: '31-137', file_name: 'Building Permit - Approved.pdf',     category: 'Permit',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-02-25T09:00:00.000Z', file_url: '#', file_size_kb: 280  },
  { id: did(), project_id: '31-137', file_name: 'Owner Contract.pdf',                 category: 'Contract',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-02-24T14:00:00.000Z', file_url: '#', file_size_kb: 1200 },
  { id: did(), project_id: '31-137', file_name: 'Final Budget Reconciliation.xlsx',   category: 'Budget',      uploaded_by: 'Josh Martinez',  uploaded_at: '2026-03-25T10:00:00.000Z', file_url: '#', file_size_kb: 320  },
  { id: did(), project_id: '31-137', file_name: 'Closeout Package - Complete.pdf',    category: 'Closeout',    uploaded_by: 'Eddie Thompson', uploaded_at: '2026-03-26T16:00:00.000Z', file_url: '#', file_size_kb: 4200 },
  { id: did(), project_id: '31-137', file_name: 'Certificate of Occupancy.pdf',       category: 'Closeout',    uploaded_by: 'Josh Martinez',  uploaded_at: '2026-03-22T09:00:00.000Z', file_url: '#', file_size_kb: 150  },
  { id: did(), project_id: '31-137', file_name: 'Final Inspection Report.pdf',        category: 'Other',       uploaded_by: 'Eddie Thompson', uploaded_at: '2026-03-20T15:00:00.000Z', file_url: '#', file_size_kb: 890  },

  // ── 31-140 Pinecrest Warehouse Office ──
  { id: did(), project_id: '31-140', file_name: 'Building Permit.pdf',                category: 'Permit',      uploaded_by: 'Josh Martinez',  uploaded_at: '2025-08-12T09:00:00.000Z', file_url: '#', file_size_kb: 420  },
  { id: did(), project_id: '31-140', file_name: 'Executed Contract.pdf',              category: 'Contract',    uploaded_by: 'Eddie Thompson', uploaded_at: '2025-08-15T14:00:00.000Z', file_url: '#', file_size_kb: 1850 },
  { id: did(), project_id: '31-140', file_name: 'Sub - Atlanta Electrical.pdf',       category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2025-08-20T09:00:00.000Z', file_url: '#', file_size_kb: 780  },
  { id: did(), project_id: '31-140', file_name: 'Sub - Peach State HVAC.pdf',         category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2025-08-22T09:00:00.000Z', file_url: '#', file_size_kb: 690  },
  { id: did(), project_id: '31-140', file_name: 'Project Schedule v3.xlsx',           category: 'Schedule',    uploaded_by: 'Josh Martinez',  uploaded_at: '2025-09-01T11:00:00.000Z', file_url: '#', file_size_kb: 210  },
  { id: did(), project_id: '31-140', file_name: 'Closeout Package.pdf',              category: 'Closeout',    uploaded_by: 'Eddie Thompson', uploaded_at: '2025-10-20T16:00:00.000Z', file_url: '#', file_size_kb: 3200 },
  { id: did(), project_id: '31-140', file_name: 'Budget Final.xlsx',                  category: 'Budget',      uploaded_by: 'Josh Martinez',  uploaded_at: '2025-10-18T10:00:00.000Z', file_url: '#', file_size_kb: 350  },
  { id: did(), project_id: '31-140', file_name: 'Site Photos - Final.zip',            category: 'Photo',       uploaded_by: 'Eddie Thompson', uploaded_at: '2025-10-15T17:00:00.000Z', file_url: '#', file_size_kb: 18400 },

  // ── 31-144 Oakhurst Dental Suite ──
  { id: did(), project_id: '31-144', file_name: 'Building Permit.pdf',                category: 'Permit',      uploaded_by: 'Josh Martinez',  uploaded_at: '2024-03-10T09:00:00.000Z', file_url: '#', file_size_kb: 380  },
  { id: did(), project_id: '31-144', file_name: 'Owner Contract.pdf',                 category: 'Contract',    uploaded_by: 'Eddie Thompson', uploaded_at: '2024-03-12T10:00:00.000Z', file_url: '#', file_size_kb: 2100 },
  { id: did(), project_id: '31-144', file_name: 'Sub - Atlanta Electrical.pdf',       category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2024-04-01T09:00:00.000Z', file_url: '#', file_size_kb: 890  },
  { id: did(), project_id: '31-144', file_name: 'Sub - Buckhead Concrete.pdf',        category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2024-04-05T09:00:00.000Z', file_url: '#', file_size_kb: 720  },
  { id: did(), project_id: '31-144', file_name: 'Sub - Midtown Painting.pdf',         category: 'Subcontract', uploaded_by: 'Josh Martinez',  uploaded_at: '2024-04-08T09:00:00.000Z', file_url: '#', file_size_kb: 650  },
  { id: did(), project_id: '31-144', file_name: 'Budget Final Reconciliation.xlsx',   category: 'Budget',      uploaded_by: 'Josh Martinez',  uploaded_at: '2025-10-25T10:00:00.000Z', file_url: '#', file_size_kb: 380  },
  { id: did(), project_id: '31-144', file_name: 'Project Schedule - Final.xlsx',      category: 'Schedule',    uploaded_by: 'Eddie Thompson', uploaded_at: '2025-09-15T11:00:00.000Z', file_url: '#', file_size_kb: 200  },
  { id: did(), project_id: '31-144', file_name: 'Closeout Package - Complete.pdf',    category: 'Closeout',    uploaded_by: 'Eddie Thompson', uploaded_at: '2025-10-28T16:00:00.000Z', file_url: '#', file_size_kb: 5100 },
  { id: did(), project_id: '31-144', file_name: 'Certificate of Occupancy.pdf',       category: 'Closeout',    uploaded_by: 'Josh Martinez',  uploaded_at: '2025-10-22T09:00:00.000Z', file_url: '#', file_size_kb: 140  },
  { id: did(), project_id: '31-144', file_name: 'Site Photos Oct 2025.zip',           category: 'Photo',       uploaded_by: 'Eddie Thompson', uploaded_at: '2025-10-15T17:00:00.000Z', file_url: '#', file_size_kb: 18400 },
  { id: did(), project_id: '31-144', file_name: 'As-Built Drawings.pdf',              category: 'Other',       uploaded_by: 'Josh Martinez',  uploaded_at: '2025-10-20T14:00:00.000Z', file_url: '#', file_size_kb: 7600 },
];

export function getDocsForProject(projectId: string): ProjectDocument[] {
  return mockDocuments.filter(d => d.project_id === projectId);
}
