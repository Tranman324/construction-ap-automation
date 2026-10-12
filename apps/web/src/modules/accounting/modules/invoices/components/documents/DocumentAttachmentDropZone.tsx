"use client";

import type { ChangeEvent, DragEvent } from "react";
import { useRef, useState } from "react";
import { LoaderCircle, UploadCloud } from "lucide-react";

import { useAttachFile } from "@/modules/accounting/modules/invoices/hooks/mutations";
import type { AttachFileResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { toast } from "@/modules/shared/components/ui/toaster";
import { isApiError } from "@/modules/shared/lib/api";
import { cn } from "@/modules/shared/lib/utils";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ELIGIBLE_STATUSES = new Set(["pending", "modified"]);

export function canAttachFile(record: Invoice): boolean {
  return ELIGIBLE_STATUSES.has(record.status) && !record.file;
}

function isAcceptedFile(file: File): boolean {
  return file.type === "application/pdf" || file.type.startsWith("image/");
}

function getSuccessLabel(response: AttachFileResponse): string {
  const vendorName = response.extracted?.vendorName;
  return typeof vendorName === "string" && vendorName.trim()
    ? vendorName
    : response.classification;
}

function getErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return error instanceof Error ? error.message : "Upload failed. Try again.";
  }
  if (error.status === 400) return "Upload failed. Try again.";
  if (error.status === 409) return "A file is already attached. Refreshing the document.";
  if (error.status === 413) return "File too large. The maximum size is 25 MB.";
  // 422 and 500 surface the server's specific message verbatim; 500 keeps a
  // generic fallback for the case where the pipeline returns no message.
  if (error.status === 500) return error.message || "Processing failed. Try again.";
  return error.message || "Upload failed. Try again.";
}

export function DocumentAttachmentDropZone({ record }: { record: Invoice }) {
  const attachFile = useAttachFile();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);

  if (!canAttachFile(record)) return null;

  async function upload(file: File | undefined) {
    if (!file || uploadingRef.current) return;
    if (!isAcceptedFile(file)) {
      toast.error("Upload failed", { description: "Choose a PDF or image file." });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("Upload failed", { description: "File too large. The maximum size is 25 MB." });
      return;
    }

    uploadingRef.current = true;
    setProcessing(true);
    try {
      const response = await attachFile.mutateAsync({ invoiceId: record.id, file });
      toast.success(`Document processed — ${getSuccessLabel(response)}`);
    } catch (error) {
      toast.error("Upload failed", { description: getErrorMessage(error) });
    } finally {
      uploadingRef.current = false;
      setProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files[0]);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    void upload(event.target.files?.[0]);
  }

  const disabled = processing || attachFile.isPending;

  return (
    <PermissionGate requires="accounting.invoices.view_details">
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          className="sr-only"
          disabled={disabled}
          onChange={handleChange}
          tabIndex={-1}
        />
        <button
          type="button"
          aria-label="Attach document file"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "flex min-h-32 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/20 px-4 py-5 text-center transition-colors",
            !disabled && "cursor-pointer hover:border-primary/60 hover:bg-primary/5",
            dragging && "border-primary bg-primary/10",
            disabled && "cursor-wait opacity-70",
          )}
        >
          {disabled ? (
            <>
              <LoaderCircle className="mb-1 h-6 w-6 animate-spin text-primary" aria-hidden="true" />
              <span className="text-sm font-semibold text-foreground">Processing document…</span>
            </>
          ) : (
            <>
              <UploadCloud className="mb-1 h-6 w-6 text-primary" aria-hidden="true" />
              <span className="text-sm font-semibold text-foreground">Drop the invoice PDF here</span>
              <span className="text-xs text-primary">or click to browse</span>
              <span className="mt-1 text-xs text-muted-foreground">
                Download it from the link in the email above, then drop it here.
              </span>
            </>
          )}
        </button>
      </div>
    </PermissionGate>
  );
}
