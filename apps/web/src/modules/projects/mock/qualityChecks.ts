import type { QualityCheck, QCRating, QCCategory, QCActionItem } from '@/modules/projects/types/qualityCheck';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _qcId = 0;
const qid = (): string => `qc-${String(++_qcId).padStart(3, '0')}`;
const aid = (): string => `qca-${String(++_qcId).padStart(3, '0')}`;

function cat(rating: QCRating, notes: string, photos: string[] = []): QCCategory {
  return { rating, notes, photo_urls: photos };
}

function act(
  desc: string,
  priority: QCActionItem['priority'],
  assignedTo: string | null = null,
  dueDate: string | null = null,
  resolved = false,
): QCActionItem {
  return {
    id: aid(),
    description: desc,
    priority,
    assigned_to: assignedTo,
    due_date: dueDate,
    resolved,
    resolved_at: resolved ? dueDate : null,
  };
}

function avg(...ratings: QCRating[]): number {
  return Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10;
}

function daysAgo(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  d.setHours(7, 30, 0, 0);
  return d.toISOString();
}

const NOW = '2026-04-14T07:30:00.000Z';

// ─── Superintendent IDs (from team.ts) ────────────────────────────────────────

const SUPERS = {
  '31-107': 'a4cc9a97-123c-4f2b-9297-a05b5293d1f4',
  '31-112': '8221d07a-f1f7-45aa-b71d-3b2707c620ed',
  '31-118': 'eb63a131-a08f-4801-b1a0-5882784d6a5a',
  '31-121': '7e238e1b-d629-4edb-a94b-f1b5a067b57f',
  '31-126': '8221d07a-f1f7-45aa-b71d-3b2707c620ed',
  '31-130': 'a6f39872-28a8-4685-a9bd-c785e26da0bd',
  '31-133': '9f9f8fc2-58f6-45a8-8728-56de76dc8d1f',
  '31-137': 'c3accbb5-7732-47b0-b6cc-1163f1deb807',
  '31-140': 'a4cc9a97-123c-4f2b-9297-a05b5293d1f4',
  '31-144': 'eb63a131-a08f-4801-b1a0-5882784d6a5a',
} as const;

// ─── Mock Quality Checks ─────────────────────────────────────────────────────
// Each active project gets 2-5 weekly checks spanning the last few weeks.

