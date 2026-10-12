import type { Project } from '@/modules/projects/types/project';
import type { Subcontractor } from '@/modules/projects/types/subcontractor';
import type { ChecklistInstance } from '@/modules/projects/types/checklist';
import type { CloseoutItem } from '@/modules/projects/types/closeout';

export interface EvaluatedFlag {
  severity: 'red' | 'yellow';
  flag_text: string;
  flag_type: string;
}

export type HealthStatus = 'green' | 'yellow' | 'red';

export interface HealthResult {
  health: HealthStatus;
  flags: EvaluatedFlag[];
}

function businessDaysBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function calendarDaysSince(isoDate: string): number {
  return (new Date().getTime() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

export function evaluateHealthFlags(
  project: Project,
  subs: Subcontractor[],
  checklists: ChecklistInstance[],
  closeout: CloseoutItem[],
  now?: Date,
): HealthResult {
  const allItems = checklists.flatMap(c => c.sections.flatMap(s => s.items));
  const redFlags: EvaluatedFlag[] = [];
  const yellowFlags: EvaluatedFlag[] = [];

  for (const sub of subs) {
    // Phase 5: replace closeout_docs_status proxy with real payment data from invoices module
    if (
      sub.subcontract_status !== 'signed' &&
      sub.subcontract_status !== 'active' &&
      sub.signed_at === null &&
      sub.closeout_docs_status === 'complete'
    ) {
      redFlags.push({
        severity: 'red',
        flag_type: 'unsigned_paid_sub',
        flag_text: `Unsigned contract — ${sub.company_name} has been paid`,
      });
    }
  }

  for (const item of allItems) {
    if (item.is_completed && /failed/i.test(item.item_text)) {
      redFlags.push({
        severity: 'red',
        flag_type: 'failed_inspection',
        flag_text: 'Failed inspection recorded',
      });
      break;
    }
  }

  if (project.permit_status === 'in_process' && project.start_date) {
    if (calendarDaysSince(project.start_date) > 7) {
      redFlags.push({
        severity: 'red',
        flag_type: 'missing_permit',
        flag_text: 'Missing permit — job started over 7 days ago',
      });
    }
  }

  if (project.phase >= 3) {
    const notInitiated =
      closeout.length === 0 || closeout.every(i => i.status === 'not_started');
    if (notInitiated) {
      redFlags.push({
        severity: 'red',
        flag_type: 'closeout_not_initiated',
        flag_text: 'Closeout not initiated',
      });
    }
  }

  for (const sub of subs) {
    if (sub.subcontract_status === 'sent' && sub.signed_at === null && project.start_date) {
      if (calendarDaysSince(project.start_date) > 14) {
        yellowFlags.push({
          severity: 'yellow',
          flag_type: 'unsigned_subcontract',
          flag_text: `Unsigned subcontract: ${sub.company_name}`,
        });
      }
    }
  }

  if (project.phase >= 2) {
    const preflight = checklists.find(c => c.type === 'preflight');
    if (preflight) {
      const preflightItems = preflight.sections.flatMap(s => s.items);
      if (preflightItems.some(i => !i.is_completed)) {
        yellowFlags.push({
          severity: 'yellow',
          flag_type: 'preflight_incomplete',
          flag_text: 'Mobilization checklist incomplete',
        });
      }
    }
  }

  let evidenceCount = 0;
  for (const item of allItems) {
    if (evidenceCount >= 3) break;
    if (item.requires_photo && item.is_completed && item.photo_url === null) {
      yellowFlags.push({
        severity: 'yellow',
        flag_type: 'missing_evidence',
        flag_text: `Missing evidence: ${item.item_text}`,
      });
      evidenceCount++;
    }
  }

  if (project.phase >= 3) {
    if (closeout.some(i => i.status === 'not_started')) {
      yellowFlags.push({
        severity: 'yellow',
        flag_type: 'closeout_doc_overdue',
        flag_text: 'Closeout doc overdue: closeout items not collected',
      });
    }
  }

  const flags = [...redFlags, ...yellowFlags];
  const health: HealthStatus =
    redFlags.length > 0 ? 'red' : yellowFlags.length > 0 ? 'yellow' : 'green';

  return { health, flags };
}
