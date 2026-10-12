"use client";
import { PanelNotice } from "../documents/PanelNotice";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, Check, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/modules/shared/lib/utils";
import { Button } from "@/modules/shared/components/ui/button";
import { Badge } from "@/modules/shared/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { PhaseOption, PhaseRow } from "@/modules/accounting/modules/invoices/types/api";
import { usePhaseOptions } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useSetPhaseAllocations } from "@/modules/accounting/modules/invoices/hooks/mutations";
import {
  ALLOCATION_CENT_TOLERANCE,
  computePhaseAllocationModel,
  fillFromRemaining,
  type PhaseComputation,
} from "@/modules/accounting/modules/invoices/components/invoices/multiPhaseAllocationModel";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

interface Props {
  invoice: Invoice;
  onPendingSaveChange?: (handler: (() => Promise<void>) | null) => void;
}

interface AllocationState {
  key: string;
  values: Record<string, string>;
  touched: boolean;
}

function buildAllocationInputs(
  currentAllocations: Array<{ phase_code: string; amount: number }> | null | undefined,
  invoiceAllocations: Invoice["phaseAllocations"],
) {
  const current = currentAllocations ?? invoiceAllocations;
  const initial: Record<string, string> = {};

  for (const alloc of current ?? []) {
    initial[alloc.phase_code] = alloc.amount.toFixed(2);
  }

  return initial;
}

/** Group phaseRows by phase_code, preserving insertion order of first occurrence. */
function groupByPhaseCode(rows: PhaseRow[]): Map<string, PhaseRow[]> {
  const groups = new Map<string, PhaseRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.phase_code);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(row.phase_code, [row]);
    }
  }
  return groups;
}

