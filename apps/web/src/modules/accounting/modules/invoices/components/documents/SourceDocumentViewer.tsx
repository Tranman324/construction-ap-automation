"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Download } from "lucide-react";

import { SourceDocumentPlaceholder } from "@/modules/accounting/modules/invoices/components/documents/SourceDocumentPlaceholder";
import {
  buildInlineDocumentSrc,
  getSourceDocumentRenderMode,
} from "@/modules/accounting/modules/invoices/components/documents/sourceDocumentViewerModel";
import type { ClassificationType } from "@/modules/accounting/modules/invoices/types/invoice";
import { Button } from "@/modules/shared/components/ui/button";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import { setDocumentToastAnchor } from "@/modules/shared/components/ui/toaster";
import { cn } from "@/modules/shared/lib/utils";

export interface SourceDocumentRecord {
  id: string;
  classification: ClassificationType;
  file: string | null;
  splitSuggestion?: { pageCount?: number | null } | null;
}

export interface SourceDocumentViewerProps { record: SourceDocumentRecord; className?: string; imageAlt: string; viewerTitle: string; }

interface FileProbe { documentKey: string; available: boolean; contentType: string | null; }

const DOCUMENT_TOAST_OFFSET = 16;

export function SourceDocumentViewer({ record, className, imageAlt, viewerTitle }: SourceDocumentViewerProps) {
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const [fileProbe, setFileProbe] = useState<FileProbe | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const documentKey = `${record.id}:${record.classification}:${record.file ?? ""}`;
  const fileSrc = `/api/backend/invoices/${record.id}/file`;
  const inlineSrc = buildInlineDocumentSrc(fileSrc, 1, true);
  const available = record.classification === "no-attachment"
    ? false
    : fileProbe?.documentKey === documentKey
    ? fileProbe.available
    : null;
  const contentType = record.classification === "no-attachment"
    ? null
    : fileProbe?.documentKey === documentKey
    ? fileProbe.contentType
    : null;
  const imageFailed = imageErrors[documentKey] ?? false;
  const renderMode = getSourceDocumentRenderMode({
    classification: record.classification,
    fileName: record.file,
    available,
    contentType,
    imageFailed,
  });

  useEffect(() => {
    if (record.classification === "no-attachment") return;
    let cancelled = false;

    fetch(fileSrc, { method: "HEAD" })
      .then((response) => {
        if (cancelled) return;
        setFileProbe({
          documentKey,
          available: response.ok,
          contentType: response.ok ? response.headers.get("content-type") ?? "" : null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFileProbe({ documentKey, available: false, contentType: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentKey, fileSrc, record.classification]);

  useEffect(() => {
    viewportRef.current?.scrollTo?.({ left: 0, top: 0 });
  }, [documentKey]);

  useEffect(() => {
    const element = sectionRef.current;
    if (!element || typeof window === "undefined") return;

    const updateAnchor = () => {
      const rect = element.getBoundingClientRect();
      setDocumentToastAnchor({
        left: Math.max(DOCUMENT_TOAST_OFFSET, Math.round(rect.left + DOCUMENT_TOAST_OFFSET)),
        bottom: Math.max(DOCUMENT_TOAST_OFFSET, Math.round(window.innerHeight - rect.bottom + DOCUMENT_TOAST_OFFSET)),
      });
    };

    updateAnchor();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateAnchor);
    resizeObserver?.observe(element);
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor, true);
      setDocumentToastAnchor(null);
    };
  }, []);

  const downloadName = record.file ?? "document";

  return (
    <section ref={sectionRef} className={cn("flex flex-col overflow-hidden", className)}>
      <div ref={viewportRef} className={cn("flex-1 bg-muted/20", renderMode === "inline" ? "overflow-hidden" : "overflow-auto")}>
        {renderMode === "loading" ? (
          <div className="flex h-full items-center justify-center">
            <Skeleton className="h-full w-full rounded-none" />
          </div>
        ) : renderMode === "no-attachment" ? (
          <SourceDocumentPlaceholder icon="missing" title="No attachment - email only" />
        ) : renderMode === "image" ? (
          <div className="flex h-full w-full items-start justify-center p-3">
            <Image
              src={fileSrc}
              alt={imageAlt}
              width={1200}
              height={1600}
              unoptimized
              className="max-h-full max-w-full rounded border border-border object-contain shadow-sm"
              onError={() => setImageErrors((current) => ({ ...current, [documentKey]: true }))}
            />
          </div>
        ) : renderMode === "image-error" ? (
          <SourceDocumentPlaceholder
            icon="missing"
            title="Image preview not available"
            fileName={record.file}
            detail="The file is listed, but the browser could not render the image preview."
          />
        ) : renderMode === "file-missing" ? (
          <SourceDocumentPlaceholder
            icon="missing"
            title={record.classification === "unsupported" ? "Unsupported file type" : "File not available"}
            fileName={record.file}
            detail={record.classification === "unsupported"
              ? "This document type is not supported for inline viewing."
              : "The backend cannot serve this file. Check that the pipeline saved it correctly."}
          />
        ) : renderMode === "download-only" ? (
          <SourceDocumentPlaceholder
            icon="download"
            title="No preview available"
            fileName={record.file}
            detail="This file type cannot be displayed in the browser."
            action={(
              <Button asChild>
                <a href={fileSrc} download={downloadName} className="gap-2">
                  <Download className="h-4 w-4" />
                  Download file
                </a>
              </Button>
            )}
          />
        ) : (
          <div className="h-full min-h-full w-full">
            <iframe
              key={documentKey}
              src={inlineSrc}
              className="h-full min-h-full w-full border-0"
              title={viewerTitle}
            />
          </div>
        )}
      </div>
    </section>
  );
}