export const mockQualityChecks: QualityCheck[] = [
  // ── 31-118 Cedar Ridge Lab Fit-Out ──
  {
    id: qid(), project_id: '31-118', completed_by: SUPERS['31-118'],
    completed_at: daysAgo(NOW, 1),
    overall_score: avg(5, 4, 4, 5),
    safety_ppe: cat(5, 'All crew wearing hard hats, vests, and safety glasses. Toolbox talk completed at 7:00 AM.'),
    site_conditions: cat(4, 'Work area clean. Minor dust in corridor B — additional sweeping scheduled for PM.'),
    issues_concerns: cat(4, 'Elevator protection showing wear on south cab. Replacement pads ordered.'),
    other_notes: cat(5, 'Client walkthrough scheduled for Thursday. All areas presentable.'),
    action_items: [
      act('Replace elevator protection pads — south cab', 'medium', SUPERS['31-118'], daysAgo(NOW, -3)),
      act('Schedule deep clean before client walkthrough', 'low', null, daysAgo(NOW, -3)),
    ],
    weather: 'Clear, 72°F', crew_count: 14,
  },
  {
    id: qid(), project_id: '31-118', completed_by: SUPERS['31-118'],
    completed_at: daysAgo(NOW, 8),
    overall_score: avg(4, 4, 3, 4),
    safety_ppe: cat(4, 'One subcontractor crew member reminded to wear safety glasses. Corrected immediately.'),
    site_conditions: cat(4, 'Good housekeeping overall. Material staging area organized.'),
    issues_concerns: cat(3, 'Drywall delivery delayed by 1 day — adjusted schedule accordingly. No impact to critical path.'),
    other_notes: cat(4, 'MEP rough-in coordination meeting held. No conflicts identified.'),
    action_items: [
      act('Follow up with drywall supplier on remaining delivery', 'medium', SUPERS['31-118'], daysAgo(NOW, -1), true),
    ],
    weather: 'Overcast, 65°F', crew_count: 12,
  },
  {
    id: qid(), project_id: '31-118', completed_by: SUPERS['31-118'],
    completed_at: daysAgo(NOW, 15),
    overall_score: avg(5, 5, 4, 4),
    safety_ppe: cat(5, 'Full compliance. Fire extinguisher locations verified and clear.'),
    site_conditions: cat(5, 'Excellent condition. New floor protection installed this morning.'),
    issues_concerns: cat(4, 'Minor water intrusion at window header — sealed and monitored.'),
    other_notes: cat(4, 'Architect on site for field verification. All dimensions confirmed.'),
    action_items: [
      act('Monitor window header seal for 48 hours', 'low', SUPERS['31-118'], daysAgo(NOW, -8), true),
    ],
    weather: 'Sunny, 78°F', crew_count: 16,
  },
  {
    id: qid(), project_id: '31-118', completed_by: SUPERS['31-118'],
    completed_at: daysAgo(NOW, 22),
    overall_score: avg(4, 3, 3, 4),
    safety_ppe: cat(4, 'PPE compliance good. Reminded crew about proper ladder usage.'),
    site_conditions: cat(3, 'Debris buildup in corridor A needs attention. Extra dumpster requested.'),
    issues_concerns: cat(3, 'Electrical panel location conflicts with architectural plans. RFI submitted.'),
    other_notes: cat(4, 'Subcontractor schedule coordination meeting completed.'),
    action_items: [
      act('RFI #014 — Electrical panel relocation', 'high', null, daysAgo(NOW, -15), true),
      act('Clear debris from corridor A', 'medium', SUPERS['31-118'], daysAgo(NOW, -20), true),
    ],
    weather: 'Rainy, 58°F', crew_count: 8,
  },

  // ── 31-121 Eastgate Office Refresh ──
  {
    id: qid(), project_id: '31-121', completed_by: SUPERS['31-121'],
    completed_at: daysAgo(NOW, 2),
    overall_score: avg(4, 4, 3, 4),
    safety_ppe: cat(4, 'All workers badged and wearing proper PPE. Safety board updated.'),
    site_conditions: cat(4, 'Floor protection in good condition. Dust barriers intact.'),
    issues_concerns: cat(3, 'HVAC ductwork routing conflicts with sprinkler mains. Coordination meeting scheduled for tomorrow.'),
    other_notes: cat(4, 'Ceiling grid layout verified against reflected ceiling plan.'),
    action_items: [
      act('HVAC/sprinkler coordination — resolve routing conflict', 'high', SUPERS['31-121'], daysAgo(NOW, -1)),
      act('Update RCP markup with field conditions', 'low', null, daysAgo(NOW, -5)),
    ],
    weather: 'Partly cloudy, 68°F', crew_count: 18,
  },
  {
    id: qid(), project_id: '31-121', completed_by: SUPERS['31-121'],
    completed_at: daysAgo(NOW, 9),
    overall_score: avg(5, 5, 4, 5),
    safety_ppe: cat(5, 'Excellent compliance across all trades. Toolbox talk on fall protection completed.'),
    site_conditions: cat(5, 'Clean and organized. All materials properly stored.'),
    issues_concerns: cat(4, 'Flooring material lead time extended 1 week. Schedule adjusted, no milestone impact.'),
    other_notes: cat(5, 'Building manager complimented site cleanliness.'),
    action_items: [],
    weather: 'Clear, 74°F', crew_count: 20,
  },
  {
    id: qid(), project_id: '31-121', completed_by: SUPERS['31-121'],
    completed_at: daysAgo(NOW, 16),
    overall_score: avg(4, 4, 4, 4),
    safety_ppe: cat(4, 'All PPE requirements met. First aid kit restocked.'),
    site_conditions: cat(4, 'Work area well maintained. Path of travel clear.'),
    issues_concerns: cat(4, 'Minor paint color discrepancy on accent wall — sample approved by architect.'),
    other_notes: cat(4, 'Submittals for door hardware approved and ordered.'),
    action_items: [
      act('Verify paint color match on accent wall after drying', 'low', SUPERS['31-121'], daysAgo(NOW, -12), true),
    ],
    weather: 'Overcast, 62°F', crew_count: 15,
  },

  // ── 31-130 Summit Plaza Lobby ──
  {
    id: qid(), project_id: '31-130', completed_by: SUPERS['31-130'],
    completed_at: daysAgo(NOW, 0),
    overall_score: avg(5, 5, 4, 5),
    safety_ppe: cat(5, 'Perfect score this week. All trades compliant including new tile crew.'),
    site_conditions: cat(5, 'Final clean of completed areas. Punch list walkthrough areas prepped.'),
    issues_concerns: cat(4, 'Two punch items remaining — door hardware adjustment and ceiling tile alignment.'),
    other_notes: cat(5, 'Project on track for substantial completion. Owner walkthrough confirmed for next Tuesday.'),
    action_items: [
      act('Complete door hardware adjustment — suite 200', 'medium', null, daysAgo(NOW, -3)),
      act('Align ceiling tiles in corridor C', 'low', null, daysAgo(NOW, -3)),
    ],
    weather: 'Sunny, 76°F', crew_count: 10,
  },
  {
    id: qid(), project_id: '31-130', completed_by: SUPERS['31-130'],
    completed_at: daysAgo(NOW, 7),
    overall_score: avg(4, 4, 4, 4),
    safety_ppe: cat(4, 'Good compliance. Reminded painting crew of proper ventilation setup.'),
    site_conditions: cat(4, 'Clean job site. Protection maintained in completed areas.'),
    issues_concerns: cat(4, 'Touch-up painting needed in lobby after millwork installation.'),
    other_notes: cat(4, 'Final inspection scheduled with city for next week.'),
    action_items: [
      act('Touch-up paint in lobby', 'low', SUPERS['31-130'], daysAgo(NOW, -3), true),
    ],
    weather: 'Clear, 70°F', crew_count: 12,
  },
  {
    id: qid(), project_id: '31-130', completed_by: SUPERS['31-130'],
    completed_at: daysAgo(NOW, 14),
    overall_score: avg(4, 3, 3, 4),
    safety_ppe: cat(4, 'PPE compliance maintained. Safety meeting held with all subs.'),
    site_conditions: cat(3, 'Dust from ceiling grid work spread to completed areas. HEPA vacuum deployed.'),
    issues_concerns: cat(3, 'Light fixture delivery short by 4 units. Expediting replacement order.'),
    other_notes: cat(4, 'Sprinkler final inspection passed. Fire alarm test scheduled.'),
    action_items: [
      act('Expedite 4x light fixtures from supplier', 'high', SUPERS['31-130'], daysAgo(NOW, -7), true),
      act('Deep clean completed areas after ceiling work', 'medium', null, daysAgo(NOW, -10), true),
    ],
    weather: 'Rainy, 55°F', crew_count: 14,
  },
  {
    id: qid(), project_id: '31-130', completed_by: SUPERS['31-130'],
    completed_at: daysAgo(NOW, 21),
    overall_score: avg(5, 4, 4, 5),
    safety_ppe: cat(5, 'Excellent. All workers completed site orientation sign-in.'),
    site_conditions: cat(4, 'Good overall. Floor protection in high-traffic areas needs replacement.'),
    issues_concerns: cat(4, 'Ceiling tile color variation between lots — matched and sorted.'),
    other_notes: cat(5, 'MEP walkthrough with engineer completed. All systems operating correctly.'),
    action_items: [
      act('Replace worn floor protection at main entry', 'medium', SUPERS['31-130'], daysAgo(NOW, -17), true),
    ],
    weather: 'Partly cloudy, 64°F', crew_count: 16,
  },
  {
    id: qid(), project_id: '31-130', completed_by: SUPERS['31-130'],
    completed_at: daysAgo(NOW, 28),
    overall_score: avg(4, 4, 3, 4),
    safety_ppe: cat(4, 'All PPE worn. Fire exit signage verified clear.'),
    site_conditions: cat(4, 'Materials neatly staged. Dumpster emptied on schedule.'),
    issues_concerns: cat(3, 'Plumbing rough failed first inspection — corrected and re-inspected same day.'),
    other_notes: cat(4, 'Weekly coordination meeting with GC held. Schedule on track.'),
    action_items: [
      act('Re-inspection for plumbing rough', 'high', null, daysAgo(NOW, -25), true),
    ],
    weather: 'Overcast, 60°F', crew_count: 18,
  },

  // ── 31-126 Willow Creek Clinic ──
  {
    id: qid(), project_id: '31-126', completed_by: SUPERS['31-126'],
    completed_at: daysAgo(NOW, 3),
    overall_score: avg(3, 3, 2, 3),
    safety_ppe: cat(3, 'Two workers found without safety vests during demo work. Corrected and documented.'),
    site_conditions: cat(3, 'Debris accumulation exceeds standard. Additional clean-up crew needed.'),
    issues_concerns: cat(2, 'Asbestos-containing material found in pipe insulation. Abatement contractor called. Work in affected area halted.'),
    other_notes: cat(3, 'Project timeline may shift 3-5 days pending abatement clearance.'),
    action_items: [
      act('Asbestos abatement — pipe insulation area B', 'critical', null, daysAgo(NOW, -1)),
      act('Issue safety vest violation notice to sub foreman', 'high', SUPERS['31-126'], daysAgo(NOW, -1)),
      act('Schedule additional debris removal', 'medium', null, daysAgo(NOW, -1)),
    ],
    weather: 'Clear, 71°F', crew_count: 12,
  },
  {
    id: qid(), project_id: '31-126', completed_by: SUPERS['31-126'],
    completed_at: daysAgo(NOW, 10),
    overall_score: avg(4, 4, 4, 4),
    safety_ppe: cat(4, 'Good compliance. New crew onboarded with full safety orientation.'),
    site_conditions: cat(4, 'Clean site. Dust barriers properly installed for demo phase.'),
    issues_concerns: cat(4, 'Elevator access limited to freight — communicated to all trades.'),
    other_notes: cat(4, 'Demo phase 60% complete. On schedule.'),
    action_items: [],
    weather: 'Sunny, 75°F', crew_count: 10,
  },

  // ── 31-112 Maple Commons Retail TI ──
  {
    id: qid(), project_id: '31-112', completed_by: SUPERS['31-112'],
    completed_at: daysAgo(NOW, 4),
    overall_score: avg(4, 5, 4, 4),
    safety_ppe: cat(4, 'PPE compliance verified. Hard hat stickers updated for all crew.'),
    site_conditions: cat(5, 'New job site — excellent initial setup. All protection installed per plan.'),
    issues_concerns: cat(4, 'Permit approval pending for electrical work. Scheduled for Friday.'),
    other_notes: cat(4, 'Mobilization checklist 80% complete. On track for full completion by end of week.'),
    action_items: [
      act('Follow up on electrical permit approval', 'medium', null, daysAgo(NOW, -2)),
    ],
    weather: 'Clear, 69°F', crew_count: 8,
  },
  {
    id: qid(), project_id: '31-112', completed_by: SUPERS['31-112'],
    completed_at: daysAgo(NOW, 11),
    overall_score: avg(5, 4, 5, 5),
    safety_ppe: cat(5, 'All crew wearing full PPE. Safety board posted and current.'),
    site_conditions: cat(4, 'Site layout complete. Material staging areas defined.'),
    issues_concerns: cat(5, 'No issues to report. Smooth mobilization.'),
    other_notes: cat(5, 'Building manager orientation completed. Access badges distributed.'),
    action_items: [],
    weather: 'Partly cloudy, 66°F', crew_count: 6,
  },

  // ── 31-133 Northfield Training Center ──
  {
    id: qid(), project_id: '31-133', completed_by: SUPERS['31-133'],
    completed_at: daysAgo(NOW, 5),
    overall_score: avg(4, 4, 3, 4),
    safety_ppe: cat(4, 'Good compliance. Dust mask usage verified for drywall finishing.'),
    site_conditions: cat(4, 'Work areas clean. Negative air machine running properly.'),
    issues_concerns: cat(3, 'Subcontractor schedule slippage on mechanical rough-in. Meeting with sub scheduled.'),
    other_notes: cat(4, 'Wall inspections passed. Ready for drywall close.'),
    action_items: [
      act('Meeting with mechanical sub re: schedule recovery', 'high', SUPERS['31-133'], daysAgo(NOW, -3)),
    ],
    weather: 'Overcast, 61°F', crew_count: 11,
  },
  {
    id: qid(), project_id: '31-133', completed_by: SUPERS['31-133'],
    completed_at: daysAgo(NOW, 12),
    overall_score: avg(5, 4, 4, 4),
    safety_ppe: cat(5, 'Perfect compliance. Quarterly safety audit completed — no findings.'),
    site_conditions: cat(4, 'Clean and well-organized. New dust barriers installed.'),
    issues_concerns: cat(4, 'Low voltage contractor needs access to plenum — coordinated with HVAC.'),
    other_notes: cat(4, 'Weekly progress photos taken and uploaded.'),
    action_items: [
      act('Coordinate plenum access for low voltage', 'low', null, daysAgo(NOW, -9), true),
    ],
    weather: 'Sunny, 73°F', crew_count: 13,
  },
  {
    id: qid(), project_id: '31-133', completed_by: SUPERS['31-133'],
    completed_at: daysAgo(NOW, 19),
    overall_score: avg(4, 3, 4, 4),
    safety_ppe: cat(4, 'All PPE worn. Ladder inspections current.'),
    site_conditions: cat(3, 'Material congestion in suite 300. Reorganization needed.'),
    issues_concerns: cat(4, 'No major issues. Minor above-ceiling coordination with sprinkler contractor.'),
    other_notes: cat(4, 'Building engineer walk scheduled for next week.'),
    action_items: [
      act('Reorganize material staging in suite 300', 'medium', SUPERS['31-133'], daysAgo(NOW, -15), true),
    ],
    weather: 'Rainy, 56°F', crew_count: 9,
  },

  // ── 31-137 Bayview Coffee Roastery ──
  {
    id: qid(), project_id: '31-137', completed_by: SUPERS['31-137'],
    completed_at: daysAgo(NOW, 2),
    overall_score: avg(5, 5, 5, 5),
    safety_ppe: cat(5, 'Small crew, full compliance. Site de-mobilization safety briefing held.'),
    site_conditions: cat(5, 'Final clean completed. Client-ready condition.'),
    issues_concerns: cat(5, 'All punch items resolved. Final inspections passed.'),
    other_notes: cat(5, 'Closeout documentation 95% complete. Awaiting final as-built markups from MEP subs.'),
    action_items: [
      act('Collect final as-built markups from MEP subs', 'medium', SUPERS['31-137'], daysAgo(NOW, -1)),
    ],
    weather: 'Clear, 72°F', crew_count: 4,
  },
  {
    id: qid(), project_id: '31-137', completed_by: SUPERS['31-137'],
    completed_at: daysAgo(NOW, 9),
    overall_score: avg(5, 4, 4, 5),
    safety_ppe: cat(5, 'Full compliance during de-mobilization activities.'),
    site_conditions: cat(4, 'Removing protection from completed areas. Final clean in progress.'),
    issues_concerns: cat(4, 'Two minor punch items added during owner walkthrough — both cosmetic.'),
    other_notes: cat(5, 'Certificate of occupancy received.'),
    action_items: [
      act('Touch up paint — conference room B', 'low', null, daysAgo(NOW, -5), true),
      act('Adjust door closer — main entry', 'low', null, daysAgo(NOW, -5), true),
    ],
    weather: 'Sunny, 77°F', crew_count: 6,
  },
  {
    id: qid(), project_id: '31-137', completed_by: SUPERS['31-137'],
    completed_at: daysAgo(NOW, 16),
    overall_score: avg(5, 5, 4, 5),
    safety_ppe: cat(5, 'Excellent compliance throughout final phase.'),
    site_conditions: cat(5, 'All areas cleaned and inspected.'),
    issues_concerns: cat(4, 'Final fire alarm test initially failed — retested and passed after adjustment.'),
    other_notes: cat(5, 'Substantial completion achieved.'),
    action_items: [
      act('Fire alarm contractor re-test', 'high', SUPERS['31-137'], daysAgo(NOW, -14), true),
    ],
    weather: 'Partly cloudy, 68°F', crew_count: 8,
  },

  // ── 31-140 Pinecrest Warehouse Office ──
  {
    id: qid(), project_id: '31-140', completed_by: SUPERS['31-140'],
    completed_at: daysAgo(NOW, 1),
    overall_score: avg(4, 4, 3, 4),
    safety_ppe: cat(4, 'All crew wearing PPE. Refresher on confined space entry reviewed.'),
    site_conditions: cat(4, 'Final punch walk areas cleaned and staged for inspection.'),
    issues_concerns: cat(3, 'Three remaining punch items — HVAC diffuser alignment, base trim in kitchen, and door threshold adjustment.'),
    other_notes: cat(4, 'Closeout binder assembly in progress. O&M manuals 80% collected.'),
    action_items: [
      act('HVAC diffuser alignment — kitchen area', 'medium', null, daysAgo(NOW, -2)),
      act('Base trim installation — kitchen', 'low', null, daysAgo(NOW, -2)),
      act('Collect remaining O&M manuals', 'medium', SUPERS['31-140'], daysAgo(NOW, -5)),
    ],
    weather: 'Clear, 74°F', crew_count: 7,
  },
  {
    id: qid(), project_id: '31-140', completed_by: SUPERS['31-140'],
    completed_at: daysAgo(NOW, 8),
    overall_score: avg(4, 4, 4, 4),
    safety_ppe: cat(4, 'Good compliance. Safety signage verified for final inspection day.'),
    site_conditions: cat(4, 'Site in good condition. Final clean crew mobilized.'),
    issues_concerns: cat(4, 'Sprinkler final inspection passed. One head needs adjustment.'),
    other_notes: cat(4, 'Owner training on building systems scheduled for next week.'),
    action_items: [
      act('Adjust sprinkler head — room 205', 'low', null, daysAgo(NOW, -4), true),
    ],
    weather: 'Overcast, 63°F', crew_count: 9,
  },
  {
    id: qid(), project_id: '31-140', completed_by: SUPERS['31-140'],
    completed_at: daysAgo(NOW, 15),
    overall_score: avg(5, 4, 4, 4),
    safety_ppe: cat(5, 'Full compliance. Emergency lighting inspected and operational.'),
    site_conditions: cat(4, 'Good condition. Removing temporary protection from completed spaces.'),
    issues_concerns: cat(4, 'Minor grout color inconsistency in restroom. Touch-up scheduled.'),
    other_notes: cat(4, 'Fire alarm final test scheduled for Wednesday.'),
    action_items: [
      act('Restroom grout touch-up', 'low', null, daysAgo(NOW, -11), true),
    ],
    weather: 'Sunny, 71°F', crew_count: 11,
  },

  // ── 31-144 Oakhurst Dental Suite ──
  {
    id: qid(), project_id: '31-144', completed_by: SUPERS['31-144'],
    completed_at: daysAgo(NOW, 3),
    overall_score: avg(5, 5, 5, 5),
    safety_ppe: cat(5, 'Minimal crew on site — full compliance. Site secured for closeout.'),
    site_conditions: cat(5, 'Fully cleaned. Owner has begun moving furniture in.'),
    issues_concerns: cat(5, 'No outstanding issues. All punch items resolved.'),
    other_notes: cat(5, 'Closeout package submitted. Awaiting final sign-off from owner.'),
    action_items: [],
    weather: 'Clear, 73°F', crew_count: 2,
  },
  {
    id: qid(), project_id: '31-144', completed_by: SUPERS['31-144'],
    completed_at: daysAgo(NOW, 10),
    overall_score: avg(5, 4, 4, 5),
    safety_ppe: cat(5, 'All PPE protocols followed during final walkthrough.'),
    site_conditions: cat(4, 'Equipment being removed. Floor protection still in common areas.'),
    issues_concerns: cat(4, 'Two cosmetic punch items discovered during final walk — minor wall paint and outlet plate.'),
    other_notes: cat(5, 'Fire alarm system acceptance test passed. CO issued.'),
    action_items: [
      act('Wall touch-up paint — suite 101', 'low', SUPERS['31-144'], daysAgo(NOW, -6), true),
      act('Replace outlet plate — reception', 'low', null, daysAgo(NOW, -7), true),
    ],
    weather: 'Partly cloudy, 67°F', crew_count: 5,
  },
  {
    id: qid(), project_id: '31-144', completed_by: SUPERS['31-144'],
    completed_at: daysAgo(NOW, 17),
    overall_score: avg(4, 4, 4, 4),
    safety_ppe: cat(4, 'PPE compliance good. Hard hat requirement remains until all ceiling work complete.'),
    site_conditions: cat(4, 'Clean job site. Materials organized for closeout phase.'),
    issues_concerns: cat(4, 'Light fixture warranty claim in process for defective ballast.'),
    other_notes: cat(4, 'Warranty documentation compilation in progress.'),
    action_items: [
      act('Light fixture warranty claim — defective ballast', 'medium', null, daysAgo(NOW, -10), true),
    ],
    weather: 'Rainy, 59°F', crew_count: 8,
  },
];

// ─── Helper ───────────────────────────────────────────────────────────────────

export function getQualityChecksForProject(projectId: string): QualityCheck[] {
  return mockQualityChecks
    .filter((qc) => qc.project_id === projectId)
    .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());
}

export function getLatestQualityCheck(projectId: string): QualityCheck | null {
  const checks = getQualityChecksForProject(projectId);
  return checks[0] ?? null;
}

export function getAllOpenActionItems(): { project_id: string; item: QCActionItem; check_id: string }[] {
  return mockQualityChecks.flatMap((qc) =>
    qc.action_items
      .filter((ai) => !ai.resolved)
      .map((ai) => ({ project_id: qc.project_id, item: ai, check_id: qc.id })),
  );
}

export function getOverdueQualityChecks(
  projectIds: string[],
  thresholdDays = 7,
): string[] {
  const cutoff = Date.now() - thresholdDays * 86_400_000;
  return projectIds.filter((pid) => {
    const latest = getLatestQualityCheck(pid);
    if (!latest) return true;
    return new Date(latest.completed_at).getTime() < cutoff;
  });
}
