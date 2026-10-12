import type {
  ChecklistInstance,
  ChecklistSection,
  ChecklistItem,
  ChecklistType,
} from '@/modules/projects/types/checklist';

// ─── ID Counter ───────────────────────────────────────────────────────────────

let _c = 0;
const cid = (): string => `cli-${String(++_c).padStart(3, '0')}`;

// ─── Item factory ─────────────────────────────────────────────────────────────

interface D {
  t: string;   // item_text (verbatim)
  p?: boolean; // requires_photo
  /** requires_input — item needs a text field */
  i?: boolean;
  /** input_placeholder hint text */
  ip?: string;
}

function mk(
  d: D,
  section: string,
  done: boolean,
  by: string | null,
  at: string | null,
  photoUrl: string | null,
): ChecklistItem {
  return {
    id: cid(),
    section,
    item_text: d.t,
    requires_photo: d.p ?? false,
    requires_input: d.i ?? false,
    input_placeholder: d.ip ?? '',
    input_value: '',
    is_completed: done,
    completed_by: done ? by : null,
    completed_at: done ? at : null,
    photo_url: done ? photoUrl : null,
    photo_gps_lat: null,
    photo_gps_lng: null,
    notes: '',
  };
}

/** All items complete. Photo items receive photoUrl (default: '#photo-evidence'). */
function secDone(
  title: string,
  defs: D[],
  by: string,
  at: string,
  photo = '#photo-evidence',
): ChecklistSection {
  return {
    title,
    items: defs.map((d) => mk(d, title, true, by, at, d.p ? photo : null)),
  };
}

/** All items incomplete. */
export function secTodo(title: string, defs: D[]): ChecklistSection {
  return {
    title,
    items: defs.map((d) => mk(d, title, false, null, null, null)),
  };
}

// ─── Mobilization Day Checklist (Section Definitions from NCG PDF) ────────────

const PF_S1: D[] = [
  { t: 'Architect – Name & Phone Saved', i: true, ip: 'Name, phone, email' },
  { t: 'Construction Manager (if applicable)', i: true, ip: 'Name, phone, email' },
  { t: 'Building Manager', i: true, ip: 'Name, phone, email' },
  { t: 'Building Engineer', i: true, ip: 'Name, phone, email' },
  { t: 'Building Security', i: true, ip: 'Name, phone, email' },
];

const PF_S2: D[] = [
  { t: 'Dumpster location approved', p: true },
  { t: 'Dumpster delivered' },
  { t: 'Parking locations confirmed', p: true },
  { t: 'Loading dock procedures confirmed', i: true, ip: 'Dock #, hours, procedure' },
  { t: 'Material delivery windows confirmed', i: true, ip: 'Days & hours for deliveries' },
  { t: 'Restroom usage confirmed', i: true, ip: 'Building restrooms or Porta Johns location' },
  { t: 'After-hours access procedure confirmed', i: true, ip: 'Procedure details' },
  { t: 'Tenant/workspace access confirmed' },
  { t: 'Keys/badges received — Electrical rooms', p: true },
  { t: 'Keys/badges received — Mechanical rooms', p: true },
  { t: 'Keys/badges received — Janitorial rooms', p: true },
];

const PF_S3: D[] = [
  { t: 'Domestic water shutoff located', i: true, ip: 'Location (floor, room, description)' },
  { t: 'Sprinkler shutoff located', i: true, ip: 'Location (floor, room, description)' },
  { t: 'Sprinkler shutdown procedure confirmed', i: true, ip: 'Procedure details' },
  { t: 'Fire alarm panel located', i: true, ip: 'Location (floor, room, description)' },
  { t: 'Fire alarm bypass procedure confirmed', i: true, ip: 'Procedure details' },
];

const PF_S4: D[] = [
  { t: 'Building rules & regulations received', p: true },
  { t: 'Working hours confirmed', i: true, ip: 'e.g. Mon–Fri 7 AM – 6 PM' },
  { t: 'Quiet hours confirmed', i: true, ip: 'e.g. Before 9 AM / after 5 PM' },
  { t: 'Restricted areas identified', p: true, i: true, ip: 'List restricted areas' },
  { t: 'Elevator use rules confirmed', i: true, ip: 'Which elevators, hours, padding required' },
];