export function MultiPhaseAllocationPanel({ invoice, onPendingSaveChange }: Props) {
  const invoiceTotal = invoice.extracted?.amount ?? 0;

  const { data: phaseOpts, isLoading, isError, refetch } = usePhaseOptions(
    invoice.id,
    // Enable on subcontract presence (NOT the stale-after-edit multiPhaseCandidate
    // flag) so SINGLE→MULTI fetches; matches the page-level enable exactly so the
    // two callers share one deduped request. The live `phaseOpts.isMultiPhase`
    // guard below is the authoritative visibility gate.
    !!invoice.matching?.subcontract?.subcontractNumber,
    // Rekey on the invoice's current matched subcontract + job so correcting them
    // refetches the new subcontract's phases instead of showing the stale cache.
    invoice.matching?.subcontract?.subcontractNumber ?? null,
    invoice.matching?.job?.jobNumber ?? null,
  );
  const saveMutation = useSetPhaseAllocations();

  const seedInputs = useMemo(
    () => buildAllocationInputs(phaseOpts?.currentAllocations, invoice.phaseAllocations),
    [phaseOpts?.currentAllocations, invoice.phaseAllocations],
  );
  const allocationKey = useMemo(
    () => Object.entries(seedInputs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([phaseCode, value]) => `${phaseCode}:${value}`)
      .join("|"),
    [seedInputs],
  );
  const [allocationState, setAllocationState] = useState<AllocationState>(() => ({
    key: allocationKey,
    values: seedInputs,
    touched: false,
  }));
  const currentAllocationState = allocationState.key === allocationKey
    ? allocationState
    : {
        key: allocationKey,
        values: seedInputs,
        touched: false,
      };

  const inputs = currentAllocationState.values;
  const touched = currentAllocationState.touched;
  const [showSaved, setShowSaved] = useState(false);
  const phases: PhaseOption[] = useMemo(() => phaseOpts?.phases ?? [], [phaseOpts?.phases]);
  const header = phaseOpts?.header;
  const exceedsUnbilled = phaseOpts?.exceedsUnbilled ?? false;

  // Build a lookup from phase_code → aggregate PhaseOption
  const phaseAggregateMap = useMemo(() => {
    const map = new Map<string, PhaseOption>();
    for (const p of phases) {
      map.set(p.phase_code, p);
    }
    return map;
  }, [phases]);

  // Group phaseRows by phase_code
  const phaseGroups = useMemo(
    () => groupByPhaseCode(phaseOpts?.phaseRows ?? []),
    [phaseOpts?.phaseRows],
  );

  // CO-corrected per-phase math (display only). Recovers change-order contract
  // value from the header and attributes it to the phase(s) that carry it, so
  // per-phase "Remaining" reconciles to the subcontract Unbilled instead of
  // understating it (or going negative) on CO-billed phases.
  const allocationModel = useMemo(
    () => (header ? computePhaseAllocationModel(phases, phaseOpts?.phaseRows ?? [], header) : null),
    [phases, phaseOpts?.phaseRows, header],
  );
  const phaseComputations = useMemo(() => {
    const map = new Map<string, PhaseComputation>();
    for (const p of allocationModel?.phases ?? []) map.set(p.phaseCode, p);
    return map;
  }, [allocationModel]);

  // Fully-billed phases render disabled-by-default; the user can opt in to
  // override (Spectrum accepts over-remaining). Tracks which phases are unlocked.
  const [overrides, setOverrides] = useState<Set<string>>(() => new Set());
  const toggleOverride = useCallback((phaseCode: string) => {
    setOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(phaseCode)) next.delete(phaseCode);
      else next.add(phaseCode);
      return next;
    });
  }, []);

  // ── Derived values ──────────────────────────────────────────────────────
  const allocatedTotal = useMemo(() => {
    return Object.values(inputs).reduce((sum, v) => {
      const n = parseFloat(v);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
  }, [inputs]);

  const remaining = invoiceTotal - allocatedTotal;
  const isBalanced = Math.abs(remaining) < 0.01 && allocatedTotal > 0;

  const hasInvalidInput = useMemo(() => {
    return Object.entries(inputs).some(([, v]) => {
      if (v === "" || v === undefined) return false;
      const n = parseFloat(v);
      return !Number.isFinite(n) || n < 0;
    });
  }, [inputs]);

  const canSave =
    isBalanced && !hasInvalidInput && !saveMutation.isPending;

  const hasExistingAllocation =
    (phaseOpts?.currentAllocations && phaseOpts.currentAllocations.length > 0) ||
    (invoice.phaseAllocations && invoice.phaseAllocations.length > 0);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleChange = useCallback((phaseCode: string, value: string) => {
    if (value !== "" && !/^\d*\.?\d{0,2}$/.test(value)) return;
    setAllocationState((prev) => {
      const base = prev.key === allocationKey
        ? prev
        : { key: allocationKey, values: seedInputs, touched: false };
      return {
        ...base,
        touched: true,
        values: { ...base.values, [phaseCode]: value },
      };
    });
  }, [allocationKey, seedInputs]);

  const handleAutoFill = useCallback(
    (phaseCode: string) => {
      const otherTotal = Object.entries(inputs).reduce((sum, [key, v]) => {
        if (key === phaseCode) return sum;
        const n = parseFloat(v);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0);
      const fill = Math.max(0, invoiceTotal - otherTotal);
      setAllocationState((prev) => {
        const base = prev.key === allocationKey
          ? prev
          : { key: allocationKey, values: seedInputs, touched: false };
        return {
          ...base,
          touched: true,
          values: { ...base.values, [phaseCode]: fill.toFixed(2) },
        };
      });
    },
    [allocationKey, inputs, invoiceTotal, seedInputs],
  );

  // One-click "Fill from remaining": distribute the invoice largest-remaining
  // first, capped per phase, residue to the last filled phase. Seeds the inputs
  // only — never auto-saves; the user can still edit before saving/approving.
  const canFillFromRemaining =
    !!allocationModel &&
    invoiceTotal > 0 &&
    invoiceTotal <= allocationModel.totalRemaining + ALLOCATION_CENT_TOLERANCE;
  const handleFillFromRemaining = useCallback(() => {
    if (!allocationModel) return;
    const filled = fillFromRemaining(allocationModel, invoiceTotal);
    if (!filled) return;
    setAllocationState((prev) => {
      const base = prev.key === allocationKey
        ? prev
        : { key: allocationKey, values: seedInputs, touched: false };
      return { ...base, touched: true, values: { ...filled } };
    });
  }, [allocationModel, invoiceTotal, allocationKey, seedInputs]);

  const buildAllocations = useCallback(() => {
    return phases
      .filter((p) => {
        const v = inputs[p.phase_code];
        const n = parseFloat(v);
        return Number.isFinite(n) && n > 0;
      })
      .map((p) => ({
        phase_code: p.phase_code,
        amount: parseFloat(parseFloat(inputs[p.phase_code]).toFixed(2)),
        description: p.description,
      }));
  }, [phases, inputs]);

  const saveAllocations = useCallback(async (options: { showSavedFeedback?: boolean } = {}) => {
    if (saveMutation.isPending) {
      throw new Error("Allocation save already in progress.");
    }
    if (hasInvalidInput) {
      throw new Error("Fix invalid allocation amounts before approving.");
    }
    if (allocatedTotal <= 0) {
      throw new Error("Enter at least one allocation amount before approving.");
    }
    if (!isBalanced) {
      throw new Error(`Balance phase allocations before approving. Remaining: ${formatCurrency(Math.abs(remaining))}.`);
    }

    const allocations = buildAllocations();

    await saveMutation.mutateAsync({ invoiceId: invoice.id, allocations });
    if (options.showSavedFeedback ?? true) {
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2500);
    }
    setAllocationState((prev) => {
      const base = prev.key === allocationKey
        ? prev
        : { key: allocationKey, values: seedInputs, touched: false };
      return { ...base, touched: false };
    });
  }, [
    allocatedTotal,
    allocationKey,
    buildAllocations,
    hasInvalidInput,
    invoice.id,
    isBalanced,
    remaining,
    saveMutation,
    seedInputs,
  ]);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    void saveAllocations({ showSavedFeedback: true });
  }, [canSave, saveAllocations]);

  useEffect(() => {
    if (!onPendingSaveChange) return undefined;
    if (!touched) {
      onPendingSaveChange(null);
      return undefined;
    }

    onPendingSaveChange(() => saveAllocations({ showSavedFeedback: false }));
    return () => onPendingSaveChange(null);
  }, [onPendingSaveChange, saveAllocations, touched]);

  const handleClear = useCallback(() => {
    saveMutation.mutate(
      { invoiceId: invoice.id, allocations: null },
      {
        onSuccess: () => {
          setAllocationState({
            key: allocationKey,
            values: {},
            touched: false,
          });
        },
      },
    );
  }, [allocationKey, invoice.id, saveMutation]);

  // Visibility is governed by the LIVE served verdict (`phaseOpts.isMultiPhase`)
  // below — NOT the persisted `multiPhaseCandidate` flag, which is stale-after-edit
  // in both directions. Removing the flag short-circuit lets a SINGLE→MULTI
  // correction render the panel once the refetched phase-options confirm.

  // ── Error state ────────────────────────────────────────────────────────
  if (isError) {
    return (
      <PanelNotice id="allocation-load-error" label="Could not load phase allocation data" tabId="allocation">
      <div className="px-3 py-3 border-b">
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200/70 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Couldn&apos;t load phase allocation data.</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => void refetch()}
          >
            Retry
          </Button>
        </div>
      </div>
      </PanelNotice>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="px-3 py-3 border-b">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading phase information…
        </div>
      </div>
    );
  }

  if (!phaseOpts || !phaseOpts.isMultiPhase || phases.length === 0) return null;

  return (
    <div className="mt-4 border-b" id="multi-phase-panel">
      {/* ── Subcontract Header ──────────────────────────────────────────── */}
      <div className="px-3 py-2.5 bg-amber-50/80 dark:bg-amber-950/20 border-b border-amber-200/60 dark:border-amber-800/40">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                Multi-phase subcontract
              </p>
              {hasExistingAllocation && (
                <Badge
                  variant="outline"
                  className="text-3xs px-1.5 py-0 h-4 border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                >
                  <Check className="h-2.5 w-2.5 mr-0.5" />
                  Allocated
                </Badge>
              )}
            </div>
            {header && (
              <p className="text-2xs text-amber-700 dark:text-amber-400/80 mt-0.5 leading-relaxed">
                <span className="font-mono font-medium">
                  {phaseOpts.subcontractNumber}
                </span>
                {" · "}
                <span>{header.vendorName}</span>
                {" · Rev: "}
                <span className="font-mono">{formatCurrency(header.revContract)}</span>
                {" · Billed: "}
                <span className="font-mono">{formatCurrency(header.totalBilled)}</span>
                {" · Unbilled: "}
                {exceedsUnbilled ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-mono text-red-600 dark:text-red-400 font-medium inline-flex items-center gap-0.5 cursor-default">
                        {formatCurrency(header.unbilled)}
                        <AlertCircle className="h-3 w-3 inline -mt-px" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p className="text-xs">
                        Invoice ({formatCurrency(invoiceTotal)}) exceeds unbilled
                        balance ({formatCurrency(header.unbilled)}) by{" "}
                        <span className="font-medium">
                          {formatCurrency(phaseOpts.overageAmount)}
                        </span>
                        . PM routing required.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="font-mono">{formatCurrency(header.unbilled)}</span>
                )}
              </p>
            )}
            <p className="text-2xs text-amber-700/80 dark:text-amber-400/60 mt-0.5">
              {phaseOpts.distinctPhaseCount} phases · Allocate{" "}
              <span className="font-mono font-medium">
                {formatCurrency(invoiceTotal)}
              </span>{" "}
              across the phases below.
            </p>
          </div>
        </div>
      </div>

      {/* ── Guidance line ───────────────────────────────────────────────── */}
      <div className="px-3 py-1.5 border-b border-border/50 bg-muted/10">
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xs text-muted-foreground min-w-0">
            Spectrum accepts one amount per phase. Use the detail rows to see which billing items have remaining balance.
          </p>
          {canFillFromRemaining && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 shrink-0 px-2 text-2xs"
              onClick={handleFillFromRemaining}
              data-testid="fill-from-remaining"
            >
              Fill from remaining
            </Button>
          )}
        </div>
        {allocationModel?.coUnattributable && (
          <PanelNotice id="allocation-contract-reconciliation" label="Phase contract totals do not reconcile" tabId="allocation">
          <p className="mt-1 text-3xs text-amber-700/90 dark:text-amber-400/80" data-testid="co-unattributable-note">
            Phase contract totals don&apos;t reconcile to the revised contract — rely on the subcontract Unbilled above.
          </p>
          </PanelNotice>
        )}
      </div>

      {/* ── Subcontract-level overage (RED tier) ─────────────────────────── */}
      {/* Mirrors the backend path-2 gate EXACTLY via the served `exceedsUnbilled`
          flag, so this warning and the routing gate can never disagree. */}
      {exceedsUnbilled && header && (
        <PanelNotice id="allocation-subcontract-overage" label="Subcontract unbilled balance exceeded" tabId="allocation">
        <div
          className="px-3 py-2 border-b border-red-200/70 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/20"
          data-testid="subcontract-overage-warning"
        >
          <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Exceeds subcontract unbilled ({formatCurrency(header.unbilled)}) — PM routing will be required.
            </span>
          </div>
        </div>
        </PanelNotice>
      )}

      {/* ── Grouped Phase Sections ─────────────────────────────────────── */}
      {Array.from(phaseGroups.entries()).map(([phaseCode, rows]) => {
        const aggregate = phaseAggregateMap.get(phaseCode);
        const comp = phaseComputations.get(phaseCode);
        const hasMultipleRows = rows.length > 1;
        const inputValue = inputs[phaseCode] ?? "";
        const numVal = parseFloat(inputValue);
        const isInvalid = inputValue !== "" && (!Number.isFinite(numVal) || numVal < 0);
        // CO-corrected phase figures (fall back to the raw aggregate only if the
        // model is unavailable — the panel never renders without a header).
        const phaseContract = comp?.phaseContract ?? aggregate?.original_amount ?? 0;
        const phaseBilled = comp?.phaseBilled ?? aggregate?.amount_billed ?? 0;
        const phaseRemaining = comp?.phaseRemaining ?? aggregate?.remaining_amount ?? 0;
        const isFullyBilled = comp?.isFullyBilled ?? phaseRemaining <= ALLOCATION_CENT_TOLERANCE;
        const isCoAffected = comp?.isCoAffected ?? false;
        const hasInputValue = inputValue !== "" && Number.isFinite(numVal) && numVal > 0;
        // Fully-billed phases lock their input until the user opts to override.
        const isLocked = isFullyBilled && !overrides.has(phaseCode) && !hasInputValue;
        // SOFT (yellow) note: this phase's allocation exceeds its CO-corrected
        // remaining, but the invoice total is still within the subcontract
        // unbilled (no backend routing gate). Equal-to-remaining shows nothing.
        const exceedsPhaseRemaining =
          hasInputValue && numVal > phaseRemaining + ALLOCATION_CENT_TOLERANCE && !exceedsUnbilled;

        return (
          <div
            key={phaseCode}
            className={cn("border-b border-border/50", isFullyBilled && "bg-muted/10")}
            data-testid={`phase-group-${phaseCode}`}
            data-fully-billed={isFullyBilled ? "true" : undefined}
          >
            {/* Phase header row */}
            <div className="px-3 py-2 bg-muted/30" data-testid={`phase-header-${phaseCode}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono font-semibold text-foreground">
                    {phaseCode}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {aggregate?.description ?? rows[0]?.description ?? ""}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-2xs shrink-0">
                  <span className="text-muted-foreground">
                    Contract{isCoAffected ? " (incl COs)" : ""}:{" "}
                    <span className="font-mono">
                      {formatCurrency(phaseContract)}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    Billed:{" "}
                    <span className="font-mono">
                      {formatCurrency(phaseBilled)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "font-semibold",
                      isFullyBilled ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                    )}
                    data-testid={`phase-remaining-${phaseCode}`}
                  >
                    Remaining:{" "}
                    <span className="font-mono text-sm">
                      {formatCurrency(phaseRemaining)}
                    </span>
                    {isFullyBilled && (
                      <Check className="inline h-3 w-3 ml-0.5 -mt-0.5" aria-label="fully billed" />
                    )}
                  </span>
                </div>
              </div>
              {isCoAffected && comp && (
                <p
                  className="mt-1 text-3xs text-amber-700/90 dark:text-amber-400/80"
                  data-testid={`co-footnote-${phaseCode}`}
                >
                  Includes {formatCurrency(comp.coAdjustment)} in change orders (Spectrum lists these at $0 contract on the phase).
                </p>
              )}
            </div>

            {/* Detail rows — only when phase has multiple rows */}
            {hasMultipleRows && (
              <div className="px-3" data-testid={`phase-details-${phaseCode}`}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-3xs text-muted-foreground uppercase tracking-wider">
                      <th className="text-left font-semibold py-1 pr-2 pl-4 w-[80px]">Bid Item</th>
                      <th className="text-left font-semibold py-1 pr-2">Description</th>
                      <th className="text-right font-semibold py-1 pr-2 w-[85px]">Original</th>
                      <th className="text-right font-semibold py-1 pr-2 w-[85px]">Billed</th>
                      <th className="text-right font-semibold py-1 pr-2 w-[85px]">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isCoRow =
                        row.original_amount === 0 && row.amount_billed > ALLOCATION_CENT_TOLERANCE;
                      // Fold CO lines into the group: never show their negative
                      // (0 − billed) remaining as an independent line.
                      const rowRemaining = isCoRow ? 0 : row.remaining_amount;
                      const rowDone = rowRemaining <= ALLOCATION_CENT_TOLERANCE;
                      return (
                        <tr
                          key={row.row_index}
                          className={cn(
                            "border-t border-border/20 transition-colors",
                            rowDone
                              ? "opacity-50 text-muted-foreground"
                              : "hover:bg-muted/20",
                          )}
                          data-testid={`detail-row-${row.row_index}`}
                          data-dimmed={rowDone ? "true" : undefined}
                          data-co-row={isCoRow ? "true" : undefined}
                        >
                          <td className="py-1 pr-2 pl-4 font-mono text-muted-foreground">
                            {row.bid_item ?? "—"}
                          </td>
                          <td className="py-1 pr-2 text-muted-foreground truncate max-w-[200px]">
                            {row.description}
                            {isCoRow && (
                              <span className="ml-1 text-4xs uppercase tracking-wide text-amber-700 dark:text-amber-400">
                                CO
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-2 text-right font-mono text-muted-foreground">
                            {formatCurrency(row.original_amount)}
                          </td>
                          <td className="py-1 pr-2 text-right font-mono text-muted-foreground">
                            {formatCurrency(row.amount_billed)}
                          </td>
                          <td className={cn(
                            "py-1 pr-2 text-right font-mono",
                            rowDone
                              ? "text-muted-foreground"
                              : "text-foreground font-medium",
                          )}>
                            {formatCurrency(rowRemaining)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Allocation input */}
            <div className="px-3 py-2 flex items-center justify-end gap-2" data-testid={`phase-input-${phaseCode}`}>
              <label className="text-xs text-muted-foreground whitespace-nowrap">
                Allocate to {phaseCode}
              </label>
              <div className="relative flex-1 max-w-[160px]">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                  $
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={inputValue}
                  onChange={(e) => handleChange(phaseCode, e.target.value)}
                  onDoubleClick={() => { if (!isLocked) handleAutoFill(phaseCode); }}
                  disabled={isLocked}
                  placeholder="0.00"
                  aria-label={`Allocate to ${phaseCode}`}
                  className={cn(
                    "w-full h-7 pl-5 pr-2 rounded-md border bg-background text-xs font-mono text-right",
                    "focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60",
                    "transition-colors",
                    isLocked && "opacity-50 cursor-not-allowed bg-muted/30",
                    isInvalid &&
                      "border-red-400 focus:ring-red-400/40 focus:border-red-400",
                  )}
                />
              </div>
              {isLocked ? (
                <button
                  type="button"
                  onClick={() => toggleOverride(phaseCode)}
                  className="text-3xs text-muted-foreground hover:text-foreground underline decoration-dotted whitespace-nowrap"
                  data-testid={`override-toggle-${phaseCode}`}
                >
                  Override
                </button>
              ) : (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => handleAutoFill(phaseCode)}
                        className="h-6 w-6 flex items-center justify-center rounded text-3xs font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        =
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p className="text-xs">Fill remaining balance</p>
                    </TooltipContent>
                  </Tooltip>
                  {isFullyBilled && overrides.has(phaseCode) && (
                    <button
                      type="button"
                      onClick={() => toggleOverride(phaseCode)}
                      className="text-3xs text-muted-foreground hover:text-foreground underline decoration-dotted whitespace-nowrap"
                      data-testid={`override-toggle-${phaseCode}`}
                    >
                      Lock
                    </button>
                  )}
                </>
              )}

              {/* SOFT per-phase note (never mentions routing) */}
              {exceedsPhaseRemaining && (
                <span
                  className="text-3xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded px-1.5 py-0.5 whitespace-nowrap"
                  data-testid={`overage-badge-${phaseCode}`}
                >
                  More than this phase&apos;s remaining {formatCurrency(phaseRemaining)} — double-check the split.
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* ── Totals ──────────────────────────────────────────────────────── */}
      <div className="px-3 py-2 bg-muted/20" data-testid="allocation-totals">
        <div className="flex justify-end text-xs">
          <div className="min-w-[220px] space-y-0.5">
            <div className="flex items-center justify-between gap-6">
              <span className="text-muted-foreground w-16">Allocated</span>
              <span className="font-mono font-medium text-foreground">
                {formatCurrency(allocatedTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="text-muted-foreground w-16">Invoice</span>
              <span className="font-mono text-muted-foreground">
                {formatCurrency(invoiceTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="text-muted-foreground w-16">Remaining</span>
              <span
                className={cn(
                  "font-mono font-medium",
                  isBalanced
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400",
                )}
              >
                {formatCurrency(Math.abs(remaining))}
                {remaining < -0.01 && " over"}
                {isBalanced && (
                  <Check className="inline h-3 w-3 ml-1 -mt-0.5" />
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-t border-border/50 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground hover:text-destructive"
          disabled={saveMutation.isPending || (!touched && !hasExistingAllocation)}
          onClick={handleClear}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Clear
        </Button>

        <div className="flex items-center gap-2">
          {showSaved && (
            <PanelNotice id="allocation-save-success" label="Allocation saved" resolved tabId="allocation">
            <span className="text-2xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 animate-in fade-in">
              <Check className="h-3 w-3" /> Saved
            </span>
            </PanelNotice>
          )}
          {saveMutation.isError && (
            <PanelNotice id="allocation-save-error" label="Allocation save failed" tabId="allocation">
            <span className="text-2xs text-destructive max-w-[200px] truncate">
              {saveMutation.error.message}
            </span>
            </PanelNotice>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!canSave}
                  onClick={handleSave}
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      Saving…
                    </>
                  ) : (
                    "Save Allocation"
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            {!canSave && touched && (
              <TooltipContent side="top">
                <p className="text-xs">
                  {hasInvalidInput
                    ? "Fix invalid amounts"
                    : allocatedTotal === 0
                      ? "Enter at least one amount"
                      : `Remaining: ${formatCurrency(Math.abs(remaining))} ${remaining > 0 ? "under" : "over"}`}
                </p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
