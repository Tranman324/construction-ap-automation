"use client";

import { useCallback, useMemo } from "react";
import { Archive } from "lucide-react";

import { createCoiDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/coiDocumentSpec";
import { createFallbackDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/fallbackDocumentSpec";
import { createOtherDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/otherDocumentSpec";
import { createLienWaiverDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentSpec";
import { createReceiptDocumentSpec, type ReceiptCodingOptions } from "@/modules/accounting/modules/invoices/components/documents/receiptDocumentSpec";
import { createStatementDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/statementDocumentSpec";
import { createSubcontractDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/subcontractDocumentSpec";
import { createW9DocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentSpec";
import { createWarrantyDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/warrantyDocumentSpec";
import {
  useCostTypes,
  useDocumentDestinations,
  useGlAccounts,
  usePhaseCodes,
} from "@/modules/accounting/modules/invoices/hooks/queries";
import { useApplyCoiOverride, useRevokeCoiOverride, useUpdateCoiManualValues, useUpdateStatementAttributes, useUpdateWarrantyClassification } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";
import { isApiError } from "@/modules/shared/lib/api";
import type {
  AddStatementLinePayload,
  AddStatementLineResponse,
  ClassificationInfo,
  DeleteStatementLineResponse,
  InvoiceUpdatePayload,
  RematchStatementLinesResponse,
  ReconcileDocumentResponse,
  ResolveStatementLinePayload,
  StatementLineResolutionResponse,
  UpdateStatementLinePayload,
  UpdateStatementLineResponse,
  UpdateStatementAttributesPayload,
  UpdateStatementAttributesResponse,
  UpdateWarrantyClassificationPayload,
  UpdateWarrantyClassificationResponse,
  UploadCoiToSpectrumPayload,
  UploadCoiToSpectrumResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import type {
  DocumentAction,
  DocumentFilingMeta,
  DocumentFilingResult,
  DocumentPanelNavigation,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

export interface DocumentPanelRouteSpecsOptions {
  record: Invoice;
  splitDocumentAction?: DocumentAction;
  classifications?: readonly ClassificationInfo[];
  navigation?: DocumentPanelNavigation;
  onReclassify?: (classification: string) => void;
  reclassifyPending?: boolean;
  reclassifyDisabled?: boolean;
  onDiscard?: (record: Invoice) => void;
  discardPending?: boolean;
  discardDisabled?: boolean;
  onFile?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onFileToProject?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onUpdateDocument?: (record: Invoice, payload: InvoiceUpdatePayload) => Invoice | void | Promise<Invoice | void>;
  /** Persists statement reconciliation (POST /:id/reconcile) */
  onReconcile?: (record: Invoice) => ReconcileDocumentResponse | Promise<ReconcileDocumentResponse>;
  /** Adds and rematches a statement line (POST /:id/statement-lines) */
  onAddStatementLine?: (record: Invoice, payload: AddStatementLinePayload) => AddStatementLineResponse | Promise<AddStatementLineResponse>;
  /** Updates and rematches a statement line (PATCH /:id/statement-lines/:lineId) */
  onUpdateStatementLine?: (record: Invoice, lineId: string, payload: UpdateStatementLinePayload) => UpdateStatementLineResponse | Promise<UpdateStatementLineResponse>;
  /** Removes and rematches a statement line (DELETE /:id/statement-lines/:lineId) */
  onDeleteStatementLine?: (record: Invoice, lineId: string) => DeleteStatementLineResponse | Promise<DeleteStatementLineResponse>;
  /** Re-checks every statement line against Toolbox/Spectrum (POST /:id/statement-lines/rematch) */
  onRematchStatementLines?: (record: Invoice) => RematchStatementLinesResponse | Promise<RematchStatementLinesResponse>;
  onResolveStatementLine?: (record: Invoice, lineId: string, payload: ResolveStatementLinePayload) => StatementLineResolutionResponse | Promise<StatementLineResolutionResponse>;
  onUnresolveStatementLine?: (record: Invoice, lineId: string) => StatementLineResolutionResponse | Promise<StatementLineResolutionResponse>;
  rematchStatementLinesPending?: boolean;
  /** Queues a COI upload to Spectrum (POST /api/documents/:id/upload-to-spectrum) */
  onUploadToSpectrum?: (record: Invoice, payload: UploadCoiToSpectrumPayload) => UploadCoiToSpectrumResponse | void | Promise<UploadCoiToSpectrumResponse | void>;
  uploadToSpectrumPending?: boolean;
  onViewDocument?: (record: Invoice) => void;
  onLienWaiverLinkComplete?: (record: Invoice) => void;
  filePending?: boolean;
  fileToProjectPending?: boolean;
  reconcilePending?: boolean;
}

export function useDocumentPanelRouteSpecs({
  record,
  splitDocumentAction,
  classifications,
  navigation,
  onReclassify,
  reclassifyPending,
  reclassifyDisabled,
  onDiscard,
  discardPending,
  discardDisabled,
  onFile,
  onFileToProject,
  onUpdateDocument,
  filePending,
  fileToProjectPending,
  reconcilePending,
  onReconcile,
  onAddStatementLine,
  onUpdateStatementLine,
  onDeleteStatementLine,
  onRematchStatementLines,
  onResolveStatementLine,
  onUnresolveStatementLine,
  rematchStatementLinesPending,
  onUploadToSpectrum,
  uploadToSpectrumPending,
  onViewDocument,
  onLienWaiverLinkComplete,
}: DocumentPanelRouteSpecsOptions) {
  const destinationsQuery = useDocumentDestinations();
  const destinations = destinationsQuery.data;
  const { hasPermission } = usePermissions();
  const canOverrideCoi = hasPermission("accounting.invoices.coi_override");
  const applyCoiOverride = useApplyCoiOverride();
  const revokeCoiOverride = useRevokeCoiOverride();
  const updateCoiManualValues = useUpdateCoiManualValues();
  const updateStatementAttributes = useUpdateStatementAttributes();
  const canEditStatementAttributes = hasPermission("accounting.invoices.approve");
  const updateWarrantyClassification = useUpdateWarrantyClassification();
  const canEditWarrantyClassification = hasPermission("accounting.invoices.approve");
  const onApplyCoiOverride = useCallback((target: Invoice, checkId: string, reason?: string) => (
    applyCoiOverride.mutateAsync({ id: target.id, payload: reason ? { checkId, reason } : { checkId } })
  ), [applyCoiOverride]);
  const onRevokeCoiOverride = useCallback((target: Invoice, checkId: string) => (
    revokeCoiOverride.mutateAsync({ id: target.id, checkId })
  ), [revokeCoiOverride]);
  const onUpdateCoiManualValues = useCallback((target: Invoice, payload: import("@/modules/accounting/modules/invoices/types/api").UpdateCoiManualValuesPayload) => (
    updateCoiManualValues.mutateAsync({ id: target.id, payload })
  ), [updateCoiManualValues]);
  const onUpdateStatementAttributes = useCallback((target: Invoice, payload: UpdateStatementAttributesPayload): Promise<UpdateStatementAttributesResponse> => (
    updateStatementAttributes.mutateAsync({ id: target.id, payload })
  ), [updateStatementAttributes]);
  const onUpdateWarrantyClassification = useCallback((target: Invoice, payload: UpdateWarrantyClassificationPayload): Promise<UpdateWarrantyClassificationResponse> => (
    updateWarrantyClassification.mutateAsync({ id: target.id, payload })
  ), [updateWarrantyClassification]);

  const { data: glAccountsData } = useGlAccounts();
  const { data: phaseData } = usePhaseCodes();
  const { data: costTypesData } = useCostTypes();

  const receiptCodingOptions = useMemo<ReceiptCodingOptions>(() => ({
    expenseCategories: (glAccountsData ?? []).map((account) => {
      const code = account.code.trim();
      const description = account.description?.trim() ?? "";
      return { value: code, label: description ? `${code} - ${description}` : code };
    }),
    phaseOptions: (phaseData?.phase_codes ?? []).map((phase) => ({
      value: phase.phase_code,
      label: phase.description ? `${phase.phase_code} - ${phase.description}` : phase.phase_code,
    })),
    costTypes: costTypesData?.costTypes ?? [],
  }), [glAccountsData, phaseData?.phase_codes, costTypesData?.costTypes]);

  const shelveActions = useMemo<DocumentAction[]>(() => (
    onFile
      ? [{
          id: "shelve-document",
          label: "Shelve",
          icon: Archive,
          tone: "neutral",
          disabled: Boolean(record.filed),
          pending: filePending,
          onClick: () => {
            void onFile(record);
          },
        }]
      : []
  ), [filePending, onFile, record]);

  const secondaryActions = useMemo(
    () => [...shelveActions],
    [shelveActions],
  );
  const simpleFilingSecondaryActions = useMemo(
    () => [...shelveActions],
    [shelveActions],
  );
  const simpleFilingAction = onFile;

  const panelNavigation = useMemo<DocumentPanelNavigation>(() => ({
    ...navigation,
    onDiscard: onDiscard ? () => onDiscard(record) : navigation?.onDiscard,
    discardDisabled,
    discardPending,
  }), [discardDisabled, discardPending, navigation, onDiscard, record]);

  return {
    panelNavigation,
    receiptSpec: useMemo(() => createReceiptDocumentSpec({
      onFileDocument: simpleFilingAction,
      onFileToProject,
      onUpdateDocument,
      secondaryActions: simpleFilingSecondaryActions,
      fileToProjectPending,
      destinations,
      codingOptions: receiptCodingOptions,
    }), [destinations, fileToProjectPending, onFileToProject, onUpdateDocument, receiptCodingOptions, simpleFilingAction, simpleFilingSecondaryActions]),
    statementSpec: useMemo(() => createStatementDocumentSpec({
      secondaryActions: [],
      onFileDocument: simpleFilingAction,
      onReconcile,
      onAddStatementLine,
      onUpdateStatementLine,
      onDeleteStatementLine,
      onRematchStatementLines,
      onResolveStatementLine,
      onUnresolveStatementLine,
      rematchStatementLinesPending,
      onUpdateDocument,
      onUpdateStatementAttributes,
      canEditStatementAttributes,
      filePending,
      reconcilePending,
    }), [canEditStatementAttributes, filePending, onAddStatementLine, onDeleteStatementLine, onReconcile, onRematchStatementLines, onResolveStatementLine, onUnresolveStatementLine, onUpdateDocument, onUpdateStatementAttributes, onUpdateStatementLine, reconcilePending, rematchStatementLinesPending, simpleFilingAction]),
    coiSpec: useMemo(() => createCoiDocumentSpec({
      secondaryActions,
      onUploadToSpectrum,
      uploadToSpectrumPending,
      onUpdateDocument,
      onViewDocument,
      canOverride: canOverrideCoi,
      onApplyOverride: onApplyCoiOverride,
      onRevokeOverride: onRevokeCoiOverride,
      onUpdateManualValues: onUpdateCoiManualValues,
    }), [canOverrideCoi, onApplyCoiOverride, onRevokeCoiOverride, onUpdateCoiManualValues, onUpdateDocument, onUploadToSpectrum, onViewDocument, secondaryActions, uploadToSpectrumPending]),
    w9Spec: useMemo(() => createW9DocumentSpec({ secondaryActions }), [secondaryActions]),
    otherSpec: useMemo(() => createOtherDocumentSpec({
      classifications,
      destinations,
      destinationsLoading: destinationsQuery.isLoading,
      destinationsUnavailable: destinationsQuery.isError,
      filePending,
      fileToProjectPending,
      onReclassify,
      reclassifyPending,
      reclassifyDisabled,
      onFileDocument: simpleFilingAction,
      onFileToProject,
      onUpdateDocument,
    }), [classifications, destinations, destinationsQuery.isError, destinationsQuery.isLoading, filePending, fileToProjectPending, onFileToProject, onReclassify, reclassifyDisabled, reclassifyPending, onUpdateDocument, simpleFilingAction]),
    simpleFilingSpec: useMemo(() => createFallbackDocumentSpec({
      onFileDocument: simpleFilingAction,
      onFileToProject,
      secondaryActions: simpleFilingSecondaryActions,
      fileToProjectPending,
      onUpdateDocument,
      destinations,
    }), [destinations, fileToProjectPending, onFileToProject, onUpdateDocument, simpleFilingAction, simpleFilingSecondaryActions]),
    subcontractSpec: useMemo(() => createSubcontractDocumentSpec({
      onFileToProject,
      fileToProjectPending,
      destinations,
    }), [destinations, fileToProjectPending, onFileToProject]),
    warrantySpec: useMemo(() => createWarrantyDocumentSpec({
      onFileToProject,
      fileToProjectPending,
      destinations,
      canEditClassification: canEditWarrantyClassification,
      classificationPending: updateWarrantyClassification.isPending,
      classificationError: isApiError(updateWarrantyClassification.error)
        ? updateWarrantyClassification.error.message
        : updateWarrantyClassification.error instanceof Error
          ? updateWarrantyClassification.error.message
          : null,
      onUpdateClassification: onUpdateWarrantyClassification,
    }), [canEditWarrantyClassification, destinations, fileToProjectPending, onFileToProject, onUpdateWarrantyClassification, updateWarrantyClassification.error, updateWarrantyClassification.isPending]),
    lienWaiverSpec: useMemo(() => createLienWaiverDocumentSpec({
      onFileDocument: simpleFilingAction,
      splitDocumentAction,
      onFileToProject,
      onUpdateDocument,
      secondaryActions: simpleFilingSecondaryActions,
      fileToProjectPending,
      destinations,
      onLinkComplete: onLienWaiverLinkComplete,
    }), [destinations, fileToProjectPending, onFileToProject, onLienWaiverLinkComplete, onUpdateDocument, simpleFilingAction, simpleFilingSecondaryActions, splitDocumentAction]),
  };
}
