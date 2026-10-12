"use client";
import { PanelNotice } from "../documents/PanelNotice";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, SlidersHorizontal, X, XCircle } from "lucide-react";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type {
  InvoiceUpdatePayload,
  PhaseCodeOption,
  RoutingCodeOption,
  Subcontract,
  SubmitResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import { isApiError } from "@/modules/shared/lib/api";
import { useSubmitToSpectrum, useUpdateInvoice } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useApprovalSchema, useCostTypes, usePhaseCodes, useRoutingCodes, useSubcontracts, useValidateApproval } from "@/modules/accounting/modules/invoices/hooks/queries";

import { cn } from "@/modules/shared/lib/utils";
import { Input } from "@/modules/shared/components/ui/input";
import { Field } from "@/modules/shared/components/patterns/Field";
import { getInvoiceFieldState } from "@/modules/shared/components/patterns/invoiceFieldState";
import type { ApprovalPreview } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailForm";
import {
  isSpectrumSubmitReturnVisit,
  markSpectrumSubmitFailureWorkflowInvoiceFailed,
  markSpectrumSubmitFailureWorkflowInvoiceSubmitted,
  readSpectrumSubmitFailureWorkflowSnapshot,
  writeSpectrumSubmitFailureWorkflowSnapshot,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitFailureWorkflowModel";
import {
  getSpectrumSubmitErrorDetailDisplay,
  getSpectrumSubmitPreflightErrors,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import {
  ComboboxShell,
  CommandItem,
  Check,
} from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/ComboboxShell";
import { GlAccountDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/GlAccountDropdown";

interface SpectrumSubmitSectionProps {
  invoice: Invoice;
  approvalPreview?: ApprovalPreview | null;
  onOverrideChange?: (overrides: ApprovalOverrideValues) => void;
  onSubmitControlChange?: (control: SpectrumSubmitFooterControl | null) => void;
  onBeforeSubmit?: (payload: InvoiceUpdatePayload) => Promise<void>;
  onSubmitSettled?: () => void;
  waiverGateBlocked?: boolean;
}

export interface ApprovalOverrideValues {
  routingCode?: string;
  phaseCode?: string;
  glAccount?: string;
  costType?: string;
}

export interface SpectrumSubmitFooterControl {
  label: string;
  pending: boolean;
  disabled: boolean;
  onSubmit: () => void;
}

type SubmitOverrides = {
  routing_code?: string;
  phase_code?: string;
  gl_account?: string;
  cost_type?: string;
  gl_date?: string;
};

type SubmitFeedbackState = {
  ok: boolean;
  message: string;
  details?: string[];
  preflightErrors?: string[];
} | null;

interface SpectrumOverrideState {
  key: string;
  // null = untouched: the field falls through to the served/saved default for
  // display. A string (including "" for an explicit clear) = a user selection
  // that is pinned and survives verdict refetches (M-001).
  routingCode: string | null;
  phaseCode: string | null;
  glAccount: string | null;
  costType: string | null;
  /** GL value currently owned by automatic cost-type derivation. */
  derivedGlAccount: string | null;
  submitState: SubmitFeedbackState;
  lastSubmitError: string | null;
  lastSubmitPreflightErrors: string[];
}

function buildSpectrumOverrideState(
  key: string,
  lastSubmitError: string | null,
): SpectrumOverrideState {
  return {
    key,
    routingCode: null,
    phaseCode: null,
    glAccount: null,
    costType: null,
    derivedGlAccount: null,
    submitState: null,
    lastSubmitError,
    lastSubmitPreflightErrors: [],
  };
}

function SpectrumSubmitPreflightErrors({ errors }: { errors: readonly string[] | undefined }) {
  const display = getSpectrumSubmitErrorDetailDisplay(errors);
  if (display.errors.length === 0) return null;

  return (
    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs">
      {display.errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
      {display.remainingCount > 0 && <li>+{display.remainingCount} more</li>}
    </ul>
  );
}

function InlineClearButton({
  onClear,
  disabled,
  ariaLabel,
  className,
}: {
  onClear: () => void;
  disabled: boolean;
  ariaLabel: string;
  className: string;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClear();
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        className
      )}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

export function SpectrumSubmitSection({
  invoice,
  approvalPreview,
  onOverrideChange,
  onSubmitControlChange,
  onBeforeSubmit,
  onSubmitSettled,
  waiverGateBlocked = false,
}: SpectrumSubmitSectionProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const submit = useSubmitToSpectrum();
  const updateInvoice = useUpdateInvoice();
  const submittingRef = useRef(false);
  const submitHandlerRef = useRef<() => void>(() => undefined);
  const latestSubmitRef = useRef<() => void>(() => undefined);
  const submitGenerationRef = useRef(0);
  const activeInvoiceIdRef = useRef(invoice.id);
  const mountedRef = useRef(true);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const jobNumber = approvalPreview?.jobNumber || invoice.matching?.job?.jobNumber || invoice.extracted?.jobNumber || "";
  const hasJob = Boolean(jobNumber);
  const vendorCode = approvalPreview?.vendorCode || invoice.matching?.vendor?.vendorCode || "";
  const subcontractNumber = approvalPreview?.subcontractNumber || invoice.matching?.subcontract?.subcontractNumber || "";
  const { data: subcontracts = [] } = useSubcontracts(vendorCode || undefined, jobNumber || undefined);

  const { data: routingData, isError: routingError } = useRoutingCodes();
  const { data: phaseData } = usePhaseCodes();
  const { data: costTypesData, isError: costTypesError } = useCostTypes();
  // Spectrum cost-type→GL master, served from approvalRules.json. Never copied
  // into a client constant — it would drift from the backend that enforces it.
  const { data: approvalSchema } = useApprovalSchema();
  // Server-authoritative approval/coding verdict. codingDefaults replace the
  // former client derivedGlAccount/derivedCostType literals; the routing
  // suggestion replaces the client PM→routing default. No client fallback.
  const { data: approvalState } = useValidateApproval(invoice);
  const routingCodes = useMemo<RoutingCodeOption[]>(
    () => routingData?.routing_codes ?? [],
    [routingData?.routing_codes],
  );
  const phaseCodes = useMemo<PhaseCodeOption[]>(
    () => phaseData?.phase_codes ?? [],
    [phaseData?.phase_codes],
  );
  const costTypeOptions = useMemo(
    () => costTypesData?.costTypes ?? [],
    [costTypesData?.costTypes],
  );
  const costTypeLabels = useMemo(
    () => Object.fromEntries(costTypeOptions.map((c) => [c.value, c.label])) as Record<string, string>,
    [costTypeOptions],
  );
  const costTypesUnavailable = costTypesError || costTypeOptions.length === 0;
  const costTypeGlMapSource = approvalSchema?.codingDefaults?.costTypeGlMap?.map;
  const costTypeGlMapReady = Object.entries(costTypeGlMapSource ?? {}).some(
    ([costType, glAccount]) =>
      costType.trim().length > 0
      && typeof glAccount === "string"
      && glAccount.trim().length > 0,
  );
  const costTypeGlMap = useMemo(() => costTypeGlMapSource ?? {}, [costTypeGlMapSource]);
  // Spectrum's required distribution GL for a cost type. Mirrors the backend's
  // glAccountForCostType: trimmed + upper-cased lookup, null when the cost type
  // is unmapped (e.g. 'L', which has no GL in the master) so the GL is left as-is.
  const glAccountForCostType = useCallback((value: string | null | undefined): string | null => {
    if (!value || typeof value !== "string") return null;
    const mappedGlAccount = costTypeGlMap[value.trim().toUpperCase()];
    if (typeof mappedGlAccount !== "string") return null;
    return mappedGlAccount.trim() || null;
  }, [costTypeGlMap]);

  const hasSubcontract = !!subcontractNumber;
  const matchedSubcontract = subcontracts.find(
    (subcontract: Subcontract) => subcontract.subcontractNumber === subcontractNumber
  );
  const subcontractMissingFromBackend = hasSubcontract && !matchedSubcontract;

  // Coding defaults come from the served approval verdict (row-value-first
  // precedence applied server-side). No client "5450"/"5300"/"S"/"M"/"D"
  // literals: before the verdict resolves the served values are empty and each
  // field falls back to the invoice's own saved value only.
  const coding = approvalState?.codingDefaults;
  const servedGlAccount = coding?.glAccount ?? "";
  const servedCostType = coding?.costType ?? "";
  const servedPhaseCode = coding?.phaseCode ?? "";
  const servedRoutingCode = coding?.routingCode ?? approvalState?.suggestedRoutingCode ?? "";

  // Served (multi-phase-aware) required columns. A multi-phase-allocated invoice
  // drops phase_code/cost_type from this list — each allocation carries its own —
  // so those labels lose their required marker accordingly.
  const requiredFields = approvalState?.requiredFields ?? [];
  const requires = (column: string) => requiredFields.includes(column);

  // Prefer the invoice's own saved values (from a prior approval or manual
  // edit) over the auto-derived defaults. This prevents the UI from
  // reverting user-saved phase_code / gl_account / cost_type / routing_code
  // back to auto-derived values every time the page loads.
  const inv = invoice as unknown as Record<string, unknown>;
  const savedRouting = (inv.routing_code ?? inv.routingCode ?? "") as string;
  const savedPhase = (inv.phase_code ?? inv.phaseCode ?? "") as string;
  const savedGl = (inv.gl_account ?? inv.glAccount ?? "") as string;
  const savedCost = (inv.cost_type ?? inv.costType ?? "") as string;
  const savedGlDate = (inv.gl_date ?? inv.glDate ?? invoice.extracted?.glDate ?? "") as string;

  const defaultRoutingCodeFinal = savedRouting || servedRoutingCode;
  const defaultPhaseCode = savedPhase || servedPhaseCode;
  const defaultGlAccount = savedGl || servedGlAccount;
  const defaultCostType = savedCost || servedCostType;
  const submitGlDate = approvalPreview?.invoiceDate || savedGlDate || invoice.extracted?.invoiceDate || "";
  // Override identity is invoice-only (id + last Spectrum error). It deliberately
  // does NOT include the served/saved default values, so a verdict refetch never
  // rebuilds the override state and never clobbers a user's selection (M-001).
  const overrideKey = `${invoice.id}|${invoice.lastSpectrumError ?? ""}`;
  const [overrideState, setOverrideState] = useState<SpectrumOverrideState>(() =>
    buildSpectrumOverrideState(overrideKey, invoice.lastSpectrumError ?? null),
  );
  const currentOverrideState = overrideState.key === overrideKey
    ? overrideState
    : buildSpectrumOverrideState(overrideKey, invoice.lastSpectrumError ?? null);
  type CodingField = "routingCode" | "phaseCode" | "glAccount" | "costType";
  const selectionEpoch = useRef({ key: overrideKey, generations: {} as Partial<Record<CodingField, number>> });
  useLayoutEffect(() => {
    selectionEpoch.current = { key: overrideKey, generations: {} };
    return () => { selectionEpoch.current = { key: "", generations: {} }; };
  }, [overrideKey]);
  // Untouched fields (null) resolve to the served/saved default for display; a
  // user selection (or explicit clear to "") pins the field and wins here.
  const routingCode = String(currentOverrideState.routingCode ?? defaultRoutingCodeFinal);
  const phaseCode = String(currentOverrideState.phaseCode ?? defaultPhaseCode);
  const glAccount = String(currentOverrideState.glAccount ?? defaultGlAccount);
  const costType = String(currentOverrideState.costType ?? defaultCostType);
  const { submitState, lastSubmitError, lastSubmitPreflightErrors } = currentOverrideState;
  const [observedCostTypeGlMap, setObservedCostTypeGlMap] = useState(costTypeGlMap);

  // React's guarded render-time adjustment reconciles a refetched served map
  // before this render commits. Only state still owned by derivation is updated;
  // manual GL selection clears ownership and is therefore preserved.
  if (observedCostTypeGlMap !== costTypeGlMap) {
    setObservedCostTypeGlMap(costTypeGlMap);
    const mappedGl = glAccountForCostType(costType);
    const ownsCurrentGl =
      currentOverrideState.derivedGlAccount !== null
      && currentOverrideState.glAccount === currentOverrideState.derivedGlAccount;
    if (mappedGl && ownsCurrentGl && currentOverrideState.derivedGlAccount !== mappedGl) {
      setOverrideState({
        ...currentOverrideState,
        glAccount: mappedGl,
        derivedGlAccount: mappedGl,
      });
    }
  }

  function updateOverrideState(
    updater: (state: SpectrumOverrideState) => SpectrumOverrideState,
  ) {
    setOverrideState((prev) => {
      const base = prev.key === overrideKey
        ? prev
        : buildSpectrumOverrideState(overrideKey, invoice.lastSpectrumError ?? null);
      return updater(base);
    });
  }

  function persistSelection(payload: InvoiceUpdatePayload) {
    if (invoice.status !== "approved") {
      const epoch = selectionEpoch.current;
      const fields = (["routingCode", "phaseCode", "glAccount", "costType"] as const).filter((field) => field in payload);
      const generations = Object.fromEntries(fields.map((field) => {
        const generation = (epoch.generations[field] ?? 0) + 1;
        epoch.generations[field] = generation;
        return [field, generation];
      }));
      void updateInvoice.mutateAsync({ id: invoice.id, payload }).then((response) => {
          // Cached equality is not acknowledgment: A→B→A must keep the newer
          // A draft until its own request succeeds. Never clear a newer edit.
          if (selectionEpoch.current !== epoch) return;
          const accepted = response?.invoice;
          if (!accepted || accepted.id !== invoice.id) return;
          const raw = accepted as unknown as Record<string, unknown>;
          const columns = { routingCode: "routing_code", phaseCode: "phase_code", glAccount: "gl_account", costType: "cost_type" };
          setOverrideState((state) => {
            if (state.key !== epoch.key) return state;
            const acknowledged = new Set(fields.filter((field) => {
              const value = raw[columns[field]] ?? raw[field];
              return epoch.generations[field] === generations[field] && accepted.fieldOrigins?.[field]
                && value === payload[field] && state[field] === payload[field];
            }));
            return {
              ...state,
              routingCode: acknowledged.has("routingCode") ? null : state.routingCode,
              phaseCode: acknowledged.has("phaseCode") ? null : state.phaseCode,
              glAccount: acknowledged.has("glAccount") ? null : state.glAccount,
              costType: acknowledged.has("costType") ? null : state.costType,
              derivedGlAccount: acknowledged.has("glAccount") ? null : state.derivedGlAccount,
            };
          });
      }).catch(() => {
        // The mutation hook reports the error. Keep the unsaved override.
      });
    }
  }

  function setRoutingCode(value: string) {
    updateOverrideState((state) => ({ ...state, routingCode: value }));
  }

  function setRoutingSelection(value: string) {
    setRoutingCode(value);
    persistSelection({ routingCode: value });
  }

  function setPhaseCode(value: string) {
    updateOverrideState((state) => ({ ...state, phaseCode: value }));
    persistSelection({ phaseCode: value });
  }

  function setGlAccount(value: string) {
    updateOverrideState((state) => ({
      ...state,
      glAccount: value,
      derivedGlAccount: null,
    }));
    persistSelection({ glAccount: value });
  }

  // Changing the cost type re-derives the GL from the Spectrum master in the
  // SAME state update, so the pair the user sees is the pair Spectrum accepts
  // (the backend blocks a mismatch at approve with COST_TYPE_GL_MISMATCH).
  // A hand-edit of the GL afterwards calls setGlAccount and pins it — only the
  // next cost-type change re-derives again. Unmapped cost types leave GL alone.
  function setCostType(value: string) {
    if (value && !costTypeGlMapReady) return;

    const mappedGl = value ? glAccountForCostType(value) : null;
    updateOverrideState((state) => {
      if (!value) {
        const clearDerivedGl =
          state.derivedGlAccount !== null && state.glAccount === state.derivedGlAccount;
        return {
          ...state,
          costType: "",
          glAccount: clearDerivedGl ? "" : state.glAccount,
          derivedGlAccount: null,
        };
      }

      return {
        ...state,
        costType: value,
        ...(mappedGl ? { glAccount: mappedGl } : {}),
        derivedGlAccount: mappedGl,
      };
    });
    persistSelection({
      costType: value,
      ...(mappedGl ? { glAccount: mappedGl } : {}),
    });
  }

  function setSubmitState(value: SubmitFeedbackState) {
    updateOverrideState((state) => ({ ...state, submitState: value }));
  }

  function setLastSubmitRejection(value: string | null, preflightErrors: string[] = []) {
    updateOverrideState((state) => ({
      ...state,
      lastSubmitError: value,
      lastSubmitPreflightErrors: preflightErrors,
    }));
  }

  useEffect(() => {
    onOverrideChange?.({
      routingCode,
      phaseCode,
      glAccount,
      costType,
    });
  }, [routingCode, phaseCode, glAccount, costType, onOverrideChange]);

  // Mirrors the backend submit gate (`submitWorkflow`: "only invoices and
  // pay-applications can be submitted to Spectrum"). Pay-applications are
  // invoice-workflow everywhere else too (waiver requirement, cost-type
  // trigger, bulk submit), so the section renders for both.
  const isEligible = invoice.classification === "invoice" || invoice.classification === "pay-application";
  const canSubmitByStatus = invoice.status === "approved";

  const routingChanged = routingCode !== defaultRoutingCodeFinal;
  const phaseChanged = phaseCode !== defaultPhaseCode;
  const glChanged = glAccount !== defaultGlAccount;
  const costChanged = costType !== defaultCostType;

  const multiPhaseAllocated = invoice.multiPhaseCandidate === true
    && Array.isArray(invoice.phaseAllocations)
    && invoice.phaseAllocations.length > 0;
  const routingFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.routingCode?.origin === "manual",
    value: routingCode,
    baseline: defaultRoutingCodeFinal,
    required: requires("routing_code"),
  });
  const phaseFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.phaseCode?.origin === "manual",
    value: phaseCode,
    baseline: defaultPhaseCode,
    ownedElsewhere: multiPhaseAllocated,
    required: requires("phase_code"),
  });
  const glFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.glAccount?.origin === "manual",
    value: glAccount,
    baseline: defaultGlAccount,
    required: requires("gl_account"),
  });
  const costFieldState = getInvoiceFieldState({
    manuallyEdited: invoice.fieldOrigins?.costType?.origin === "manual",
    value: costType,
    baseline: defaultCostType,
    required: requires("cost_type"),
  });
  const otherParametersComplete = requiredFields.length > 0 && requiredFields.every((field) => {
    if (field === "routing_code") return Boolean(routingCode);
    if (field === "phase_code") return Boolean(phaseCode);
    if (field === "gl_account") return Boolean(glAccount);
    if (field === "cost_type") return Boolean(costType);
    return true;
  });

  const hasAnyOverride = routingChanged || phaseChanged || glChanged || costChanged;

  const effectiveRoutingOptions = useMemo<Array<RoutingCodeOption & { inactive?: boolean }>>(() => {
    const options = routingCodes.some((r: RoutingCodeOption) => r.code === "D")
      ? routingCodes
      : [...routingCodes, { code: "D", description: "AP Default Routing" }];
    if (!routingCode || options.some((option) => option.code === routingCode)) return options;
    // Preserve a saved, now-retired code visibly without making it selectable.
    return [{ code: routingCode, description: "inactive", inactive: true }, ...options];
  }, [routingCode, routingCodes]);
  const routingDisplayLabel = effectiveRoutingOptions.some((option) => option.code === routingCode && option.inactive)
    ? `${routingCode} (inactive)`
    : routingCode;

  const selectedPhase = phaseCodes.find((phase: PhaseCodeOption) => phase.phase_code === phaseCode);
  const selectedPhaseLabel = selectedPhase
    ? `${selectedPhase.phase_code} - ${selectedPhase.description}`
    : phaseCode;

  // ── Search state for combobox filtering ──
  const [routingSearch, setRoutingSearch] = useState("");
  const [phaseSearch, setPhaseSearch] = useState("");
  const [costSearch, setCostSearch] = useState("");

  const [routingOpen, setRoutingOpen] = useState(false);
  const [phaseOpen, setPhaseOpen] = useState(false);
  const [glOpen, setGlOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);

  const filteredRoutingOptions = useMemo(() => {
    if (!routingSearch) return effectiveRoutingOptions;
    const term = routingSearch.toLowerCase();
    return effectiveRoutingOptions.filter((opt: RoutingCodeOption) =>
      opt.code.toLowerCase().includes(term) || (opt.description ?? "").toLowerCase().includes(term)
    );
  }, [effectiveRoutingOptions, routingSearch]);

  const filteredPhaseCodes = useMemo(() => {
    if (!phaseSearch) return phaseCodes;
    const term = phaseSearch.toLowerCase();
    return phaseCodes.filter((p: PhaseCodeOption) =>
      p.phase_code.toLowerCase().includes(term) || (p.description ?? "").toLowerCase().includes(term)
    );
  }, [phaseCodes, phaseSearch]);

  const filteredCostOptions = useMemo(() => {
    if (!costSearch) return costTypeOptions;
    const term = costSearch.toLowerCase();
    return costTypeOptions.filter((opt) =>
      opt.value.toLowerCase().includes(term) || opt.label.toLowerCase().includes(term)
    );
  }, [costTypeOptions, costSearch]);

  function handlePhaseChange(value: string) {
    const selected = phaseCodes.find((phase: PhaseCodeOption) => phase.phase_code === value);
    // A phase carrying a default cost type is the OTHER route that changes the
    // cost type, so it re-derives the GL on the same terms as setCostType —
    // otherwise picking a phase could leave a pair Spectrum rejects.
    const nextCostType = selected?.default_cost_type;
    if (nextCostType && !costTypeGlMapReady) return;

    const mappedGl = nextCostType ? glAccountForCostType(nextCostType) : null;
    updateOverrideState((state) => ({
      ...state,
      phaseCode: value,
      costType: nextCostType ?? state.costType,
      ...(mappedGl ? { glAccount: mappedGl } : {}),
      ...(nextCostType ? { derivedGlAccount: mappedGl } : {}),
    }));
    persistSelection({
      phaseCode: value,
      ...(nextCostType ? { costType: nextCostType } : {}),
      ...(mappedGl ? { glAccount: mappedGl } : {}),
    });
  }

  function getWorkflowReturnHref(): string | null {
    if (!isSpectrumSubmitReturnVisit(searchParams)) return null;
    return searchParams.get("from") || "/accounting/invoices";
  }

  function updateWorkflowSnapshotSubmitted() {
    const snapshot = readSpectrumSubmitFailureWorkflowSnapshot();
    if (!snapshot) return;
    writeSpectrumSubmitFailureWorkflowSnapshot(
      markSpectrumSubmitFailureWorkflowInvoiceSubmitted(snapshot, invoice.id),
    );
  }

  function updateWorkflowSnapshotFailed(issue: string) {
    const snapshot = readSpectrumSubmitFailureWorkflowSnapshot();
    if (!snapshot) return;
    writeSpectrumSubmitFailureWorkflowSnapshot(
      markSpectrumSubmitFailureWorkflowInvoiceFailed(snapshot, invoice.id, issue),
    );
  }

  function scheduleWorkflowReturn(href: string) {
    if (returnTimerRef.current) {
      clearTimeout(returnTimerRef.current);
    }
    returnTimerRef.current = setTimeout(() => {
      router.push(href);
    }, 1_200);
  }

  useEffect(() => () => {
    if (returnTimerRef.current) {
      clearTimeout(returnTimerRef.current);
    }
  }, []);

  function saveRoutingOnBlur() {
    if (invoice.status === "approved" || !routingChanged) return;
    updateInvoice.mutate({ id: invoice.id, payload: { routingCode } });
  }

  const parameterAutosavePayload = useMemo<InvoiceUpdatePayload>(() => {
    const payload: InvoiceUpdatePayload = {};
    if (routingChanged) payload.routingCode = routingCode;
    if (phaseChanged) payload.phaseCode = phaseCode;
    if (glChanged) payload.glAccount = glAccount;
    if (costChanged) payload.costType = costType;
    return payload;
  }, [costChanged, costType, glAccount, glChanged, phaseChanged, phaseCode, routingChanged, routingCode]);

  function doSubmit() {
    if (submittingRef.current) return;
    submittingRef.current = true;

    function toPlainEnglish(raw?: string | null): string {
      const text = (raw ?? "").trim();
      if (!text) return "Unknown error.";

      const lower = text.toLowerCase();
      if (lower.includes("duplicate invoice")) {
        return "This invoice number already exists in Spectrum.";
      }
      if (lower.includes("routing") && lower.includes("required")) {
        return "Routing code is required for this invoice path.";
      }
      if (lower.includes("phase") && lower.includes("required")) {
        return "Phase code is missing. Select a valid phase before submitting.";
      }
      if (lower.includes("cost type") && lower.includes("required")) {
        return "Cost type is missing. Select a valid cost type before submitting.";
      }
      if (lower.includes("gl") && lower.includes("required")) {
        return "GL account is missing. Select a valid GL account before submitting.";
      }
      if (lower.includes("not found") && lower.includes("subcontract")) {
        return "The selected subcontract was not found for this vendor and job.";
      }

      return text;
    }

    function normalizeMessage(raw?: string | null): string {
      const trimmed = (raw ?? "").trim();
      return trimmed;
    }

    function deriveSubmitFeedback(data: SubmitResponse): { message: string; details: string[] } {
      const direct = normalizeMessage(data.message);
      const failures = (data.results ?? []).filter((r) => !r.success);

      if (failures.length > 0) {
        const details = failures.map((failure) => {
          const ref = failure.invoiceNumber?.trim() || failure.id;
          const reason = toPlainEnglish(failure.error);
          return `${ref}: ${reason}`;
        });
        return {
          message: direct || "Spectrum rejected this submission.",
          details,
        };
      }

      if (direct) {
        return { message: direct, details: [] };
      }

      return {
        message: data.success
          ? "Invoice submitted to Spectrum."
          : "Spectrum submission failed.",
        details: data.success
          ? []
          : ["No detailed error was returned by the backend for this request."],
      };
    }

    const overrides: SubmitOverrides = {};
    if (routingCode) {
      overrides.routing_code = routingCode;
    }
    if (phaseCode) {
      overrides.phase_code = phaseCode;
    }
    if (glAccount) {
      overrides.gl_account = glAccount;
    }
    if (costType) {
      overrides.cost_type = costType;
    }
    if (submitGlDate) {
      overrides.gl_date = submitGlDate;
    }

    const payload: {
      ids: string[];
      overrides?: Record<string, SubmitOverrides>;
    } = {
      ids: [invoice.id],
    };

    if (Object.keys(overrides).length > 0) {
      payload.overrides = {
        [invoice.id]: overrides,
      };
    }

    submit.mutate(payload, {
      onSuccess: (data: SubmitResponse) => {
        const feedback = deriveSubmitFeedback(data);
        setSubmitState({ ok: !!data.success, message: feedback.message, details: feedback.details });
        const workflowReturnHref = getWorkflowReturnHref();

        const firstFailure = (data.results ?? []).find((result) => !result.success);
        if (firstFailure?.error?.trim()) {
          const issue = firstFailure.error.trim();
          setLastSubmitRejection(issue);
          updateWorkflowSnapshotFailed(issue);
        } else if (data.success) {
          setLastSubmitRejection(null);
          if (workflowReturnHref) {
            updateWorkflowSnapshotSubmitted();
            scheduleWorkflowReturn(workflowReturnHref);
          }
        }
      },
      onError: (err: unknown) => {
        const details: string[] = [];
        const preflightErrors = getSpectrumSubmitPreflightErrors(err);
        if (isApiError(err)) {
          if (typeof err.path === "string" && err.path.trim()) {
            details.push(`Validation path: ${err.path}`);
          }
          if (Array.isArray(err.missing) && err.missing.length > 0) {
            details.push(`Missing fields: ${err.missing.join(", ")}`);
          }
          details.push(`HTTP ${err.status}`);
        }
        const errorMessage = isApiError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : "";
        const msg = toPlainEnglish(normalizeMessage(errorMessage) || "Failed to submit invoice.");
        const issue = normalizeMessage(errorMessage) || "Failed to submit invoice.";
        setLastSubmitRejection(issue, preflightErrors);
        updateWorkflowSnapshotFailed(issue);
        setSubmitState({
          ok: false,
          message: msg,
          details: preflightErrors.length > 0
            ? preflightErrors
            : details.length > 0
              ? details
              : ["No extra error detail was returned. Check backend logs for this invoice."],
          ...(preflightErrors.length > 0 ? { preflightErrors } : {}),
        });
      },
      onSettled: () => {
        submittingRef.current = false;
        onSubmitSettled?.();
      },
    });
  }

  useLayoutEffect(() => {
    if (activeInvoiceIdRef.current !== invoice.id) {
      activeInvoiceIdRef.current = invoice.id;
      submitGenerationRef.current += 1;
    }
    latestSubmitRef.current = doSubmit;
  });

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submitGenerationRef.current += 1;
    };
  }, []);

  const [saveBeforeSubmitPending, setSaveBeforeSubmitPending] = useState(false);

  function runAfterBeforeSubmit() {
    if (saveBeforeSubmitPending) return;
    if (!onBeforeSubmit) {
      latestSubmitRef.current();
      return;
    }

    const continuation = {
      invoiceId: invoice.id,
      generation: submitGenerationRef.current,
    };
    const isCurrentContinuation = () => (
      mountedRef.current
      && activeInvoiceIdRef.current === continuation.invoiceId
      && submitGenerationRef.current === continuation.generation
    );

    setSaveBeforeSubmitPending(true);
    void onBeforeSubmit(parameterAutosavePayload)
      .then(() => {
        if (isCurrentContinuation()) latestSubmitRef.current();
      })
      .catch((err: unknown) => {
        if (!isCurrentContinuation()) return;
        const message = err instanceof Error && err.message
          ? err.message
          : "Could not save invoice changes before submitting.";
        setSubmitState({
          ok: false,
          message: "Could not save invoice changes before submitting.",
          details: [message],
        });
      })
      .finally(() => {
        if (mountedRef.current) setSaveBeforeSubmitPending(false);
      });
  }

  function handleSubmit() {
    if (!isEligible) return;

    if (waiverGateBlocked) {
      setSubmitState({
        ok: false,
        message: "A lien waiver is required before this invoice can be submitted.",
      });
      return;
    }

    if (!canSubmitByStatus) {
      setSubmitState({
        ok: false,
        message: "This invoice cannot be submitted yet.",
        details: [
          `Current status: ${invoice.status}.`,
          "Approve this invoice first, then submit to Spectrum.",
        ],
      });
      return;
    }

    runAfterBeforeSubmit();
  }

  useEffect(() => {
    submitHandlerRef.current = handleSubmit;
  });

  useEffect(() => {
    if (!onSubmitControlChange) return undefined;
    if (!isEligible || !canSubmitByStatus) {
      onSubmitControlChange(null);
      return undefined;
    }

    onSubmitControlChange({
      label: "Submit to Spectrum",
      pending: submit.isPending || saveBeforeSubmitPending,
      disabled: submit.isPending || saveBeforeSubmitPending || waiverGateBlocked,
      onSubmit: () => submitHandlerRef.current(),
    });

    return () => onSubmitControlChange(null);
  }, [canSubmitByStatus, isEligible, onSubmitControlChange, saveBeforeSubmitPending, submit.isPending, waiverGateBlocked]);

  if (!isEligible) return null;

  return (
    <div className="px-4 py-4 border-b rounded-b-lg flex-shrink-0">
      <div className="mb-3 flex items-center gap-2">
        <p className="flex items-center gap-1 text-2xs font-semibold text-muted-foreground uppercase tracking-widest">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Other Parameters
        </p>
        {otherParametersComplete && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-tone-emerald" data-testid="other-parameters-complete">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Complete
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Routing Code" htmlFor="spectrum-routing-code" required={requires("routing_code")} invoiceState={routingFieldState}>
          {routingError ? (
            <div className="relative">
              <Input
                id="spectrum-routing-code"
                aria-invalid={routingFieldState.ariaInvalid}
                value={routingCode}
                onChange={(e) => setRoutingCode(e.target.value)}
                onBlur={saveRoutingOnBlur}
                placeholder="Routing code"
                className="pr-9"
              />
              <InlineClearButton
                onClear={() => setRoutingCode("")}
                disabled={!routingCode}
                ariaLabel="Clear routing code"
                className="right-2"
              />
            </div>
          ) : (
            <ComboboxShell
              id="spectrum-routing-code"
              aria-invalid={routingFieldState.ariaInvalid}
              value={routingCode || null}
              displayLabel={routingDisplayLabel || null}
              onSelect={(value: string) => { setRoutingSelection(value); setRoutingOpen(false); }}
              onClear={() => { setRoutingSelection(""); setRoutingOpen(false); }}
              placeholder="Select routing code..."
              searchPlaceholder="Search routing codes..."
              onSearchChange={setRoutingSearch}
              hideSearch={effectiveRoutingOptions.length <= 6}
              open={routingOpen}
              onOpenChange={setRoutingOpen}
            >
              {filteredRoutingOptions.map((opt) => (
                <CommandItem
                  key={opt.code}
                  value={`${opt.code} ${opt.description ?? ""}`}
                  onSelect={() => { setRoutingSelection(opt.code); setRoutingOpen(false); }}
                  disabled={opt.inactive}
                >
                  <Check className={cn("mr-2 h-4 w-4", routingCode === opt.code ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{opt.code}{opt.inactive ? " (inactive)" : ""}</span>
                </CommandItem>
              ))}
            </ComboboxShell>
          )}
        </Field>

        {hasJob && <Field
          label="Phase Code"
          htmlFor="spectrum-phase-code"
          required={requires("phase_code")}
          invoiceState={phaseFieldState}
          hint={multiPhaseAllocated ? "Allocation sets the phase per line." : undefined}
        >
          <ComboboxShell
            id="spectrum-phase-code"
            aria-invalid={phaseFieldState.ariaInvalid}
            value={phaseCode || null}
            displayLabel={phaseCode ? selectedPhaseLabel : null}
            onSelect={(value: string) => { handlePhaseChange(value); setPhaseOpen(false); }}
            onClear={() => { setPhaseCode(""); setPhaseOpen(false); }}
            disabled={multiPhaseAllocated || !costTypeGlMapReady}
            placeholder="Select phase code..."
            searchPlaceholder="Search phase codes..."
            onSearchChange={setPhaseSearch}
            open={phaseOpen}
            onOpenChange={setPhaseOpen}
          >
            {filteredPhaseCodes.map((phase: PhaseCodeOption) => (
              <CommandItem
                key={phase.phase_code}
                value={`${phase.phase_code} ${phase.description ?? ""}`}
                onSelect={() => { handlePhaseChange(phase.phase_code); setPhaseOpen(false); }}
              >
                <Check className={cn("mr-2 h-4 w-4", phaseCode === phase.phase_code ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{phase.phase_code} - {phase.description}</span>
              </CommandItem>
            ))}
          </ComboboxShell>
        </Field>}

        <Field label="GL Account" htmlFor="spectrum-gl-account" required={requires("gl_account")} invoiceState={glFieldState}>
          <GlAccountDropdown
            id="spectrum-gl-account"
            aria-invalid={glFieldState.ariaInvalid}
            value={glAccount || null}
            onChange={(code) => { setGlAccount(code); setGlOpen(false); }}
            onClear={() => { setGlAccount(""); setGlOpen(false); }}
            placeholder="Select GL account..."
            open={glOpen}
            onOpenChange={setGlOpen}
          />
        </Field>

        {hasJob && <div>
          <Field label="Cost Type" htmlFor="spectrum-cost-type" required={requires("cost_type")} invoiceState={costFieldState}>
            <ComboboxShell
              id="spectrum-cost-type"
              aria-invalid={costFieldState.ariaInvalid}
              value={costType || null}
              displayLabel={costType ? (costTypeLabels[costType] ?? costType) : null}
              onSelect={(value: string) => { setCostType(value); setCostOpen(false); }}
              onClear={() => { setCostType(""); setCostOpen(false); }}
              disabled={!costTypeGlMapReady}
              placeholder="Select cost type..."
              searchPlaceholder="Search cost types..."
              onSearchChange={setCostSearch}
              hideSearch={costTypeOptions.length <= 6}
              open={costOpen}
              onOpenChange={setCostOpen}
            >
              {filteredCostOptions.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={`${opt.value} ${opt.label}`}
                  onSelect={() => { setCostType(opt.value); setCostOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", costType === opt.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{opt.label}</span>
                </CommandItem>
              ))}
            </ComboboxShell>
          </Field>
          {costTypesUnavailable && (
            <PanelNotice id="spectrum-cost-types-unavailable" label="Cost types unavailable">
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Cost types unavailable — reference data could not be loaded.
            </p>
            </PanelNotice>
          )}
          {!costTypeGlMapReady && (
            <PanelNotice id="spectrum-cost-type-gl-rules-unavailable" label="Cost type to GL rules unavailable">
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Cost type to GL rules unavailable — selections are disabled until reference data
              loads.
            </p>
            </PanelNotice>
          )}
        </div>}
      </div>
      {subcontractMissingFromBackend && (
        <PanelNotice id="spectrum-subcontract-missing" label="Selected subcontract not found">
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          Selected subcontract {subcontractNumber} was not found in backend subcontracts data for this vendor/job.
        </p>
        </PanelNotice>
      )}

      {lastSubmitError && (
        <PanelNotice id="spectrum-previous-rejection" label="Previously rejected by Spectrum">
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Previously rejected: {lastSubmitError}</p>
          <SpectrumSubmitPreflightErrors errors={lastSubmitPreflightErrors} />
        </div>
        </PanelNotice>
      )}

      {submitState && (
        <PanelNotice id="spectrum-submit-result" label="Spectrum submission result" resolved={submitState.ok}>
        <div
          className={cn(
            "mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
            submitState.ok
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          )}
        >
          {submitState.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p>{submitState.message}</p>
            {submitState.preflightErrors ? (
              <SpectrumSubmitPreflightErrors errors={submitState.preflightErrors} />
            ) : submitState.details && submitState.details.length > 0 && (
              <div className="mt-1.5 space-y-1 text-xs">
                {submitState.details.map((detail: string, idx: number) => (
                  <p key={`${idx}-${detail}`}>- {detail}</p>
                ))}
              </div>
            )}
          </div>
        </div>
        </PanelNotice>
      )}

      {hasAnyOverride && (
        <p className="mt-2 text-xs text-muted-foreground">
          Manual overrides will be sent for this invoice.
        </p>
      )}
    </div>
  );
}
