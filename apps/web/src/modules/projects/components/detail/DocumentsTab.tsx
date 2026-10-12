'use client';

import { useState, useCallback } from 'react';
import {
  ExternalLink,
  Upload,
  Download,
  FileText,
  Folder,
  ChevronRight,
  Eye,
  Search,
  ArrowLeft,
  FileSpreadsheet,
  FileImage,
  File,
  MoreHorizontal,
  Info,
} from 'lucide-react';
import { useSharePointDocuments } from '@/modules/projects/hooks/queries';
import type { ProjectDocument } from '@/modules/projects/types/document';
import { cn } from '@/modules/shared/lib/utils';
import { Badge } from '@/modules/shared/components/ui/badge';
import { Button } from '@/modules/shared/components/ui/button';
import { Input } from '@/modules/shared/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/shared/components/ui/tooltip';

export interface DocumentsTabProps {
  projectId: string;
}

// ─── SharePoint folder structure (simulated from mock docs) ──────────────────

interface SPFolder {
  name: string;
  children: SPNode[];
}

interface SPFile {
  name: string;
  doc: ProjectDocument;
}

type SPNode = ({ type: 'folder' } & SPFolder) | ({ type: 'file' } & SPFile);

const CATEGORY_FOLDERS: Record<string, string> = {
  Permit: '01 - Permits',
  Contract: '02 - Contracts',
  Subcontract: '03 - Subcontracts',
  Budget: '04 - Budget',
  Schedule: '05 - Schedule',
  Photo: '06 - Photos',
  Closeout: '07 - Closeout',
  Other: '08 - General',
};

