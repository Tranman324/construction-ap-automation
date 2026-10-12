export type W9TaxIdType = "ssn" | "feid";
export type W9SubmissionPhase = "idle" | "submitting" | "complete" | "error";
export type W9ProgressStatus = "done" | "active" | "todo" | "error";
export type W9ProgressStepId = "generate-code" | "create-vendor" | "tracking" | "upload";

export interface W9ProgressStep {
  id: W9ProgressStepId;
  label: string;
}

export interface W9ProgressState {
  phase: W9SubmissionPhase;
  activeStepId: W9ProgressStepId | null;
  failedStepId: W9ProgressStepId | null;
}

export interface W9ProgressLine extends W9ProgressStep {
  status: W9ProgressStatus;
}

export interface W9ProgressSummary {
  percent: number;
  lines: readonly W9ProgressLine[];
}

export interface W9ValidationInput {
  vendorName: string;
  vendorType: string;
  taxClass: string;
  taxId: string;
}

export interface W9ValidationResult {
  valid: boolean;
  nameOk: boolean;
  typeOk: boolean;
  taxClassOk: boolean;
  taxIdOk: boolean;
}

export const W9_PROGRESS_STEPS: readonly W9ProgressStep[] = [
  { id: "generate-code", label: "Generate vendor code" },
  { id: "create-vendor", label: "Create vendor in Spectrum" },
  { id: "tracking", label: "Create tracking item" },
  { id: "upload", label: "Upload W-9 document" },
];

export const W9_IDLE_PROGRESS: W9ProgressState = {
  phase: "idle",
  activeStepId: null,
  failedStepId: null,
};

export function digitsOnly(value: string, maxLength?: number): string {
  const digits = value.replace(/\D/g, "");
  return maxLength === undefined ? digits : digits.slice(0, maxLength);
}

export function maskW9TaxId(value: string, type: W9TaxIdType): string {
  const digits = digitsOnly(value, 9);
  if (type === "ssn") {
    const first = digits.slice(0, 3);
    const second = digits.slice(3, 5);
    const third = digits.slice(5, 9);
    return [first, second, third].filter(Boolean).join("-");
  }
  const first = digits.slice(0, 2);
  const second = digits.slice(2, 9);
  return [first, second].filter(Boolean).join("-");
}

export function maskW9Phone(value: string): string {
  const digits = digitsOnly(value, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function maskW9Zip(value: string): string {
  const digits = digitsOnly(value, 9);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export function deriveW9VendorCodePreview(name: string): string {
  const cleaned = name.replace(/[^a-z0-9]/gi, "");
  const prefix = cleaned.slice(0, 4).toUpperCase().padEnd(4, "X");
  const checksum = Array.from(name).reduce((total, char) => (total + char.charCodeAt(0)) % 97, 0);
  return `${prefix}${String((checksum % 9) + 1).padStart(2, "0")}`;
}

export function validateW9Identity(input: W9ValidationInput): W9ValidationResult {
  const nameOk = input.vendorName.trim().length > 0;
  const typeOk = input.vendorType.trim().length > 0;
  const taxClassOk = input.taxClass.trim().length > 0;
  const taxIdOk = digitsOnly(input.taxId).length === 9;
  return {
    valid: nameOk && typeOk && taxClassOk && taxIdOk,
    nameOk,
    typeOk,
    taxClassOk,
    taxIdOk,
  };
}

export function startW9Progress(): W9ProgressState {
  return {
    phase: "submitting",
    activeStepId: W9_PROGRESS_STEPS[0].id,
    failedStepId: null,
  };
}

export function setW9ActiveStep(stepId: W9ProgressStepId): W9ProgressState {
  return { phase: "submitting", activeStepId: stepId, failedStepId: null };
}

export function completeW9Progress(): W9ProgressState {
  return { phase: "complete", activeStepId: null, failedStepId: null };
}

export function failW9Progress(stepId: W9ProgressStepId): W9ProgressState {
  return { phase: "error", activeStepId: null, failedStepId: stepId };
}

export function retryW9Progress(progress: W9ProgressState): W9ProgressState {
  return {
    phase: "submitting",
    activeStepId: progress.failedStepId ?? W9_PROGRESS_STEPS[0].id,
    failedStepId: null,
  };
}

function stepIndex(stepId: W9ProgressStepId | null): number {
  return Math.max(W9_PROGRESS_STEPS.findIndex((step) => step.id === stepId), 0);
}

export function deriveW9Progress(progress: W9ProgressState): W9ProgressSummary {
  const activeIndex = stepIndex(progress.activeStepId);
  const failedIndex = stepIndex(progress.failedStepId);
  const doneCount = progress.phase === "complete"
    ? W9_PROGRESS_STEPS.length
    : progress.phase === "error"
      ? failedIndex
      : progress.phase === "submitting"
        ? activeIndex
        : 0;

  return {
    percent: Math.round((doneCount / W9_PROGRESS_STEPS.length) * 100),
    lines: W9_PROGRESS_STEPS.map((step, index) => {
      let status: W9ProgressStatus = "todo";
      if (progress.phase === "complete" || index < doneCount) status = "done";
      if (progress.phase === "submitting" && step.id === progress.activeStepId) status = "active";
      if (progress.phase === "error" && step.id === progress.failedStepId) status = "error";
      return { ...step, status };
    }),
  };
}

export function shouldSimulateW9UploadFailure(taxId: string): boolean {
  return digitsOnly(taxId).endsWith("7");
}
