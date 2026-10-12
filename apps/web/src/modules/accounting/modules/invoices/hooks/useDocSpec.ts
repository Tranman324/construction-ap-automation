"use client";

import { useCallback, useMemo, useState, type SetStateAction } from "react";

import type {
  DocumentAction,
  DocumentFormState,
  DocumentSpecDefinition,
  DocumentSpecOutput,
} from "@/modules/accounting/modules/invoices/types/documentSpec";

export interface UseDocSpecOptions<TRecord, TFormState extends DocumentFormState> {
  spec: DocumentSpecDefinition<TRecord, TFormState>;
  record: TRecord;
  recordKey: string;
  /** Stable document identity, distinct from refresh/version signals in recordKey. */
  recordId?: string;
}

export interface UseDocSpecResult<TFormState extends DocumentFormState> {
  specId: string;
  form: TFormState;
  setForm: React.Dispatch<React.SetStateAction<TFormState>>;
  patchForm: (patch: Partial<TFormState>) => void;
  resetForm: () => void;
  flushPendingChanges: () => Promise<void>;
  output: DocumentSpecOutput;
  primaryAction?: DocumentAction;
  secondaryActions: DocumentAction[];
}

interface FormSnapshot<TFormState extends DocumentFormState> {
  specId: string;
  recordKey: string;
  recordId: string;
  form: TFormState;
  seedForm: TFormState;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(rightRecord, key) && valuesEqual(leftRecord[key], rightRecord[key]));
}

function mergeServerSeed<TFormState extends DocumentFormState>(
  current: TFormState,
  previousSeed: TFormState,
  nextSeed: TFormState,
): TFormState {
  const merged = { ...nextSeed } as TFormState;
  const mergedRecord = merged as Record<string, unknown>;
  for (const key of Object.keys(current)) {
    if (Object.hasOwn(previousSeed, key) && Object.hasOwn(nextSeed, key) && !valuesEqual(current[key], previousSeed[key])) {
      mergedRecord[key] = current[key];
    }
  }
  return merged;
}

function resolveFormUpdate<TFormState extends DocumentFormState>(
  update: SetStateAction<TFormState>,
  previous: TFormState,
): TFormState {
  return typeof update === "function" ? update(previous) : update;
}

export function useDocSpec<TRecord, TFormState extends DocumentFormState>({
  spec,
  record,
  recordKey,
  recordId,
}: UseDocSpecOptions<TRecord, TFormState>): UseDocSpecResult<TFormState> {
  const stableRecordId = recordId ?? recordKey;
  // recordKey is the explicit server-seed version signal. Auxiliary record
  // changes must not call initForm or erase same-document drafts.
  /* eslint-disable react-hooks/exhaustive-deps */
  const initialForm = useMemo(
    () => spec.initForm(record),
    [recordKey, spec, stableRecordId],
  );
  /* eslint-enable react-hooks/exhaustive-deps */
  const [snapshot, setSnapshot] = useState<FormSnapshot<TFormState>>(() => ({
    specId: spec.id,
    recordKey,
    recordId: stableRecordId,
    form: initialForm,
    seedForm: initialForm,
  }));
  const snapshotIsStale = snapshot.specId !== spec.id || snapshot.recordKey !== recordKey;
  const nextSeed = snapshotIsStale ? initialForm : snapshot.seedForm;
  const form = snapshotIsStale && snapshot.specId === spec.id && snapshot.recordId === stableRecordId
    ? mergeServerSeed(snapshot.form, snapshot.seedForm, nextSeed)
    : snapshotIsStale ? nextSeed : snapshot.form;

  const setForm = useCallback<React.Dispatch<SetStateAction<TFormState>>>((update) => {
    setSnapshot((current) => {
      const isCurrent =
        current.specId === spec.id &&
        current.recordKey === recordKey &&
        current.recordId === stableRecordId;
      const sameDocument = current.specId === spec.id && current.recordId === stableRecordId;
      const refreshedSeed = sameDocument && current.recordKey !== recordKey ? spec.initForm(record) : current.seedForm;
      const baseForm = isCurrent
        ? current.form
        : sameDocument
          ? mergeServerSeed(current.form, current.seedForm, refreshedSeed)
          : spec.initForm(record);
      return {
        specId: spec.id,
        recordKey,
        recordId: stableRecordId,
        form: resolveFormUpdate(update, baseForm),
        seedForm: sameDocument ? refreshedSeed : spec.initForm(record),
      };
    });
  }, [record, recordKey, spec, stableRecordId]);

  const patchForm = useCallback((patch: Partial<TFormState>) => {
    setSnapshot((current) => {
      const isCurrent =
        current.specId === spec.id &&
        current.recordKey === recordKey &&
        current.recordId === stableRecordId;
      const sameDocument = current.specId === spec.id && current.recordId === stableRecordId;
      const refreshedSeed = sameDocument && current.recordKey !== recordKey ? spec.initForm(record) : current.seedForm;
      const baseForm = isCurrent
        ? current.form
        : sameDocument
          ? mergeServerSeed(current.form, current.seedForm, refreshedSeed)
          : spec.initForm(record);
      return {
        specId: spec.id,
        recordKey,
        recordId: stableRecordId,
        form: { ...baseForm, ...patch },
        seedForm: sameDocument ? refreshedSeed : spec.initForm(record),
      };
    });
  }, [record, recordKey, spec, stableRecordId]);

  const resetForm = useCallback(() => {
    setSnapshot({
      specId: spec.id,
      recordKey,
      recordId: stableRecordId,
      form: spec.initForm(record),
      seedForm: spec.initForm(record),
    });
  }, [record, recordKey, spec, stableRecordId]);

  const flushPendingChanges = useCallback(async () => {
    await spec.flushPendingChanges?.({ record, form, setForm, patchForm });
  }, [form, patchForm, record, setForm, spec]);

  const output = useMemo(
    () => spec.build({ record, form, setForm, patchForm }),
    [form, patchForm, record, setForm, spec],
  );

  return {
    specId: spec.id,
    form,
    setForm,
    patchForm,
    resetForm,
    flushPendingChanges,
    output,
    primaryAction: output.primaryAction,
    secondaryActions: output.secondaryActions ?? [],
  };
}