const PF_S5: D[] = [
  { t: 'Full path of travel identified', p: true },
  { t: 'Floor protection installed', p: true },
  { t: 'Elevator protection installed', p: true },
  { t: 'Lobby protection installed (if required)', p: true },
  { t: 'Wall corner protection installed', p: true },
  { t: 'Door frame protection installed', p: true },
  { t: 'Adjacent tenant protection installed', p: true },
  { t: 'Dust partitions installed', p: true },
  { t: 'Additional protection beyond company standard installed', p: true },
];

const PF_S6: D[] = [
  { t: 'Pre-filter requirements confirmed' },
  { t: 'Return air protection installed (if required)' },
  { t: 'Negative air machines installed (if required)' },
];

const PF_S7: D[] = [
  { t: 'Photos taken — Floors', p: true },
  { t: 'Photos taken — Walls', p: true },
  { t: 'Photos taken — Ceilings', p: true },
  { t: 'Photos taken — Elevators', p: true },
  { t: 'Photos taken — Lobby', p: true },
  { t: 'Photos taken — Corridors', p: true },
  { t: 'Photos taken — Restrooms', p: true },
  { t: 'Photos taken — Loading dock', p: true },
  { t: 'Photos taken — Adjacent tenant areas', p: true },
];

const PF_S8: D[] = [
  { t: 'Material staging area defined', p: true },
  { t: 'Break area defined', p: true },
  { t: 'Fire exits clear', p: true },
  { t: 'Walk paths clear' },
  { t: 'Dumpster access unobstructed' },
  { t: 'No trip hazards' },
];

const PF_S9: D[] = [
  { t: 'Emergency contacts posted', p: true },
  { t: 'Superintendent contact posted', p: true },
  { t: 'Nearest hospital posted', p: true, i: true, ip: 'Hospital name & address' },
  { t: 'Evacuation plan posted', p: true },
  { t: 'Permit posted (if required)', p: true },
];

const PF_S10: D[] = [
  { t: 'Building rules' },
  { t: 'Working hours / quiet hours' },
  { t: 'Path of travel' },
  { t: 'Protection standards' },
  { t: 'Cleanliness expectations' },
  { t: 'Shutdown procedures' },
  { t: 'Restricted areas' },
  { t: 'Customer service expectations' },
];

// ─── Interior Buildout Process Order (Section Definitions from NCG PDF) ──────

const IP_S1: D[] = [{ t: 'Know inspection jurisdiction and contacts including Fire Marshal', i: true, ip: 'Municipality name, inspection contact, Fire Marshal contact' }];

const IP_S2: D[] = [
  { t: 'Path of travel protected', p: true },
  { t: 'Elevator protection installed', p: true },
  { t: 'Lobby/common area protection installed', p: true },
  { t: 'Floor protection in work area', p: true },
  { t: 'Dust containment installed', p: true },
  { t: 'Additional building-required protection installed', p: true },
];

const IP_S3: D[] = [
  { t: 'Verify demo limits and existing conditions', p: true },
  { t: 'Confirm utilities identified before cutting' },
  { t: 'Protect all items to remain' },
  { t: 'Remove debris daily' },
  { t: 'Document unknown conditions immediately', p: true, i: true, ip: 'Describe condition found' },
  { t: 'Check overhead MEP drawings for conflicts with existing conditions' },
];

const IP_S4: D[] = [
  { t: 'Check random dimensions continuously' },
  { t: 'Verify critical dimensions' },
  { t: 'Confirm door openings, corridor widths, and ADA clearances' },
  { t: 'Confirm wall lines match plans and field conditions' },
];

const IP_S5: D[] = [
  { t: 'Frame walls one side at a time' },
  { t: 'Prepare walls for in-wall rough (do not close fully yet)' },
];