function buildFolderTree(docs: ProjectDocument[]): SPFolder {
  const folderMap: Record<string, SPNode[]> = {};
  for (const doc of docs) {
    const folderName = CATEGORY_FOLDERS[doc.category] ?? '08 - General';
    if (!folderMap[folderName]) folderMap[folderName] = [];
    folderMap[folderName].push({ type: 'file', name: doc.file_name, doc });
  }
  const children: SPNode[] = Object.entries(CATEGORY_FOLDERS)
    .map(([, folder]) => ({
      type: 'folder' as const,
      name: folder,
      children: folderMap[folder] ?? [],
    }))
    .filter((f) => f.children.length > 0);
  return { name: 'Documents', children };
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return <FileText className="h-4 w-4 text-red-500" />;
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return <FileSpreadsheet className="h-4 w-4 text-emerald-600" />;
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'zip' || ext === 'webp') return <FileImage className="h-4 w-4 text-violet-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function formatSize(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DocumentsTab({ projectId }: DocumentsTabProps) {
  const { data: rawDocs } = useSharePointDocuments(projectId);
  const allDocs: ProjectDocument[] = rawDocs ?? [];
  const tree = buildFolderTree(allDocs);

  const [path, setPath] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [previewDoc, setPreviewDoc] = useState<ProjectDocument | null>(null);

  // Navigate into folder tree
  const currentFolder = path.reduce<SPFolder>((folder, segment) => {
    const child = folder.children.find(
      (n): n is SPFolder & { type: 'folder' } => n.type === 'folder' && n.name === segment,
    );
    return child ?? folder;
  }, tree);

  const breadcrumbs = ['Documents', ...path];

  // Search filter across all docs
  const searchResults = search
    ? allDocs.filter((d) => d.file_name.toLowerCase().includes(search.toLowerCase()))
    : null;

  const handleFolderClick = useCallback((name: string) => {
    setPath((prev) => [...prev, name]);
    setSearch('');
  }, []);

  const handleBreadcrumb = useCallback((index: number) => {
    setPath((prev) => prev.slice(0, index));
    setSearch('');
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* SharePoint chrome header */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#038387]" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
              <span className="font-medium text-foreground">SharePoint</span>
            </div>

            <div className="flex-1 flex justify-center">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search documents..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs bg-background"
                />
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => console.log('[STUB] Upload via Graph API')}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Upload files via Microsoft Graph API
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => window.open(`https://northwindcg.sharepoint.example/sites/projects/${projectId}`, '_blank')}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Open in SharePoint
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Breadcrumb bar */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/10 text-xs">
            {path.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 mr-1"
                onClick={() => setPath((prev) => prev.slice(0, -1))}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
            )}
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <button
                  type="button"
                  className={cn(
                    'hover:underline transition-colors',
                    i === breadcrumbs.length - 1
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => handleBreadcrumb(i)}
                >
                  {crumb}
                </button>
              </span>
            ))}
            <span className="ml-auto text-muted-foreground tabular-nums">
              {searchResults
                ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`
                : `${currentFolder.children.length} item${currentFolder.children.length !== 1 ? 's' : ''}`}
            </span>
          </div>

          {/* File list — styled like SharePoint document library */}
          <div className="divide-y divide-border">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_120px_100px_80px] gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide bg-muted/20">
              <span>Name</span>
              <span>Modified By</span>
              <span>Date</span>
              <span className="text-right">Size</span>
            </div>

            {/* Search results mode */}
            {searchResults ? (
              searchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 gap-2">
                  <Search className="h-6 w-6 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No files match &quot;{search}&quot;</p>
                </div>
              ) : (
                searchResults.map((doc, i) => (
                  <div
                    key={doc.id}
                    className="grid grid-cols-[1fr_120px_100px_80px] gap-2 px-4 py-2.5 items-center hover:bg-muted/20 transition-colors cursor-pointer group"
                    style={{ animation: `card-enter 0.3s ease-out ${i * 30}ms both` }}
                    onClick={() => setPreviewDoc(doc)}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {fileIcon(doc.file_name)}
                      <span className="text-sm truncate text-foreground group-hover:text-primary transition-colors">
                        {doc.file_name}
                      </span>
                      <Badge className="text-[9px] px-1.5 py-0 bg-muted text-muted-foreground border-0 shrink-0">
                        {doc.category}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground truncate">{doc.uploaded_by}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(doc.uploaded_at).toLocaleDateString()}
                    </span>
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-xs text-muted-foreground tabular-nums">{formatSize(doc.file_size_kb)}</span>
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); window.open(doc.file_url, '_blank'); }}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))
              )
            ) : currentFolder.children.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 gap-2">
                <Folder className="h-6 w-6 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">This folder is empty</p>
              </div>
            ) : (
              currentFolder.children.map((node, i) => {
                if (node.type === 'folder') {
                  return (
                    <div
                      key={node.name}
                      className="grid grid-cols-[1fr_120px_100px_80px] gap-2 px-4 py-2.5 items-center hover:bg-muted/20 transition-colors cursor-pointer group"
                      style={{ animation: `card-enter 0.3s ease-out ${i * 30}ms both` }}
                      onClick={() => handleFolderClick(node.name)}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                        <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                          {node.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {node.children.length} item{node.children.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">—</span>
                      <span className="text-xs text-muted-foreground">—</span>
                      <span className="text-xs text-muted-foreground text-right">—</span>
                    </div>
                  );
                }
                return (
                  <div
                    key={node.doc.id}
                    className="grid grid-cols-[1fr_120px_100px_80px] gap-2 px-4 py-2.5 items-center hover:bg-muted/20 transition-colors cursor-pointer group"
                    style={{ animation: `card-enter 0.3s ease-out ${i * 30}ms both` }}
                    onClick={() => setPreviewDoc(node.doc)}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {fileIcon(node.name)}
                      <span className="text-sm truncate text-foreground group-hover:text-primary transition-colors">
                        {node.name}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate">{node.doc.uploaded_by}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(node.doc.uploaded_at).toLocaleDateString()}
                    </span>
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-xs text-muted-foreground tabular-nums">{formatSize(node.doc.file_size_kb)}</span>
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); window.open(node.doc.file_url, '_blank'); }}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Preview panel overlay */}
        {previewDoc && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2 min-w-0">
                {fileIcon(previewDoc.file_name)}
                <span className="text-sm font-medium truncate">{previewDoc.file_name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs gap-1.5"
                  onClick={() => window.open(previewDoc.file_url, '_blank')}
                >
                  <Eye className="h-3 w-3" />
                  Open
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs gap-1.5"
                  onClick={() => window.open(previewDoc.file_url, '_blank')}
                >
                  <Download className="h-3 w-3" />
                  Download
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => setPreviewDoc(null)}
                >
                  Close
                </Button>
              </div>
            </div>
            {/* Simulated preview area — real SharePoint would iframe the document */}
            <div className="flex flex-col items-center justify-center py-20 gap-3 bg-muted/5">
              <div className="rounded-full bg-muted p-4">
                {fileIcon(previewDoc.file_name)}
              </div>
              <p className="text-sm font-medium text-foreground">{previewDoc.file_name}</p>
              <p className="text-xs text-muted-foreground">
                {previewDoc.uploaded_by} &middot; {new Date(previewDoc.uploaded_at).toLocaleDateString()} &middot; {formatSize(previewDoc.file_size_kb)}
              </p>
              <p className="text-xs text-muted-foreground/60 italic max-w-sm text-center mt-2">
                Document preview requires SharePoint Online connection.
                Click &quot;Open&quot; to view in SharePoint.
              </p>
            </div>
          </div>
        )}

        {/* Integration note */}
        <div className="flex items-start gap-2.5 rounded-lg bg-muted/30 border border-border px-4 py-3">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">SharePoint Integration</p>
            <p>
              This view models an embedded SharePoint document library. In production, the file list
              is rendered via the Microsoft Graph API. Files can be opened, previewed, and downloaded
              directly. Uploads are handled through the Graph API upload endpoint.
            </p>
            <p>
              Drag-and-drop upload is not supported in standard SharePoint iframe embeds.
              The Upload button uses the Graph API file upload flow instead.
            </p>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
