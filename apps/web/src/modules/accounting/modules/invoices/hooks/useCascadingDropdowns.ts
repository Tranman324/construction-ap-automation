import { useMemo, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InitialValues {
  initialVendorCode: string | null;
  initialJobNumber: string | null;
}

export interface CascadingDropdownsState {
  vendorCode: string | null;
  jobNumber: string | null;
  isManualVendor: boolean;
  isManualJob: boolean;
  dirtyFields: Set<string>;
  hasEdits: boolean;
  changedFields: Partial<{
    vendorCode: string;
    jobNumber: string;
  }>;
  setVendor: (code: string | null) => void;
  setJob: (number: string | null) => void;
  acknowledgeSaved: (field: "vendorCode" | "jobNumber", value: string | null) => void;
  reset: () => void;
}

interface DropdownState {
  key: string;
  vendorCode: string | null;
  jobNumber: string | null;
  baselineVendorCode: string | null;
  baselineJobNumber: string | null;
  isManualVendor: boolean;
  isManualJob: boolean;
  dirtyFields: Set<string>;
}

function buildDropdownState(
  key: string,
  initialVendorCode: string | null,
  initialJobNumber: string | null,
): DropdownState {
  return {
    key,
    vendorCode: initialVendorCode,
    jobNumber: initialJobNumber,
    baselineVendorCode: initialVendorCode,
    baselineJobNumber: initialJobNumber,
    isManualVendor: false,
    isManualJob: false,
    dirtyFields: new Set<string>(),
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCascadingDropdowns({
  initialVendorCode,
  initialJobNumber,
}: InitialValues): CascadingDropdownsState {
  const initialKey = `${initialVendorCode ?? ""}|${initialJobNumber ?? ""}`;
  const [state, setState] = useState<DropdownState>(() =>
    buildDropdownState(
      initialKey,
      initialVendorCode,
      initialJobNumber,
    ),
  );

  const currentState = state.key === initialKey ? state : {
    ...state,
    key: initialKey,
    vendorCode: state.dirtyFields.has("vendor") ? state.vendorCode : initialVendorCode,
    jobNumber: state.dirtyFields.has("job") ? state.jobNumber : initialJobNumber,
    baselineVendorCode: initialVendorCode,
    baselineJobNumber: initialJobNumber,
  };

  // ── Setters ────────────────────────────────────────────────────────────────

  const setVendor = (code: string | null) => {
    setState((prev) => {
      const base = prev.key === initialKey ? prev : currentState;
      const dirtyFields = new Set(base.dirtyFields);

      if (code !== base.baselineVendorCode) {
        dirtyFields.add("vendor");
      } else {
        dirtyFields.delete("vendor");
      }

      return {
        ...base,
        vendorCode: code,
        isManualVendor: code !== null,
        dirtyFields,
      };
    });
  };

  const setJob = (number: string | null) => {
    setState((prev) => {
      const base = prev.key === initialKey ? prev : currentState;
      const dirtyFields = new Set(base.dirtyFields);

      if (number !== base.baselineJobNumber) {
        dirtyFields.add("job");
      } else {
        dirtyFields.delete("job");
      }

      return {
        ...base,
        jobNumber: number,
        isManualJob: number !== null,
        dirtyFields,
      };
    });
  };

  const acknowledgeSaved = (field: "vendorCode" | "jobNumber", value: string | null) => {
    setState((prev) => {
      const base = prev.key === initialKey ? prev : currentState;
      const dirtyFields = new Set(base.dirtyFields);

      if (field === "vendorCode") {
        if (base.vendorCode !== value) return base;
        dirtyFields.delete("vendor");
        return { ...base, baselineVendorCode: value, dirtyFields };
      }

      if (base.jobNumber !== value) return base;
      dirtyFields.delete("job");
      return { ...base, baselineJobNumber: value, dirtyFields };
    });
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const hasEdits = currentState.dirtyFields.size > 0;

  const changedFields = useMemo(() => {
    const changed: Partial<{
      vendorCode: string;
      jobNumber: string;
    }> = {};
    if (currentState.vendorCode !== currentState.baselineVendorCode) {
      changed.vendorCode = currentState.vendorCode ?? "";
    }
    if (currentState.jobNumber !== currentState.baselineJobNumber) {
      changed.jobNumber = currentState.jobNumber ?? "";
    }
    return changed;
  }, [
    currentState.vendorCode,
    currentState.jobNumber,
    currentState.baselineVendorCode,
    currentState.baselineJobNumber,
  ]);

  // ── Reset ──────────────────────────────────────────────────────────────────

  const reset = () => {
    setState(
      buildDropdownState(
        initialKey,
        initialVendorCode,
        initialJobNumber,
      ),
    );
  };

  return {
    vendorCode: currentState.vendorCode,
    jobNumber: currentState.jobNumber,
    isManualVendor: currentState.isManualVendor,
    isManualJob: currentState.isManualJob,
    dirtyFields: currentState.dirtyFields,
    hasEdits,
    changedFields,
    setVendor,
    setJob,
    acknowledgeSaved,
    reset,
  };
}
