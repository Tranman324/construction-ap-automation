import type { SpectrumSubmitCandidate } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import { isWaiverGateBlocked } from "@/modules/accounting/modules/invoices/lib/waiverGate";

export type SpectrumSubmitWarningCode =
  | "missing-waiver"
  | "missing-job"
  | "missing-vendor"
  | "missing-amount";

export interface SpectrumSubmitWarning {
  code: SpectrumSubmitWarningCode;
  label: string;
  count: number;
}

export interface SpectrumSubmitPrecheckSummary {
  affectedCount: number;
  blockingWaiverCount: number;
  warnings: SpectrumSubmitWarning[];
}

interface WarningDefinition {
  code: SpectrumSubmitWarningCode;
  label: string;
  matches: (candidate: SpectrumSubmitCandidate) => boolean;
}

function hasText(value: string | null): boolean {
  return Boolean(value?.trim());
}

function isMissingAmount(value: number | null): boolean {
  return typeof value !== "number" || !Number.isFinite(value);
}

function needsWaiver(candidate: SpectrumSubmitCandidate): boolean {
  return isWaiverGateBlocked(candidate);
}

const WARNING_DEFINITIONS: WarningDefinition[] = [
  {
    code: "missing-waiver",
    label: "Missing lien waiver",
    matches: needsWaiver,
  },
  {
    code: "missing-job",
    label: "Missing job",
    matches: (candidate) => !hasText(candidate.jobNumber),
  },
  {
    code: "missing-vendor",
    label: "Missing vendor",
    matches: (candidate) => !hasText(candidate.vendorName),
  },
  {
    code: "missing-amount",
    label: "Missing amount",
    matches: (candidate) => isMissingAmount(candidate.amount),
  },
];

export function deriveSpectrumSubmitPrechecks(
  candidates: SpectrumSubmitCandidate[],
): SpectrumSubmitPrecheckSummary {
  const affectedIds = new Set<string>();
  const warnings = WARNING_DEFINITIONS.flatMap((definition) => {
    const matchingCandidates = candidates.filter((candidate) => definition.matches(candidate));

    matchingCandidates.forEach((candidate) => affectedIds.add(candidate.id));

    return matchingCandidates.length > 0
      ? [{ code: definition.code, label: definition.label, count: matchingCandidates.length }]
      : [];
  });

  return {
    affectedCount: affectedIds.size,
    blockingWaiverCount: candidates.filter(needsWaiver).length,
    warnings,
  };
}
