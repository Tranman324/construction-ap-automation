"use client";

import { useState, useCallback } from "react";
import { AlertCircle, Check, ChevronRight, FileText, FolderKanban, FolderOpen, Loader2, UploadCloud } from "lucide-react";

import {
  findDestinationPathIdsByLabel,
  formatDestinationPath,
  getDestinationFolderChildren,
  getDestinationPathNodes,
} from "@/modules/accounting/modules/invoices/lib/destinationTree";
import type { DestinationFolderNode } from "@/modules/accounting/modules/invoices/types/api";
import { useDocumentDestinations } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useJobFolders } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useSharePointFolders } from "@/modules/accounting/modules/invoices/hooks/queries";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/modules/shared/components/ui/sheet";
import { cn } from "@/modules/shared/lib/utils";

interface DestinationPickerProps {
  value: string;
  onChange: (path: string) => void;
  /** Called alongside onChange with the drive-relative absolute path */
  onChangePath?: (absolutePath: string) => void;
  jobId: string;
  jobName: string;
  note?: string;
  disabled?: boolean;
  tree?: readonly DestinationFolderNode[];
}

function selectedIdsForValue(
  value: string,
  tree: readonly DestinationFolderNode[],
  rootLabel: string,
): string[] {
  return findDestinationPathIdsByLabel(value, tree, rootLabel) ?? [];
}

/** Matches Spectrum job number formats: 26-409, 25-SVC403 */
const JOB_NUMBER_PATTERN = /^\d{2}-(SVC)?\d{3,4}$/i;

const DRIVE_ROOT_LABEL = "Projects";

function hasAssignedJob(jobId: string): boolean {
  return JOB_NUMBER_PATTERN.test(jobId);
}

function getDisplayJobName(jobId: string, jobName: string): string {
  if (!hasAssignedJob(jobId)) return "Projects root";
  const trimmed = jobName.trim();
  if (!trimmed || /^unassigned job$/i.test(trimmed)) return "Selected project";
  return trimmed;
}

function getDisplayJobContext(jobId: string, jobName: string): string {
  if (!hasAssignedJob(jobId)) return "Projects root";
  return `${jobId} / ${getDisplayJobName(jobId, jobName)}`;
}

// ─── Static fallback picker (original behavior) ─────────────────────────────