const IP_S6: D[] = [
  { t: 'Electrical rough in-wall (check against drawings)', p: true },
  { t: 'Plumbing rough in-wall (check against drawings)', p: true },
  { t: 'Low voltage rough in-wall — Fire alarm' },
  { t: 'Low voltage rough in-wall — Security / access control' },
  { t: 'Low voltage rough in-wall — Data' },
];

const IP_S7: D[] = [
  { t: 'Begin overhead Electrical work' },
  { t: 'Begin overhead Plumbing work' },
  { t: 'Begin overhead HVAC work' },
  { t: 'Begin overhead Low voltage work' },
  { t: 'Coordinate trades to prevent conflicts' },
  { t: 'Monitor ceiling space congestion early' },
];

const IP_S8: D[] = [
  { t: 'Complete under-slab connections immediately after wall roughs' },
  { t: 'Verify cores and structural conditions' },
];

const IP_S9: D[] = [
  { t: 'Building / framing inspection', p: true },
  { t: 'Electrical inspection', p: true },
  { t: 'Plumbing inspection', p: true },
  { t: 'Low voltage inspection — Fire alarm', p: true },
  { t: 'Low voltage inspection — Security / access control', p: true },
  { t: 'Low voltage inspection — Data', p: true },
  { t: '50% Fire Marshal inspection (confirm if jurisdiction requires)', p: true },
];

const IP_S10: D[] = [
  { t: 'Cover walls with drywall fully' },
  { t: 'Mud and tape walls' },
  { t: 'Prime walls' },
  { t: 'Point up walls' },
  { t: 'Spot in paint on walls as needed' },
];

const IP_S11: D[] = [
  { t: 'Install ceiling framing' },
  { t: 'Begin ceiling rough — Electrical' },
  { t: 'Begin ceiling rough — Plumbing' },
  { t: 'Begin ceiling rough — HVAC' },
  { t: 'Begin ceiling rough — Low voltage' },
  { t: 'Begin ceiling rough — Sprinkler' },
  { t: 'Coordinate trades and monitor for conflicts' },
];

const IP_S12: D[] = [
  { t: 'Building inspection', p: true },
  { t: 'HVAC inspection', p: true },
  { t: 'Plumbing inspection', p: true },
  { t: 'Electrical inspection', p: true },
  { t: 'Low voltage inspection — Fire alarm', p: true },
  { t: 'Low voltage inspection — Security / access control', p: true },
  { t: 'Low voltage inspection — Data', p: true },
  { t: 'Sprinkler inspection', p: true },
  { t: '80% Fire Marshal inspection (if jurisdiction requires)', p: true },
];

const IP_S13: D[] = [
  { t: 'Cover ceilings completely', p: true },
  { t: 'Begin flooring installation', p: true },
  { t: 'Install millwork', p: true },
  { t: 'Touch-up walls for final paint' },
  { t: 'Apply final paint coats' },
  { t: 'Install wall base' },
];

const IP_S14: D[] = [
  { t: 'Remove protection properly', p: true },
  { t: 'Final clean of floors, walls, ceilings, and all surfaces', p: true },
  { t: 'Verify all areas ready for client turnover', p: true },
  { t: 'Confirm completion against Section 3 – Final Inspections' },
];

// ─── Final Inspections & Turnover (Section Definitions from NCG PDF) ─────────

const FI_S1: D[] = [
  { t: 'Building / Framing final inspection', p: true },
  { t: 'HVAC final inspection', p: true },
  { t: 'Plumbing final inspection', p: true },
  { t: 'Electrical final inspection', p: true },
  { t: 'Low voltage final inspection — Data', p: true },
  { t: 'Low voltage final inspection — Security / access control', p: true },
  { t: 'Low voltage final inspection — Fire alarm', p: true },
  { t: 'Sprinkler final inspection', p: true },
  { t: '100% Fire Marshal inspection (if jurisdiction requires)', p: true },
];

