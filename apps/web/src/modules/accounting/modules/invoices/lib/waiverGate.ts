export interface WaiverGateCandidate {
  lienWaiverRequired?: boolean;
  linkedLienWaiverId?: string | null;
  lienWaiverStatus?: 'attached' | 'missing' | null;
  waiverOnDocument?: boolean;
}

function hasLinkedWaiver(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function isWaiverGateBlocked(candidate: WaiverGateCandidate): boolean {
  return candidate.lienWaiverRequired === true
    && !hasLinkedWaiver(candidate.linkedLienWaiverId)
    && candidate.lienWaiverStatus !== 'attached'
    && candidate.waiverOnDocument !== true;
}

/**
 * Lien-waiver documents predate the canonical waiver-state fields. Preserve
 * their reverse-pairing workflow until the server sends an explicit state;
 * once it does, the existing server-state gate is authoritative.
 */
export function isManualWaiverLinkingAvailable(candidate: WaiverGateCandidate): boolean {
  const hasCanonicalWaiverState = candidate.lienWaiverRequired !== undefined
    || candidate.lienWaiverStatus === "attached"
    || candidate.waiverOnDocument === true;
  return !hasCanonicalWaiverState || isWaiverGateBlocked(candidate);
}
