"use client";

import { GroupBuilder } from "@/modules/accounting/modules/invoices/components/splits/GroupBuilder";
import { PageThumbnailStrip } from "@/modules/accounting/modules/invoices/components/splits/PageThumbnailStrip";
import { SplitReviewFooter } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewFooter";
import { SplitReviewPending } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewPending";
import { SplitSelectedPageViewer } from "@/modules/accounting/modules/invoices/components/splits/SplitSelectedPageViewer";
import { useSplitReviewEditor } from "@/modules/accounting/modules/invoices/components/splits/useSplitReviewEditor";
import type { SplitDocTypeOption } from "@/modules/accounting/modules/invoices/lib/splitLayout";
import { SplitResizer } from "@/modules/accounting/modules/invoices/components/documents/SplitResizer";
import { useSplitWidth } from "@/modules/accounting/modules/invoices/components/documents/useSplitWidth";
import splitStyles from "@/modules/accounting/modules/invoices/components/documents/SplitResizer.module.css";

interface SplitReviewContentProps {
  docId: string;
  fileName: string;
  pageCount: number;
  editor: ReturnType<typeof useSplitReviewEditor>;
  docTypeOptions: readonly SplitDocTypeOption[];
  analyzePending: boolean;
  analyzeError: string | null;
  isMutating: boolean;
  confirmPending: boolean;
  confirmError: string | null;
  onAnalyzeRetry: () => void;
  onBuildManually: () => void;
  onTreatAsSingleDocument: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SplitReviewContent({
  docId,
  fileName,
  pageCount,
  editor,
  docTypeOptions,
  analyzePending,
  analyzeError,
  isMutating,
  confirmPending,
  confirmError,
  onAnalyzeRetry,
  onBuildManually,
  onTreatAsSingleDocument,
  onCancel,
  onConfirm,
}: SplitReviewContentProps) {
  const editorReady = editor.state !== null;
  const { containerRef, containerStyle, width, setWidth } = useSplitWidth();

  return (
    <div ref={containerRef} style={containerStyle} className={`${splitStyles.splitShell} flex min-h-0 flex-1 flex-col min-[1100px]:flex-row`}>
      <SplitSelectedPageViewer
        docId={docId}
        fileName={fileName}
        pageCount={Math.max(pageCount, 1)}
        selectedPage={editor.selectedPage}
        group={editor.selectedViewerGroup}
        loading={analyzePending && !editorReady}
        onSelectedPageChange={editor.setSelectedPage}
        className={`${splitStyles.splitPane} min-[1100px]:flex-none min-[1100px]:w-[var(--split-doc-width)]`}
      />

      <aside className={`${splitStyles.splitPane} flex min-w-0 flex-1 flex-col overflow-hidden min-[1100px]:flex-none min-[1100px]:w-[calc(100%_-_var(--split-doc-width))]`}>
        {editorReady && editor.state ? (
          <>
            <PageThumbnailStrip
              docId={docId}
              pageCount={pageCount}
              state={editor.state}
              selectedPage={editor.selectedPage}
              highlightedGroupIndex={editor.hoveredGroupIndex}
              onSelectPage={editor.setSelectedPage}
              onTogglePage={editor.handleTogglePage}
              onToggleCut={editor.handleToggleCut}
              onDiscardPage={editor.handleDiscardPage}
              onUndiscardPage={editor.handleUndiscardPage}
            />
            <GroupBuilder
              state={editor.state}
              pageCount={pageCount}
              selectedPage={editor.selectedPage}
              docTypeOptions={docTypeOptions}
              onCreateGroup={editor.handleCreateGroup}
              onUpdateGroupName={editor.handleUpdateGroupName}
              onUpdateGroupDocType={editor.handleUpdateGroupDocType}
              onDiscardSelected={editor.handleDiscardSelected}
              onClearSelection={editor.handleClearSelection}
              onSelectAllUnassigned={editor.handleSelectAllUnassigned}
              onSelectGroup={editor.handleSelectGroup}
              onHoverGroup={editor.setHoveredGroupIndex}
            />
            <SplitReviewFooter
              valid={editor.validation.valid}
              firstError={editor.validation.valid ? null : editor.validation.errors[0]}
              unassignedCount={editor.unassignedCount}
              groupCount={editor.state.groups.length}
              isMutating={isMutating}
              confirmPending={confirmPending}
              confirmError={confirmError}
              onTreatAsSingleDocument={onTreatAsSingleDocument}
              onCancel={onCancel}
              onConfirm={onConfirm}
            />
          </>
        ) : (
          <SplitReviewPending
            isAnalyzing={analyzePending}
            analyzeError={analyzeError}
            onRetry={onAnalyzeRetry}
            onBuildManually={onBuildManually}
          />
        )}
      </aside>
      <SplitResizer
        containerRef={containerRef}
        width={width}
        onWidthChange={setWidth}
        label="Resize split review panels"
      />
    </div>
  );
}