const FI_S2: D[] = [
  { t: 'Emergency lighting letter', p: true },
  { t: 'Sprinkler test report', p: true },
  { t: 'Fire alarm test report', p: true },
  { t: 'Live sound test verification (confirm with jurisdiction or fire marshal if required)', p: true },
];

const FI_S3: D[] = [
  { t: 'Annual fire hydrant report', p: true },
  { t: 'Annual sprinkler report', p: true },
];

const FI_S4: D[] = [
  { t: 'All inspections verified complete', p: true },
  { t: 'Punch items identified', i: true, ip: 'List punch items' },
  { t: 'Punch items completed', p: true },
  { t: 'Corrective actions scheduled with subs', i: true, ip: 'Sub name, action, date' },
  { t: 'All verification documented with photos and notes', p: true },
];

function addMinutes(base: string, minutes: number): string {
  return new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
}

function addDays(base: string, days: number, hour = 15, minute = 0): string {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

export const PREFLIGHT_SECTIONS = [
  ['Required Contacts', PF_S1],
  ['Building Access & Logistics', PF_S2],
  ['Building System Control', PF_S3],
  ['Building Rules & Restrictions', PF_S4],
  ['Path of Travel & Protection', PF_S5],
  ['Dust Control & Pre-Filters', PF_S6],
  ['Pre-Existing Conditions', PF_S7],
  ['Site Logistics Setup', PF_S8],
  ['Safety Board Installed', PF_S9],
  ['Day 1 Crew Meeting', PF_S10],
] as const;

export const IN_PROCESS_SECTIONS = [
  ['Municipality', IP_S1],
  ['Site Protection', IP_S2],
  ['Demolition', IP_S3],
  ['Wall Layout', IP_S4],
  ['Wall Framing — One Side Only', IP_S5],
  ['In-Wall Rough (Walls)', IP_S6],
  ['Overhead MEP & Low Voltage', IP_S7],
  ['Under-Slab Connections (if required)', IP_S8],
  ['Wall Inspections', IP_S9],
  ['Wall Finishing', IP_S10],
  ['Ceiling Framing & Rough-In', IP_S11],
  ['Ceiling Inspections', IP_S12],
  ['Ceiling & Wall Cover', IP_S13],
  ['Final Clean & Turnover', IP_S14],
] as const;

export const FINAL_INSPECTION_SECTIONS = [
  ['Final Inspections — Must Verify Onsite', FI_S1],
  ['Required Documentation Onsite', FI_S2],
  ['Special Requirements — Standalone Buildings', FI_S3],
  ['Supervisor & Subcontractor Walkthrough', FI_S4],
] as const;

function buildCompletePreflight(
  id: string,
  project_id: string,
  by: string,
  started_at: string,
): ChecklistInstance {
  const sectionOffsets = [15, 45, 75, 90, 120, 135, 150, 165, 180, 210];
  return {
    id,
    project_id,
    type: 'preflight',
    started_at,
    completed_at: addMinutes(started_at, 210),
    sections: PREFLIGHT_SECTIONS.map(([title, defs], index) =>
      secDone(title, defs, by, addMinutes(started_at, sectionOffsets[index])),
    ),
  };
}

function buildCompleteInProcess(
  id: string,
  project_id: string,
  by: string,
  started_at: string,
): ChecklistInstance {
  const dayOffsets = [0, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25];
  return {
    id,
    project_id,
    type: 'in_process',
    started_at,
    completed_at: addDays(started_at, 25),
    sections: IN_PROCESS_SECTIONS.map(([title, defs], index) =>
      secDone(title, defs, by, addDays(started_at, dayOffsets[index])),
    ),
  };
}

function buildCompleteFinal(
  id: string,
  project_id: string,
  by: string,
  started_at: string,
): ChecklistInstance {
  const dayOffsets = [1, 3, 4, 6];
  return {
    id,
    project_id,
    type: 'final_inspections',
    started_at,
    completed_at: addDays(started_at, 6),
    sections: FINAL_INSPECTION_SECTIONS.map(([title, defs], index) =>
      secDone(title, defs, by, addDays(started_at, dayOffsets[index])),
    ),
  };
}

function buildPartialPreflight(
  id: string,
  project_id: string,
  by: string,
  started_at: string,
): ChecklistInstance {
  return {
    id,
    project_id,
    type: 'preflight',
    started_at,
    completed_at: null,
    sections: [
      secDone('Required Contacts', PF_S1, by, addMinutes(started_at, 15)),
      secDone('Building Access & Logistics', PF_S2, by, addMinutes(started_at, 45)),
      secDone('Building System Control', PF_S3, by, addMinutes(started_at, 75)),
      secDone('Building Rules & Restrictions', PF_S4, by, addMinutes(started_at, 90)),
      secTodo('Path of Travel & Protection', PF_S5),
      secTodo('Dust Control & Pre-Filters', PF_S6),
      secTodo('Pre-Existing Conditions', PF_S7),
      secTodo('Site Logistics Setup', PF_S8),
      secTodo('Safety Board Installed', PF_S9),
      secTodo('Day 1 Crew Meeting', PF_S10),
    ],
  };
}

/** Very early preflight — only first 2 sections done. */
function buildEarlyPreflight(
  id: string,
  project_id: string,
  by: string,
  started_at: string,
): ChecklistInstance {
  return {
    id,
    project_id,
    type: 'preflight',
    started_at,
    completed_at: null,
    sections: [
      secDone('Required Contacts', PF_S1, by, addMinutes(started_at, 15)),
      secDone('Building Access & Logistics', PF_S2, by, addMinutes(started_at, 45)),
      secTodo('Building System Control', PF_S3),
      secTodo('Building Rules & Restrictions', PF_S4),
      secTodo('Path of Travel & Protection', PF_S5),
      secTodo('Dust Control & Pre-Filters', PF_S6),
      secTodo('Pre-Existing Conditions', PF_S7),
      secTodo('Site Logistics Setup', PF_S8),
      secTodo('Safety Board Installed', PF_S9),
      secTodo('Day 1 Crew Meeting', PF_S10),
    ],
  };
}

/** In-Process with first `doneSections` sections complete, rest todo. */
function buildPartialInProcess(
  id: string,
  project_id: string,
  by: string,
  started_at: string,
  doneSections: number,
): ChecklistInstance {
  const dayOffsets = [0, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25];
  return {
    id,
    project_id,
    type: 'in_process',
    started_at,
    completed_at: null,
    sections: IN_PROCESS_SECTIONS.map(([title, defs], index) =>
      index < doneSections
        ? secDone(title, defs, by, addDays(started_at, dayOffsets[index]))
        : secTodo(title, defs),
    ),
  };
}

/** Final Inspections with first `doneSections` sections complete, rest todo. */
function buildPartialFinal(
  id: string,
  project_id: string,
  by: string,
  started_at: string,
  doneSections: number,
): ChecklistInstance {
  const dayOffsets = [1, 3, 4, 6];
  return {
    id,
    project_id,
    type: 'final_inspections',
    started_at,
    completed_at: null,
    sections: FINAL_INSPECTION_SECTIONS.map(([title, defs], index) =>
      index < doneSections
        ? secDone(title, defs, by, addDays(started_at, dayOffsets[index]))
        : secTodo(title, defs),
    ),
  };
}

// ─── Checklist Instances ──────────────────────────────────────────────────────
// Varied completion status across projects to demonstrate different phases:
//
// 31-118  Phase 5  Partial preflight (4/10 sections)
// 31-126  Phase 5  Early preflight (2/10 sections)
// 31-133  Phase 5  Complete preflight only
// 31-121  Phase 6  Complete preflight + partial in-process (8/14 sections)
// 31-130  Phase 6  Complete preflight + complete in-process + partial final (2/5 sections)
// 31-137  Phase 8  All three complete
// 31-140  Phase 8  Complete PF + complete IP + nearly-complete final (4/5 sections)
// 31-144  Phase 8  All three complete

export const mockChecklists: ChecklistInstance[] = [
  // 31-118 — Phase 5: partial preflight, 4/10 sections done
  buildPartialPreflight('cl-001', '31-118', 'eb63a131-a08f-4801-b1a0-5882784d6a5a', '2026-03-21T07:30:00.000Z'),

  // 31-121 — Phase 6: complete preflight + partial in-process (first 8 of 14 sections)
  buildCompletePreflight('cl-002', '31-121', '7e238e1b-d629-4edb-a94b-f1b5a067b57f', '2026-03-13T07:30:00.000Z'),
  buildPartialInProcess('cl-003', '31-121', '7e238e1b-d629-4edb-a94b-f1b5a067b57f', '2026-03-18T07:00:00.000Z', 8),

  // 31-126 — Phase 5: early preflight, only 2/10 sections done
  buildEarlyPreflight('cl-004', '31-126', '8221d07a-f1f7-45aa-b71d-3b2707c620ed', '2026-03-29T07:30:00.000Z'),

  // 31-130 — Phase 6: complete PF + complete IP + partial final (first 2 of 5 sections)
  buildCompletePreflight('cl-005', '31-130', 'a6f39872-28a8-4685-a9bd-c785e26da0bd', '2026-03-07T07:30:00.000Z'),
  buildCompleteInProcess('cl-006', '31-130', 'a6f39872-28a8-4685-a9bd-c785e26da0bd', '2026-03-12T07:00:00.000Z'),
  buildPartialFinal('cl-017', '31-130', 'a6f39872-28a8-4685-a9bd-c785e26da0bd', '2026-03-28T08:00:00.000Z', 2),

  // 31-133 — Phase 5: complete preflight only
  buildCompletePreflight('cl-007', '31-133', '9f9f8fc2-58f6-45a8-8728-56de76dc8d1f', '2026-03-21T07:30:00.000Z'),

  // 31-137 — Phase 8: all three complete
  buildCompletePreflight('cl-008', '31-137', 'c3accbb5-7732-47b0-b6cc-1163f1deb807', '2026-02-22T07:30:00.000Z'),
  buildCompleteInProcess('cl-009', '31-137', 'c3accbb5-7732-47b0-b6cc-1163f1deb807', '2026-02-27T07:00:00.000Z'),
  buildCompleteFinal('cl-010', '31-137', 'c3accbb5-7732-47b0-b6cc-1163f1deb807', '2026-03-21T08:00:00.000Z'),

  // 31-140 — Phase 8: complete PF + complete IP + nearly-complete final (4/5 sections)
  buildCompletePreflight('cl-011', '31-140', 'a4cc9a97-123c-4f2b-9297-a05b5293d1f4', '2026-02-28T07:30:00.000Z'),
  buildCompleteInProcess('cl-012', '31-140', 'a4cc9a97-123c-4f2b-9297-a05b5293d1f4', '2026-03-04T07:00:00.000Z'),
  buildPartialFinal('cl-013', '31-140', 'a4cc9a97-123c-4f2b-9297-a05b5293d1f4', '2026-03-22T08:00:00.000Z', 4),

  // 31-144 — Phase 8: all three complete
  buildCompletePreflight('cl-014', '31-144', 'eb63a131-a08f-4801-b1a0-5882784d6a5a', '2026-02-22T07:30:00.000Z'),
  buildCompleteInProcess('cl-015', '31-144', 'eb63a131-a08f-4801-b1a0-5882784d6a5a', '2026-02-27T07:00:00.000Z'),
  buildCompleteFinal('cl-016', '31-144', 'eb63a131-a08f-4801-b1a0-5882784d6a5a', '2026-03-12T08:00:00.000Z'),
];

// ─── Helper ───────────────────────────────────────────────────────────────────

export function getChecklistsForProject(
  projectId: string,
  type?: ChecklistType,
): ChecklistInstance[] {
  return mockChecklists.filter(
    (c) => c.project_id === projectId && (type === undefined || c.type === type),
  );
}
