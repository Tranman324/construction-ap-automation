import type { Subcontractor, SubcontractStatus } from '@/modules/projects/types/subcontractor';

async function loadSubcontractors() {
  return import('@/modules/projects/mock/subcontractors');
}

export async function addSubcontractor(
  input: Omit<
    Subcontractor,
    | 'id'
    | 'signed_at'
    | 'closeout_docs_status'
    | 'vendor_code'
    | 'contract_amount'
    | 'billed_amount'
    | 'outstanding_ap_balance'
    | 'billed_percent'
  >,
): Promise<Subcontractor> {
  const { mockSubcontractors } = await loadSubcontractors();
  const newSub: Subcontractor = {
    ...input,
    id: `sub-local-${Date.now()}`,
    signed_at: null,
    closeout_docs_status: 'not_started',
    vendor_code: null,
    contract_amount: null,
    billed_amount: null,
    outstanding_ap_balance: null,
    billed_percent: null,
  };
  mockSubcontractors.push(newSub);
  return newSub;
}

export async function updateSubStatus(subId: string, status: SubcontractStatus): Promise<void> {
  const { mockSubcontractors } = await loadSubcontractors();
  const sub = mockSubcontractors.find(s => s.id === subId);
  if (!sub) return;
  sub.subcontract_status = status;
  if (status === 'signed' && !sub.signed_at) {
    sub.signed_at = new Date().toISOString();
  }
}

export async function removeSubcontractor(subId: string): Promise<void> {
  const { mockSubcontractors } = await loadSubcontractors();
  const idx = mockSubcontractors.findIndex(s => s.id === subId);
  if (idx !== -1) mockSubcontractors.splice(idx, 1);
}
