import type { ClassificationType } from "@/modules/accounting/modules/invoices/types/invoice";

export const SOURCE_DOCUMENT_ZOOM_MIN = 0.5;
export const SOURCE_DOCUMENT_ZOOM_MAX = 2;
export const SOURCE_DOCUMENT_ZOOM_STEP = 0.1;

const IMAGE_FILE_PATTERN = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;

export type SourceDocumentRenderMode =
  | "loading"
  | "no-attachment"
  | "image"
  | "image-error"
  | "file-missing"
  | "download-only"
  | "inline";

export interface SourceDocumentRenderInput {
  classification: ClassificationType;
  fileName: string | null;
  available: boolean | null;
  contentType: string | null;
  imageFailed: boolean;
}

export interface SourceDocumentPageSource {
  splitSuggestion?: {
    pageCount?: number | null;
  } | null;
}

export function isImageDocument(fileName: string | null, contentType: string | null): boolean {
  if (contentType) return contentType.startsWith("image/");
  return IMAGE_FILE_PATTERN.test(fileName ?? "") || /^img-/i.test(fileName ?? "");
}

export function canRenderInline(contentType: string | null): boolean {
  if (!contentType) return true;
  const normalized = contentType.toLowerCase();
  return (
    normalized === "application/pdf"
    || normalized.startsWith("image/")
    || normalized.startsWith("text/")
    || normalized === "application/xml"
    || normalized.endsWith("+xml")
  );
}

export function getSourceDocumentRenderMode(input: SourceDocumentRenderInput): SourceDocumentRenderMode {
  if (input.available === null) return "loading";
  if (input.classification === "no-attachment") return "no-attachment";

  const imageDocument = isImageDocument(input.fileName, input.contentType);
  if (imageDocument) return input.imageFailed ? "image-error" : "image";
  if (!input.available) return "file-missing";
  if (!canRenderInline(input.contentType)) return "download-only";
  return "inline";
}

export function clampZoom(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Math.min(Math.max(rounded, SOURCE_DOCUMENT_ZOOM_MIN), SOURCE_DOCUMENT_ZOOM_MAX);
}

export function stepZoom(current: number, direction: "in" | "out"): number {
  const delta = direction === "in" ? SOURCE_DOCUMENT_ZOOM_STEP : -SOURCE_DOCUMENT_ZOOM_STEP;
  return clampZoom(current + delta);
}

export function getSourceDocumentPageCount(source: SourceDocumentPageSource): number {
  const pageCount = source.splitSuggestion?.pageCount;
  return typeof pageCount === "number" && pageCount > 0 ? Math.floor(pageCount) : 1;
}

export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(page, 1), Math.max(pageCount, 1));
}

export function buildInlineDocumentSrc(fileSrc: string, page: number, fitMode: boolean): string {
  const fragment = new URLSearchParams();
  fragment.set("page", String(Math.max(page, 1)));
  if (fitMode) fragment.set("view", "FitH");
  return `${fileSrc}#${fragment.toString()}`;
}
