"use client";

import { toast } from "@/modules/shared/components/ui/toaster";

export type DocumentStubActionStatus = "success" | "error";

export interface DocumentStubActionOptions {
  id: string;
  label: string;
  successMessage?: string;
  errorMessage?: string;
  delayMs?: number;
  fail?: boolean | (() => boolean);
}

export interface DocumentStubActionResult {
  actionId: string;
  label: string;
  status: DocumentStubActionStatus;
  message: string;
}

export class DocumentStubActionError extends Error {
  result: DocumentStubActionResult;

  constructor(result: DocumentStubActionResult) {
    super(result.message);
    this.name = "DocumentStubActionError";
    this.result = result;
  }
}

function shouldFail(fail: DocumentStubActionOptions["fail"]): boolean {
  return typeof fail === "function" ? fail() : Boolean(fail);
}

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runDocumentStubAction(
  options: DocumentStubActionOptions,
): Promise<DocumentStubActionResult> {
  // TODO: Replace deterministic local action results with document action API calls.
  await wait(options.delayMs ?? 0);

  const failed = shouldFail(options.fail);
  const result: DocumentStubActionResult = {
    actionId: options.id,
    label: options.label,
    status: failed ? "error" : "success",
    message: failed
      ? options.errorMessage ?? `${options.label} could not be completed.`
      : options.successMessage ?? `${options.label} completed.`,
  };

  if (failed) {
    throw new DocumentStubActionError(result);
  }

  return result;
}

export function notifyDocumentStubAction(result: DocumentStubActionResult): void {
  if (result.status === "success") {
    toast.success(result.label, { description: result.message });
    return;
  }
  toast.error(result.label, { description: result.message });
}

export async function runDocumentStubActionWithToast(
  options: DocumentStubActionOptions,
): Promise<DocumentStubActionResult> {
  try {
    const result = await runDocumentStubAction(options);
    notifyDocumentStubAction(result);
    return result;
  } catch (error) {
    if (error instanceof DocumentStubActionError) {
      notifyDocumentStubAction(error.result);
    }
    throw error;
  }
}
