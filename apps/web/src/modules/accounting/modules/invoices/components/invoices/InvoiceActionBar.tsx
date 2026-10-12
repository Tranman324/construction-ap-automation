"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Loader2, Save, SkipForward } from "lucide-react";
import { toast } from "@/modules/shared/components/ui/toaster";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { ApprovalState, ApproveInvoiceResponse, ApprovePayload, ClassificationInfo, DiscardInvoiceResponse } from "@/modules/accounting/modules/invoices/types/api";
import { isApiError } from "@/modules/shared/lib/api";
import { useClosedPeriodTrayAction } from "./useClosedPeriodTrayAction";
import { PanelNotice } from "../documents/PanelNotice";
import type { ClosedPeriodTrayAction } from "./invoiceResolveModel";
import {
  getClosedPeriodRecoveryFromDetails,
  getClosedPeriodRecoveryFromError,
  type ClosedPeriodApprovalRecovery,
} from "@/modules/accounting/modules/invoices/lib/approvalRecovery";
import {
  formatMissingApprovalFields,
  type ApprovalDbField,
} from "@/modules/accounting/modules/invoices/lib/approvalValidation";
import type { ApprovalPreview, InvoiceDetailFormHandle } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailForm";
import { DocumentPanelUndoButton } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelFooter";
import {
  formatShortcutTooltip,
  type DocumentPanelShortcutAction,
  useDocumentShortcutLabels,
} from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";
import { useApproveInvoice, useDiscardInvoice, useFileDocument, useUpdateInvoice } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { DEFAULT_MAPPINGS, useValidateApproval } from "@/modules/accounting/modules/invoices/hooks/queries";
import { usesInvoiceWorkflow } from "@/modules/accounting/modules/invoices/lib/documentRouting";
import {
  DUPLICATE_UNRESOLVED_COPY,
  isDuplicateUnresolvedError,
  presentApprovalBlockers,
} from "@/modules/accounting/modules/invoices/lib/duplicateBlocker";
import type { DocumentPanelUndoControl } from "@/modules/accounting/modules/invoices/types/documentSpec";

import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";
import { cn } from "@/modules/shared/lib/utils";

function ShortcutTooltip({
  label,
  shortcut,
  enabled,
  disabledReason,
  children,
}: {
  label: string;
  shortcut: string;
  enabled: boolean;
  disabledReason?: ReactNode;
  children: ReactNode;
}) {
  if (!enabled && !disabledReason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {disabledReason ?? formatShortcutTooltip(label, shortcut)}
      </TooltipContent>
    </Tooltip>
  );
}