function StaticDestinationPicker({
  value,
  onChange,
  jobId,
  jobName,
  note,
  disabled,
  tree,
  rootLabel,
}: Omit<DestinationPickerProps, "onChangePath"> & { rootLabel: string | undefined }) {
  const resolvedTree = tree ?? [];
  const resolvedRootLabel = rootLabel ?? "";

  const [open, setOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>(() => selectedIdsForValue(value, resolvedTree, resolvedRootLabel));
  const selectedPath = value || rootLabel || "No destination";
  const draftNodes = getDestinationPathNodes(draftIds, resolvedTree) ?? [];
  const draftPath = formatDestinationPath(draftNodes, resolvedRootLabel);
  const children = getDestinationFolderChildren(draftIds, resolvedTree);

  function openPicker() {
    setDraftIds(selectedIdsForValue(selectedPath, resolvedTree, resolvedRootLabel));
    setOpen(true);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      openPicker();
      return;
    }
    setOpen(false);
  }

  function navigateTo(pathIds: string[]) {
    setDraftIds(pathIds);
  }

  function confirmSelection() {
    onChange(draftPath);
    setOpen(false);
  }

  return (
    <>
      <PickerTrigger
        selectedPath={selectedPath}
        jobId={jobId}
        jobName={jobName}
        note={note}
        disabled={disabled}
        onBrowse={openPicker}
      />

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-4 py-4">
            <SheetTitle className="text-base">Choose a SharePoint folder</SheetTitle>
            <SheetDescription className="text-xs">
              {getDisplayJobContext(jobId, jobName)} - SharePoint
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <nav className="flex flex-wrap items-center gap-1" aria-label="Folder breadcrumbs">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => navigateTo([])}
                aria-label={`Go to ${jobId} root`}
              >
                <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
                {jobId}
              </Button>
              {draftNodes.map((node, index) => {
                const pathIds = draftIds.slice(0, index + 1);
                return (
                  <span key={node.id} className="inline-flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => navigateTo(pathIds)}
                      aria-label={`Go to ${formatDestinationPath(draftNodes.slice(0, index + 1), resolvedRootLabel)}`}
                    >
                      {node.name}
                    </Button>
                  </span>
                );
              })}
            </nav>

            <div className="rounded-lg border border-border p-1">
              {children.length === 0 && (
                <div role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">
                  This folder is empty.
                </div>
              )}
              {children.map((node) => {
                const nextIds = [...draftIds, node.id];
                const isEmpty = (node.children ?? []).length === 0;
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    onClick={() => navigateTo(nextIds)}
                    aria-label={`Open ${node.name}`}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{node.name}</span>
                    {isEmpty ? (
                      <span className="text-2xs font-medium text-muted-foreground">Empty</span>
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <SheetFooter className="border-t border-border p-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmSelection}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Save to this folder
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Live browse picker ──────────────────────────────────────────────────────

function LiveDestinationPicker({
  value,
  onChange,
  onChangePath,
  jobId,
  jobName,
  jobFolder,
  note,
  disabled,
  rootLabel,
}: Omit<DestinationPickerProps, "tree"> & { jobFolder: string; rootLabel: string | undefined }) {
  const [open, setOpen] = useState(false);
  // currentPath = drive-relative path being browsed (undefined = not browsing)
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);

  const foldersQuery = useSharePointFolders(open ? currentPath : undefined);

  const selectedPath = value || rootLabel || "No destination";

  // Split currentPath into segments for breadcrumbs
  const pathSegments = currentPath ? currentPath.split("/").filter(Boolean) : [];
  const folders = foldersQuery.data?.folders ?? [];
  const files = foldersQuery.data?.files ?? [];

  // Determine display path for a given drive-relative path
  const getDisplayPath = useCallback(
    (drivePath: string): string => {
      if (!drivePath) return rootLabel ?? "No destination";

      // If inside the job folder, show path relative to the job folder
      if (jobFolder && drivePath.startsWith(jobFolder)) {
        const relative = drivePath.slice(jobFolder.length).replace(/^\//, "");
        if (!relative) return rootLabel ?? "No destination";
        return relative.split("/").filter(Boolean).join(" / ");
      }

      // Outside the job folder: prefix with "Projects / "
      return `${DRIVE_ROOT_LABEL} / ${drivePath.split("/").filter(Boolean).join(" / ")}`;
    },
    [jobFolder, rootLabel],
  );

  function openPicker() {
    // Start browsing at the job folder
    setCurrentPath(jobFolder);
    setOpen(true);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      openPicker();
      return;
    }
    setOpen(false);
  }

  function navigateToPath(path: string) {
    setCurrentPath(path);
  }

  function confirmSelection() {
    const displayPath = getDisplayPath(currentPath ?? "");
    onChange(displayPath);
    onChangePath?.(currentPath ?? "");
    setOpen(false);
  }

  return (
    <>
      <PickerTrigger
        selectedPath={selectedPath}
        jobId={jobId}
        jobName={jobName}
        note={note}
        disabled={disabled}
        onBrowse={openPicker}
      />

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-4 py-4">
            <SheetTitle className="text-base">Choose a SharePoint folder</SheetTitle>
            <SheetDescription className="text-xs">
              {getDisplayJobContext(jobId, jobName)} - SharePoint (live)
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {/* Breadcrumbs: Projects root → each path segment */}
            <nav className="flex flex-wrap items-center gap-1" aria-label="Folder breadcrumbs">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => navigateToPath("")}
                aria-label={`Go to ${DRIVE_ROOT_LABEL} root`}
              >
                <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
                {DRIVE_ROOT_LABEL}
              </Button>
              {pathSegments.map((segment, index) => {
                const segmentPath = pathSegments.slice(0, index + 1).join("/");
                return (
                  <span key={segmentPath} className="inline-flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => navigateToPath(segmentPath)}
                      aria-label={`Go to ${segment}`}
                    >
                      {segment}
                    </Button>
                  </span>
                );
              })}
            </nav>

            {/* Folder contents */}
            <div className="rounded-lg border border-border p-1">
              {foldersQuery.isLoading && (
                <div role="status" className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading SharePoint contents…
                </div>
              )}

              {foldersQuery.isError && (
                <div role="alert" className="flex items-center gap-2 px-4 py-8 text-center text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Failed to load SharePoint contents. Try navigating again.</span>
                </div>
              )}

              {foldersQuery.isSuccess && folders.length === 0 && files.length === 0 && (
                <div role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">
                  This folder is empty.
                </div>
              )}

              {foldersQuery.isSuccess &&
                folders.map((folder) => {
                  const nextPath = currentPath ? `${currentPath}/${folder.name}` : folder.name;
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                      onClick={() => navigateToPath(nextPath)}
                      aria-label={`Open ${folder.name}`}
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{folder.name}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </button>
                  );
                })}

              {foldersQuery.isSuccess &&
                files.map((file) => {
                  const rowClassName = cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left",
                    "text-muted-foreground transition-colors",
                    file.webUrl && "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  );
                  const rowContent = (
                    <>
                      <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
                      <span className="text-2xs font-medium">File</span>
                    </>
                  );

                  if (file.webUrl) {
                    return (
                      <a
                        key={file.id}
                        href={file.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={rowClassName}
                        aria-label={`Open file ${file.name}`}
                      >
                        {rowContent}
                      </a>
                    );
                  }

                  return (
                    <div key={file.id} className={rowClassName}>
                      {rowContent}
                    </div>
                  );
                })}
            </div>
          </div>

          <SheetFooter className="border-t border-border p-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmSelection}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Save to this folder
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Shared trigger button ───────────────────────────────────────────────────

function PickerTrigger({
  selectedPath,
  jobId,
  jobName,
  note,
  disabled,
  onBrowse,
}: {
  selectedPath: string;
  jobId: string;
  jobName: string;
  note?: string;
  disabled?: boolean;
  onBrowse: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <UploadCloud className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>SharePoint</span>
          <ChevronRight className="h-3 w-3 opacity-60" aria-hidden="true" />
          <span>{getDisplayJobContext(jobId, jobName)}</span>
          {hasAssignedJob(jobId) && <ChevronRight className="h-3 w-3 opacity-60" aria-hidden="true" />}
          <strong className="font-semibold text-foreground">{selectedPath}</strong>
        </p>
        {note && <p className="text-xs leading-snug text-muted-foreground">{note}</p>}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onBrowse}
        disabled={disabled}
      >
        <FolderOpen className="h-4 w-4" aria-hidden="true" />
        Browse
      </Button>
    </div>
  );
}

// ─── Exported picker — routes to live or static ──────────────────────────────

export function DestinationPicker({
  value,
  onChange,
  onChangePath,
  jobId,
  jobName,
  note,
  disabled,
  tree: treeProp,
}: DestinationPickerProps) {
  // Served destination catalog (folder tree + root label). No client fallback:
  // when unavailable, `rootLabel` is undefined and the picker renders an
  // explicit no-destination display instead of a hardcoded root literal.
  const destinationsQuery = useDocumentDestinations();
  const rootLabel = destinationsQuery.data?.rootLabel;

  // Resolve the job's SharePoint folder (when a job is matched) so live
  // browsing can open there. Unmatched/unassigned docs still browse live —
  // they just start at the Projects drive root.
  const jobFoldersQuery = useJobFolders(
    !treeProp && JOB_NUMBER_PATTERN.test(jobId) ? jobId : undefined,
  );

  // Static picker only when an explicit tree is provided (tests/storybook).
  // Everything else browses the live drive.
  if (treeProp) {
    return (
      <StaticDestinationPicker
        value={value}
        onChange={onChange}
        jobId={jobId}
        jobName={jobName}
        note={note}
        disabled={disabled}
        tree={treeProp}
        rootLabel={rootLabel}
      />
    );
  }

  return (
    <LiveDestinationPicker
      value={value}
      onChange={onChange}
      onChangePath={onChangePath}
      jobId={jobId}
      jobName={jobName}
      jobFolder={jobFoldersQuery.data?.jobFolder ?? ""}
      note={note}
      disabled={disabled}
      rootLabel={rootLabel}
    />
  );
}
