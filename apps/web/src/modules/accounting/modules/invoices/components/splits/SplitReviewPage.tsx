"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SplitReviewContent } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewContent";
import { SplitReviewDialogs } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewDialogs";
import { SplitReviewHeader } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewHeader";
import { SplitReviewLoadRecovery } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewLoadRecovery";
import { SplitReviewSkeleton } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewSkeleton";
import { useSplitReviewEditor } from "@/modules/accounting/modules/invoices/components/splits/useSplitReviewEditor";
import {
  useAnalyzeSplit,
  useCancelSplit,
  useConfirmSplit,
} from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useClassifications, useInvoiceNeighbors, useSplitDoc } from "@/modules/accounting/modules/invoices/hooks/queries";
import {
  deserializeQueueNavContext,
  toInvoiceQueryFilters,
} from "@/modules/accounting/modules/invoices/components/dashboard/invoiceDashboardModel";
import {
  getActiveSplitDocTypeOptions,
  layoutToGroups,
} from "@/modules/accounting/modules/invoices/lib/splitLayout";

export interface SplitQueueNavigationParams {
  from?: string;
  sort?: string;
  sortDir?: string;
  panel?: string;
  classification?: string;
  search?: string;
  status?: string;
  splitFrom?: string;
}

interface SplitReviewPageProps {
  id: string;
  returnTo?: string;
  queueParams?: SplitQueueNavigationParams;
}

export function SplitReviewPage({ id, returnTo, queueParams }: SplitReviewPageProps) {
  const router = useRouter();
  const {
    data: doc,
    error: splitDocError,
    isError: splitDocLoadFailed,
    isFetching: splitDocFetching,
    isLoading,
    refetch: refetchSplitDoc,
  } = useSplitDoc(id);
  const { classifications } = useClassifications();
  const returnPath = returnTo ?? "/accounting/invoices";
  const hasQueueContext = useMemo(
    () => Boolean(
      queueParams?.sort
      || queueParams?.sortDir
      || queueParams?.panel
      || queueParams?.classification
      || queueParams?.search
      || queueParams?.status
      || queueParams?.splitFrom,
    ),
    [queueParams],
  );
  const navContext = useMemo(
    () => deserializeQueueNavContext((key) => queueParams?.[key as keyof SplitQueueNavigationParams] ?? null),
    [queueParams],
  );
  const neighborsFilters = useMemo(
    () => toInvoiceQueryFilters(navContext.filters, navContext.splitFrom),
    [navContext],
  );
  const { data: neighbors } = useInvoiceNeighbors(id, neighborsFilters, { enabled: hasQueueContext });
  const nextId = hasQueueContext ? neighbors?.next ?? null : null;
  const navQs = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(queueParams ?? {})) {
      if (value) params.set(key, value);
    }
    return params.size ? `?${params.toString()}` : "";
  }, [queueParams]);
  const pageCount = doc?.splitSuggestion?.pageCount ?? doc?.pageCount ?? 0;
  const docTypeOptions = useMemo(() => getActiveSplitDocTypeOptions(classifications), [classifications]);
  const editor = useSplitReviewEditor(pageCount, docTypeOptions);
  const [singleDocumentOpen, setSingleDocumentOpen] = useState(false);
  const seededDocId = useRef<string | null>(null);
  const analyzeStartedFor = useRef<string | null>(null);

  const confirmMutation = useConfirmSplit();
  const cancelMutation = useCancelSplit();
  const analyzeMutation = useAnalyzeSplit();

  const advanceAfterSplit = useCallback(() => {
    if (nextId) {
      router.push(`/accounting/invoices/${nextId}${navQs}`);
      return;
    }
    router.push(returnPath);
  }, [navQs, nextId, returnPath, router]);

  useEffect(() => {
    if (!id || analyzeStartedFor.current === id) return;
    analyzeStartedFor.current = id;
    analyzeMutation.mutate(id, {
      onSuccess: () => {
        void refetchSplitDoc();
      },
    });
  }, [analyzeMutation, id, refetchSplitDoc]);

  useEffect(() => {
    if (!doc?.splitSuggestion || seededDocId.current === doc.id) return;
    seededDocId.current = doc.id;
    editor.seedFromSuggestion(doc.splitSuggestion);
  }, [doc?.id, doc?.splitSuggestion, editor]);

  const triggerAnalyze = useCallback(() => {
    analyzeMutation.mutate(id, {
      onSuccess: () => {
        seededDocId.current = null;
        void refetchSplitDoc();
      },
    });
  }, [analyzeMutation, id, refetchSplitDoc]);

  const handleConfirm = useCallback(() => {
    if (!editor.state || !doc || !editor.validation.valid) return;
    confirmMutation.mutate(
      { id: doc.id, payload: layoutToGroups(editor.state) },
      { onSuccess: advanceAfterSplit },
    );
  }, [advanceAfterSplit, confirmMutation, doc, editor.state, editor.validation.valid]);

  const handleTreatAsSingleDocument = useCallback(() => {
    if (!doc) return;
    cancelMutation.mutate(
      { id: doc.id },
      { onSuccess: () => router.push(`/accounting/invoices/${doc.id}${navQs}`) },
    );
  }, [cancelMutation, doc, navQs, router]);

  const handleCancel = useCallback(() => {
    router.push(returnPath);
  }, [returnPath, router]);

  if (isLoading) return <SplitReviewSkeleton />;

  if (splitDocLoadFailed) {
    return (
      <SplitReviewLoadRecovery
        title="Split document could not be loaded"
        detail={splitDocError?.message ?? "Retry the request or return to the invoice queue."}
        retrying={splitDocFetching}
        onRetry={() => {
          void refetchSplitDoc();
        }}
        onBack={() => router.push(returnPath)}
      />
    );
  }

  if (!doc) {
    return (
      <SplitReviewLoadRecovery
        title="Split document not found"
        detail="This split review item is unavailable. Retry the request or return to the invoice queue."
        retrying={splitDocFetching}
        onRetry={() => {
          void refetchSplitDoc();
        }}
        onBack={() => router.push(returnPath)}
      />
    );
  }

  const isMutating = confirmMutation.isPending || cancelMutation.isPending;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <SplitReviewHeader
        fileName={doc.fileName}
        onBack={() => router.push(returnPath)}
      />

      <SplitReviewContent
        docId={doc.id}
        fileName={doc.fileName}
        pageCount={pageCount}
        editor={editor}
        docTypeOptions={docTypeOptions}
        analyzePending={analyzeMutation.isPending}
        analyzeError={analyzeMutation.isError ? analyzeMutation.error.message : null}
        isMutating={isMutating}
        confirmPending={confirmMutation.isPending}
        confirmError={confirmMutation.isError ? confirmMutation.error.message : null}
        onAnalyzeRetry={triggerAnalyze}
        onBuildManually={() => {
          seededDocId.current = doc.id;
          editor.startWithSingleDocument();
        }}
        onTreatAsSingleDocument={() => setSingleDocumentOpen(true)}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />

      <SplitReviewDialogs
        singleDocumentOpen={singleDocumentOpen}
        singleDocumentPending={cancelMutation.isPending}
        onSingleDocumentOpenChange={setSingleDocumentOpen}
        onConfirmSingleDocument={handleTreatAsSingleDocument}
      />
    </div>
  );
}