// Renders served approval blockers as discrete list items (never run together).
// `blockers` is a clean string[] from the backend — shown as-is, one per line.
function BlockerList({ blockers }: { blockers: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {blockers.map((blocker, index) => (
        <li key={`${index}-${blocker}`}>{blocker}</li>
      ))}
    </ul>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────

interface InvoiceActionBarProps {
  onClosedPeriodRecoveryChange?: (action: ClosedPeriodTrayAction | null) => void;
  invoiceId: string;
  invoice: Invoice;
  classification: string;
  /** Current invoice status — used to suppress Approve on duplicate invoices */
  invoiceStatus?: string;
  formRef: React.RefObject<InvoiceDetailFormHandle | null>;
  hasUnsavedChanges: boolean;
  /** Called after approve succeeds. Defaults to navigating home. */
  onActionSuccess?: () => void;
  /** Called after discard succeeds so navigation can bypass approval-only save guards. */
  onDiscardNav?: () => void;
  onApproveSuccess?: (data: ApproveInvoiceResponse) => void;
  onDiscardSuccess?: (data: DiscardInvoiceResponse) => void;
  /** Called when user clicks Skip — moves to next invoice without any action */
  onSkip?: () => void;
  /** Active duplicate signal: discard (button or Cmd-⌫) asks the server for the canonical duplicate reason. */
  duplicateFlagged?: boolean;
  undoControl?: DocumentPanelUndoControl;
  spectrumSubmitControl?: {
    label: string;
    pending: boolean;
    disabled: boolean;
    onSubmit: () => void;
  };
  /** Live approval parameters selected in the right-panel overrides section. */
  approvalPreview?: ApprovalPreview | null;
  approvalOverrides?: {
    routingCode?: string;
    phaseCode?: string;
    costType?: string;
    glAccount?: string;
  };
  classificationMappings?: readonly ClassificationInfo[];
  hasPendingApprovalSave?: boolean;
  onBeforeApprove?: () => Promise<void>;
  onPrimaryActionChange?: (action: DocumentPanelShortcutAction | null) => void;
  waiverGateBlocked?: boolean;
}

interface QueuedApprovalContinuation {
  invoiceId: string;
  generation: number;
  awaitingSave: boolean;
}

interface ApprovalRecoveryEntry {
  invoiceId: string;
  recovery: ClosedPeriodApprovalRecovery;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoiceActionBar({
  onClosedPeriodRecoveryChange,
  invoiceId,
  invoice,
  classification,
  invoiceStatus,
  formRef,
  hasUnsavedChanges,
  onActionSuccess,
  onDiscardNav,
  onApproveSuccess,
  onDiscardSuccess,
  onSkip,
  duplicateFlagged = false,
  undoControl,
  spectrumSubmitControl,
  approvalPreview,
  approvalOverrides,
  classificationMappings = DEFAULT_MAPPINGS,
  hasPendingApprovalSave = false,
  onBeforeApprove,
  onPrimaryActionChange,
  waiverGateBlocked = false,
}: InvoiceActionBarProps) {
  const shortcuts = useDocumentShortcutLabels();
  const isDuplicate = invoiceStatus === 'duplicate';
  const isDiscarded = invoiceStatus === 'discarded';
  const router = useRouter();
  const nav = () => { if (onActionSuccess) onActionSuccess(); else router.push("/"); };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const { mutate: updateInvoice } = useUpdateInvoice();
  const { mutate: approveInvoice, isPending: isApproving } = useApproveInvoice();
  const { mutate: discardInvoice, isPending: isDiscarding } = useDiscardInvoice();
  const { mutate: fileDocument, isPending: isFiling } = useFileDocument();

  // Server-authoritative approval/coding verdict — the single source for the
  // approval path, required fields, blockers, and coding defaults. There is NO
  // client fallback: when the verdict is unavailable the approve CTA is disabled
  // with an explanation and NEVER computes a path/blockers/defaults on its own.
  const {
    data: approvalState,
    isError: approvalError,
    isFetching: approvalFetching,
  } = useValidateApproval(invoice);
  const approvalReady = !!approvalState && !approvalError;
  const approvalBlockers = approvalReady
    ? presentApprovalBlockers(approvalState.blockers, approvalState.blockerDetails)
    : [];
  // A verdict re-fetch is in flight — e.g. a waiver mutation just invalidated
  // `["validate-approval", id]`. Show Approve as pending ("Checking…") rather
  // than gating on the STALE blockers (which would keep a resolved waiver
  // requirement showing until hard refresh). `placeholderData` keeps the prior
  // verdict visible during the fetch, so `isFetching` is the pending signal.
  const verdictRefetching = approvalFetching;
  // The APPROVE gate is the SERVER verdict ONLY: not ready, re-fetching, or a
  // non-empty served `blockers` array (D1 — includes "Lien Waiver is required").
  // There is NO client-side waiver/missing-field check here.
  const approveBlockedByVerdict = (!approvalReady && !verdictRefetching)
    || (!verdictRefetching && approvalBlockers.length > 0);
  const approvalUnavailableReason = verdictRefetching
    ? "Checking approval requirements…"
    : !approvalReady
      ? (approvalError
          ? "Approval requirements are unavailable. Refresh and try again."
          : "Checking approval requirements…")
      : undefined;
  const approvalDisabledReason: ReactNode = approvalUnavailableReason
    ?? (approvalBlockers.length > 0 ? <BlockerList blockers={approvalBlockers} /> : undefined);
  // Document-panel items show the "Shelve" button instead of Approve.
  const isDocumentLane = !usesInvoiceWorkflow(classification, classificationMappings);
  const isApprovedInvoiceWorkflow = !isDocumentLane && (invoiceStatus === "approved" || invoiceStatus === "modified");

  const [isFormSaving, setIsFormSaving] = useState(false);
  const [isApprovalQueued, setIsApprovalQueued] = useState(false);
  const [closedPeriodRecoveryEntry, setClosedPeriodRecoveryEntry] = useState<ApprovalRecoveryEntry | null>(null);
  const [isRecoverySubmitting, setIsRecoverySubmitting] = useState(false);
  const approvalGenerationRef = useRef(0);
  const activeInvoiceIdRef = useRef(invoiceId);
  const mountedRef = useRef(true);
  const queuedApprovalRef = useRef<QueuedApprovalContinuation | null>(null);
  const recoveryAttemptRef = useRef<string | null>(null);
  const preparedApprovalPayloadRef = useRef<{ invoiceId: string; payload: ApprovePayload } | null>(null);
  const anyPending = isApproving
    || isDiscarding
    || isFiling
    || Boolean(undoControl?.pending)
    || Boolean(spectrumSubmitControl?.pending)
    || isFormSaving
    || isApprovalQueued
    || isRecoverySubmitting;
  const hasSaveBeforeApprove = hasUnsavedChanges || hasPendingApprovalSave;
  // Tray rows account for document-level attention (duplicate/waiver). The
  // Approve label may additionally disclose server-served field blockers, but
  // that count never becomes a local approval decision.
  const fieldBlockerCount = approvalBlockers
    .filter((blocker) => !/lien waiver/i.test(blocker) && blocker !== DUPLICATE_UNRESOLVED_COPY).length;
  const approveActionLabel = hasSaveBeforeApprove ? "Save & Approve" : "Approve";
  const approveLabelWithBlockers = fieldBlockerCount > 0
    ? `${approveActionLabel} · ${fieldBlockerCount} blocked`
    : approveActionLabel;
  const waiverGateMessage = waiverGateBlocked
    ? "A lien waiver is required before this invoice can be approved or submitted."
    : undefined;

  useLayoutEffect(() => {
    if (activeInvoiceIdRef.current !== invoiceId) {
      activeInvoiceIdRef.current = invoiceId;
      approvalGenerationRef.current += 1;
      queuedApprovalRef.current = null;
      preparedApprovalPayloadRef.current = null;
      recoveryAttemptRef.current = null;
      setIsApprovalQueued(false);
      setClosedPeriodRecoveryEntry(null);
      setIsRecoverySubmitting(false);
    }
  }, [invoiceId]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      approvalGenerationRef.current += 1;
      queuedApprovalRef.current = null;
    };
  }, []);

  function triggerFormSave(
    onSuccess?: () => void,
    onError?: (err: Error) => void,
    options?: { suppressErrorToast?: boolean },
  ) {
    const form = formRef.current;
    if (!form) {
      onError?.(new Error("Invoice form is unavailable."));
      return;
    }

    setIsFormSaving(true);
    form.triggerSave(
      () => {
        if (mountedRef.current) setIsFormSaving(false);
        onSuccess?.();
      },
      (err) => {
        if (mountedRef.current) setIsFormSaving(false);
        onError?.(err);
      },
      options,
    );
  }

  function saveFormChangesIfNeeded(): Promise<void> {
    const form = formRef.current;
    if (!form?.hasEdits) return Promise.resolve();

    return new Promise((resolve, reject) => {
      triggerFormSave(
        resolve,
        // Preserve the real server message (e.g. a 409 lock reason) instead of
        // swallowing it behind a generic string, so the approve-error surfaces why.
        (err) => reject(new Error(err?.message || "Failed to save corrections - invoice not approved.")),
        // The approve path renders this failure as the inline approve-error
        // message; suppress the global mutation toast (F1a) so it isn't doubled.
        // (Other triggerFormSave callers keep the toast — it's their only surface.)
        { suppressErrorToast: true },
      );
    });
  }

  async function saveBeforeApproveIfNeeded(isCurrentContinuation: () => boolean): Promise<void> {
    await saveFormChangesIfNeeded();
    if (!isCurrentContinuation()) return;
    if (!onBeforeApprove) return;

    setIsFormSaving(true);
    try {
      await onBeforeApprove();
    } finally {
      if (mountedRef.current) setIsFormSaving(false);
    }
  }

  // ── File logic ────────────────────────────────────────────────────────────
  const [fileError, setFileError] = useState<string | null>(null);

  function handleFile() {
    setFileError(null);

    const form = formRef.current;
    const livePreview = form?.getApprovalPreview?.();
    const liveVendorCode = livePreview?.vendorCode ?? invoice.matching?.vendor?.vendorCode ?? "";
    const liveJobNumber = livePreview?.jobNumber ?? invoice.matching?.job?.jobNumber ?? "";

    // Lien waivers require vendor and job before filing
    if (classification === 'lien-waiver') {
      const missing: string[] = [];
      if (!liveVendorCode) missing.push("Vendor");
      if (!liveJobNumber) missing.push("Job");
      if (missing.length > 0) {
        setFileError(`${missing.join(" and ")} required before filing.`);
        return;
      }
    }

    if (form?.hasEdits) {
      triggerFormSave(() => {
        fileDocument({ id: invoiceId }, { onSuccess: nav });
      });
    } else {
      fileDocument({ id: invoiceId }, { onSuccess: nav });
    }
  }

  // ── Approve logic ────────────────────────────────────────────────────────────
  const approvalOverridesKey = JSON.stringify(approvalOverrides ?? null);
  const [approveErrorState, setApproveErrorState] = useState<{ key: string; message: string | null; blockers?: string[]; closedPeriod?: boolean }>({
    key: approvalOverridesKey,
    message: null,
  });
  const latestApprovalActionRef = useRef<(recoveryOverride?: ClosedPeriodApprovalRecovery) => void>(() => undefined);
  const approveError = approveErrorState.key === approvalOverridesKey
    ? approveErrorState.message
    : null;
  const approveErrorBlockers = approveErrorState.key === approvalOverridesKey
    ? approveErrorState.blockers
    : undefined;
  const previewClosedPeriodRecovery = approvalReady && !verdictRefetching
    ? getClosedPeriodRecoveryFromDetails(approvalState.blockerDetails)
    : null;
  const closedPeriodRecovery = approvalReady && !verdictRefetching
    ? closedPeriodRecoveryEntry?.invoiceId === invoiceId
      ? closedPeriodRecoveryEntry.recovery
      : previewClosedPeriodRecovery
    : null;
  const recoveryAttemptKey = closedPeriodRecovery
    ? `${invoiceId}:${JSON.stringify(closedPeriodRecovery)}`
    : null;
  const recoveryAttempted = recoveryAttemptKey !== null && recoveryAttemptRef.current === recoveryAttemptKey;

  function isCurrentApprovalContinuation(continuation: QueuedApprovalContinuation): boolean {
    return mountedRef.current
      && activeInvoiceIdRef.current === continuation.invoiceId
      && approvalGenerationRef.current === continuation.generation;
  }

  function clearQueuedApproval(continuation?: QueuedApprovalContinuation) {
    if (continuation && queuedApprovalRef.current !== continuation) return;
    queuedApprovalRef.current = null;
    if (mountedRef.current) setIsApprovalQueued(false);
  }

  function beginApprovalContinuation(awaitingSave: boolean): QueuedApprovalContinuation | null {
    if (queuedApprovalRef.current) return null;

    const continuation = {
      invoiceId,
      generation: approvalGenerationRef.current,
      awaitingSave,
    };
    queuedApprovalRef.current = continuation;
    setIsApprovalQueued(true);
    return continuation;
  }

  function queueApproval() {
    const continuation = queuedApprovalRef.current;
    if (continuation) {
      continuation.awaitingSave = false;
      return;
    }

    beginApprovalContinuation(false);
  }

  function buildApprovePayload(verdict: ApprovalState, currentInvoiceDate: string, formInvoiceDate?: string) {
    const raw = invoice as unknown as Record<string, unknown>;
    const cd = verdict.codingDefaults;

    const nonEmpty = (...values: unknown[]) => values.find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    const read = (snake: string, camel: string) => nonEmpty(raw[snake], raw[camel]);

    // Precedence: live form override -> persisted invoice -> served coding
    // default. The served codingDefaults already apply row-value-first
    // precedence and encode the per-path routing default ("D" on path 1/3),
    // so there is no client path-branching here. A routing *suggestion* must
    // NEVER auto-apply at approve — nothing may ride into the payload that is
    // not on the row or in served codingDefaults (routing is derived-and-
    // persisted at match, backend-owned).
    const payload: {
      routingCode?: string;
      phaseCode?: string;
      costType?: string;
      glAccount?: string;
      glDate?: string;
    } = {
      routingCode: nonEmpty(
        approvalOverrides?.routingCode,
        read("routing_code", "routingCode"),
        cd.routingCode ?? undefined,
      ),
      phaseCode: nonEmpty(
        approvalOverrides?.phaseCode,
        read("phase_code", "phaseCode"),
        cd.phaseCode ?? undefined,
      ),
      costType: nonEmpty(
        approvalOverrides?.costType,
        read("cost_type", "costType"),
        cd.costType,
      ),
      glAccount: nonEmpty(
        approvalOverrides?.glAccount,
        read("gl_account", "glAccount"),
        cd.glAccount,
      ),
      glDate: nonEmpty(
        formInvoiceDate,
        read("gl_date", "glDate"),
        cd.glDate ?? undefined,
        invoice.extracted?.glDate,
        currentInvoiceDate,
      ),
    };

    return payload;
  }

  function prepareApproval(verdict: ApprovalState) {
    const livePreview = formRef.current?.getApprovalPreview?.();
    const formInvoiceDate = livePreview?.invoiceDate?.trim()
      || approvalPreview?.invoiceDate?.trim()
      || undefined;
    const currentInvoiceDate = formInvoiceDate ?? invoice.extracted?.invoiceDate ?? "";
    const approvePayload = buildApprovePayload(verdict, currentInvoiceDate, formInvoiceDate);
    preparedApprovalPayloadRef.current = { invoiceId, payload: approvePayload };
    return { blockers: presentApprovalBlockers(verdict.blockers, verdict.blockerDetails), approvePayload };
  }

  // A ready W7 preview can be acted on before the ordinary Approve CTA has
  // prepared a payload. Capture that initial payload once so its recovery CTA
  // follows the same immutable-payload rule as an approve-error recovery.
  useLayoutEffect(() => {
    if (
      !previewClosedPeriodRecovery
      || closedPeriodRecoveryEntry
      || verdictRefetching
      || !approvalReady
      || !approvalState
      || preparedApprovalPayloadRef.current?.invoiceId === invoiceId
    ) return;

    prepareApproval(approvalState);
  });

  function submitApproval(
    approvePayload: ApprovePayload,
    onSettled?: () => void,
    stayOnDetailAfterSuccess = false,
  ) {
    const generation = approvalGenerationRef.current;
    approveInvoice(
      { id: invoiceId, payload: approvePayload },
      {
        onSuccess: (data) => {
          if (mountedRef.current && approvalGenerationRef.current === generation && activeInvoiceIdRef.current === invoiceId) {
            setClosedPeriodRecoveryEntry(null);
            setApproveErrorState({ key: approvalOverridesKey, message: null });
          }
          onApproveSuccess?.(data);
          onSettled?.();
          if (!stayOnDetailAfterSuccess) nav();
        },
        onError: (err: Error) => {
          const closedPeriodError = getClosedPeriodRecoveryFromError(err);
          if (closedPeriodError && mountedRef.current && approvalGenerationRef.current === generation && activeInvoiceIdRef.current === invoiceId) {
            setClosedPeriodRecoveryEntry({ invoiceId, recovery: closedPeriodError });
          }
          if (isApiError(err) && err.status === 400) {
            const backendMissing = err.missing as ApprovalDbField[] | undefined;
            if (backendMissing?.length) {
              setApproveErrorState({
                key: approvalOverridesKey,
                message: `Missing required fields for approval: ${formatMissingApprovalFields(backendMissing)}`,
              });
              onSettled?.();
              return;
            }
          }
          const msg = isDuplicateUnresolvedError(err) ? DUPLICATE_UNRESOLVED_COPY : err.message || "Approval failed.";
          setApproveErrorState({ key: approvalOverridesKey, message: msg, closedPeriod: !!closedPeriodError });
          if (/allocation|multi.?phase|routing/i.test(msg)) {
            document.getElementById("multi-phase-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          onSettled?.();
        },
      }
    );
  }

  function handleClosedPeriodRecovery() {
    if (!closedPeriodRecovery || !recoveryAttemptKey || recoveryAttempted) return;
    const generation = approvalGenerationRef.current;
    const isCurrentRecovery = () => mountedRef.current && approvalGenerationRef.current === generation && activeInvoiceIdRef.current === invoiceId;
    recoveryAttemptRef.current = recoveryAttemptKey;
    setIsRecoverySubmitting(true);
    setApproveErrorState({ key: approvalOverridesKey, message: null });
    updateInvoice(
      { id: invoiceId, payload: { invoiceDate: closedPeriodRecovery.suggestedInvoiceDate } },
      {
        onSuccess: () => {
          if (!isCurrentRecovery()) return;
          setIsRecoverySubmitting(false);
          setClosedPeriodRecoveryEntry(null);
        },
        onError: (err: Error) => {
          if (!isCurrentRecovery()) return;
          setIsRecoverySubmitting(false);
          setApproveErrorState({
            key: approvalOverridesKey,
            message: err.message || "Failed to save the suggested invoice date.",
          });
        },
      },
    );
  }

  function submitLatestApproval() {
    if (verdictRefetching || !approvalReady || !approvalState) {
      queueApproval();
      return;
    }

    // A save-before-approve continuation reaches this point after its save
    // settles. Clear that intent before any terminal outcome or mutation so a
    // later query render cannot replay it.
    clearQueuedApproval();
    const { blockers, approvePayload } = prepareApproval(approvalState);
    if (blockers.length > 0) {
      setApproveErrorState({
        key: approvalOverridesKey,
        message: "Cannot approve:",
        blockers,
      });
      return;
    }

    submitApproval(approvePayload);
  }

  useLayoutEffect(() => {
    latestApprovalActionRef.current = submitLatestApproval;
  });

  useEffect(() => {
    const continuation = queuedApprovalRef.current;
    if (!continuation || continuation.awaitingSave || verdictRefetching) return;

    // Clear first: React Query state can churn after a settled verdict, and a
    // retained token would otherwise make the same intent dispatch twice.
    clearQueuedApproval(continuation);
    if (!isCurrentApprovalContinuation(continuation)) return;

    if (!approvalReady || !approvalState) {
      setApproveErrorState({
        key: approvalOverridesKey,
        message: approvalError
          ? "Approval requirements are unavailable. Refresh and try again."
          : "Still checking approval requirements. Please wait a moment.",
      });
      return;
    }

    if (approvalState.blockers.length > 0) {
      setApproveErrorState({
        key: approvalOverridesKey,
        message: "Cannot approve:",
        blockers: presentApprovalBlockers(approvalState.blockers, approvalState.blockerDetails),
      });
      return;
    }

    // Re-check the token at dispatch and invoke the latest action closure so
    // current form-derived approval data, not the queued render, is submitted.
    if (isCurrentApprovalContinuation(continuation)) {
      latestApprovalActionRef.current();
    }
  }, [
    approvalError,
    approvalOverridesKey,
    approvalReady,
    approvalState,
    isApprovalQueued,
    verdictRefetching,
  ]);

  function handleApprove() {
    // No client waiver/missing-field gate: the served `blockers` are authoritative.
    setApproveErrorState({ key: approvalOverridesKey, message: null });

    // A fresh, ready blocker verdict is terminal and must preserve the existing
    // blocker display. A transient verdict wait, however, still takes the
    // ordinary save-before-approve path before its continuation queues.
    if (!verdictRefetching && approvalReady && approvalState?.blockers.length) {
      setApproveErrorState({
        key: approvalOverridesKey,
        message: "Cannot approve:",
        blockers: approvalBlockers,
      });
      return;
    }

    const form = formRef.current;
    if (form?.hasEdits || hasPendingApprovalSave) {
      // Claim the intent synchronously, before the asynchronous save starts.
      // This closes the re-entrant click window where two callers could each
      // save the same edits before either reaches the verdict continuation.
      const continuation = beginApprovalContinuation(true);
      if (!continuation) return;
      const isCurrentContinuation = () => (
        mountedRef.current
        && activeInvoiceIdRef.current === continuation.invoiceId
        && approvalGenerationRef.current === continuation.generation
      );

      void saveBeforeApproveIfNeeded(isCurrentContinuation)
        .then(() => {
          if (!isCurrentContinuation()) return;
          continuation.awaitingSave = false;
          latestApprovalActionRef.current();
        })
        .catch((err: Error) => {
          if (!isCurrentContinuation()) return;
          clearQueuedApproval(continuation);
          setApproveErrorState({
            key: approvalOverridesKey,
            message: err.message || "Failed to save corrections - invoice not approved.",
          });
        });
    } else {
      latestApprovalActionRef.current();
    }
  }

  useEffect(() => {
    if (!onPrimaryActionChange) return undefined;

    if (isDiscarded) {
      onPrimaryActionChange(null);
      return undefined;
    }

    if (isDocumentLane) {
      onPrimaryActionChange({
        label: hasUnsavedChanges ? "Save & Shelve" : "Shelve",
        disabled: anyPending,
        run: handleFile,
      });
      return () => onPrimaryActionChange(null);
    }

    if (isApprovedInvoiceWorkflow) {
      if (!spectrumSubmitControl) {
        onPrimaryActionChange(null);
        return undefined;
      }
      onPrimaryActionChange({
        label: spectrumSubmitControl.label,
        disabled: anyPending || spectrumSubmitControl.disabled || waiverGateBlocked,
        run: spectrumSubmitControl.onSubmit,
      });
      return () => onPrimaryActionChange(null);
    }

    if (isDuplicate) {
      onPrimaryActionChange(null);
      return undefined;
    }

    onPrimaryActionChange({
      label: isApprovalQueued || verdictRefetching ? "Checking…" : approveLabelWithBlockers,
      disabled: anyPending || approveBlockedByVerdict,
      run: handleApprove,
    });
    return () => onPrimaryActionChange(null);
  });

  // ── Discard logic ───────────────────────────────────────────────────────────
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  function handleDiscardClick() {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    discardInvoice(
      duplicateFlagged ? { id: invoiceId, duplicateContext: true } : { id: invoiceId },
      {
        onSuccess: (data) => {
          onDiscardSuccess?.(data);
          setConfirmDiscard(false);
          if (onDiscardNav) onDiscardNav();
          else nav();
        },
        onError: (error) => {
          setConfirmDiscard(false);
          const message = isApiError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : "Please try again.";
          toast.error("Discard failed", { description: message });
        },
      }
    );
  }

  useClosedPeriodTrayAction(invoiceId, closedPeriodRecovery, anyPending || recoveryAttempted,
    handleClosedPeriodRecovery, onClosedPeriodRecoveryChange);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={150}>
      {/* Error message */}
      {approveError && !(approveErrorState.closedPeriod && closedPeriodRecovery) && (
        <PanelNotice id="approval-error" label="Approval failed">
        <div className="text-xs text-destructive mb-2">
          <p>{approveError}</p>
          {approveErrorBlockers && approveErrorBlockers.length > 0 && (
            <div className="mt-0.5">
              <BlockerList blockers={approveErrorBlockers} />
            </div>
          )}
        </div>
        </PanelNotice>
      )}
      {fileError && (
        <PanelNotice id="filing-error" label="Filing failed">
        <p className="text-xs text-destructive mb-2">{fileError}</p>
        </PanelNotice>
      )}

      {/* Button row */}
      <div className="flex items-center gap-2">
        {/* Left — Discard (hidden when already discarded) */}
        {!isDiscarded && (
        <PermissionGate requires="accounting.invoices.delete">
          <Button
            data-invoice-discard="true"
            title={formatShortcutTooltip("Discard", shortcuts.discard)}
            variant={confirmDiscard ? "destructive" : "outline"}
            className={cn(
              !confirmDiscard && "border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive",
            )}
            disabled={anyPending}
            onClick={handleDiscardClick}
          >
            {isDiscarding ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-destructive border-t-transparent animate-spin" />
                Discarding…
              </span>
            ) : confirmDiscard ? "Confirm Discard" : "Discard"}
          </Button>
        </PermissionGate>
        )}

        {/* Save — only visible when there are unsaved edits (and not discarded) */}
        {hasUnsavedChanges && !isDiscarded && (
          <ShortcutTooltip label="Save" shortcut={shortcuts.save} enabled={!anyPending && !isFormSaving}>
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={anyPending || isFormSaving}
              onClick={() => {
                triggerFormSave();
              }}
            >
              {isFormSaving ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Saving…
                </span>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  Save
                </>
              )}
            </Button>
          </ShortcutTooltip>
        )}

        {/* Right — Shelve (for document-lane items) or Approve (for invoice-lane items) */}
        <div className="ml-auto flex items-center gap-2">
        {onSkip && (
          <ShortcutTooltip label={hasUnsavedChanges ? "Save & Skip" : "Skip"} shortcut={shortcuts.next} enabled={!anyPending}>
            <Button
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              disabled={anyPending}
              aria-keyshortcuts={!anyPending ? shortcuts.nextAria : undefined}
              onClick={() => {
                const form = formRef.current;
                if (form?.hasEdits) {
                  triggerFormSave(
                    () => onSkip(),
                    () => { /* save failed — stay on page */ }
                  );
                } else {
                  onSkip();
                }
              }}
            >
              {hasUnsavedChanges ? "Save & Skip" : "Skip"}
              <SkipForward className="h-4 w-4" />
            </Button>
          </ShortcutTooltip>
        )}
        {isApprovedInvoiceWorkflow && undoControl?.label === "Undo Approve" ? (
          <DocumentPanelUndoButton undoControl={undoControl} />
        ) : !isApprovedInvoiceWorkflow && undoControl ? (
          <DocumentPanelUndoButton undoControl={undoControl} />
        ) : null}
        {isDiscarded ? null : isDocumentLane ? (
          <PermissionGate requires="accounting.invoices.view_details">
            <ShortcutTooltip label={hasUnsavedChanges ? "Save & Shelve" : "Shelve"} shortcut={shortcuts.primary} enabled={!anyPending}>
              <Button
                className="gap-2"
                variant="outline"
                disabled={anyPending}
                aria-keyshortcuts={!anyPending ? shortcuts.primaryAria : undefined}
                onClick={handleFile}
              >
                {isFiling ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    {hasUnsavedChanges ? "Saving & Shelving…" : "Shelving…"}
                  </span>
                ) : hasUnsavedChanges ? "Save & Shelve" : "Shelve"}
              </Button>
            </ShortcutTooltip>
          </PermissionGate>
        ) : !isDuplicate && (
          isApprovedInvoiceWorkflow ? (
            spectrumSubmitControl ? (
              <PermissionGate requires="accounting.invoices.submit_spectrum">
                <ShortcutTooltip
                  label={spectrumSubmitControl.label}
                  shortcut={shortcuts.primary}
                  enabled={!anyPending && !spectrumSubmitControl.disabled && !waiverGateBlocked}
                  disabledReason={waiverGateMessage}
                >
                  <Button
                    disabled={anyPending || spectrumSubmitControl.disabled || waiverGateBlocked}
                    aria-keyshortcuts={!anyPending && !spectrumSubmitControl.disabled && !waiverGateBlocked ? shortcuts.primaryAria : undefined}
                    onClick={spectrumSubmitControl.onSubmit}
                  >
                    {spectrumSubmitControl.pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {spectrumSubmitControl.label}
                  </Button>
                </ShortcutTooltip>
              </PermissionGate>
            ) : null
          ) : (
            <PermissionGate requires="accounting.invoices.approve">
              <ShortcutTooltip
                label={hasSaveBeforeApprove ? "Save & Approve" : "Approve"}
                shortcut={shortcuts.primary}
                enabled={!anyPending && !approveBlockedByVerdict}
                disabledReason={approvalDisabledReason}
              >
                <Button
                  disabled={anyPending || approveBlockedByVerdict}
                  aria-label={fieldBlockerCount > 0 ? approveActionLabel : undefined}
                  aria-keyshortcuts={!anyPending && !approveBlockedByVerdict ? shortcuts.primaryAria : undefined}
                  onClick={handleApprove}
                >
                  {isApproving ? (
                    <span className="flex items-center gap-2">
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      {hasSaveBeforeApprove ? "Saving & Approving…" : "Approving…"}
                    </span>
                  ) : isApprovalQueued || verdictRefetching ? (
                    <span className="flex items-center gap-2">
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Checking…
                    </span>
                ) : approveLabelWithBlockers}
                </Button>
              </ShortcutTooltip>
            </PermissionGate>
          )
        )}
        </div>
      </div>
    </TooltipProvider>
  );
}
