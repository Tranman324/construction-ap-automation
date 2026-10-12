import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const UNKNOWN_JOB_NUMBER = "Unassigned";
const UNKNOWN_JOB_NAME = "Unassigned job";

const CANONICAL_TYPE_LABELS: Record<string, string> = {
  receipt: "Receipt", "pay-application": "Pay Application", "credit-memo": "Credit Memo",
  subcontract: "Subcontract", warranty: "Warranty", image: "Image", other: "Document",
  statement: "Statement", coi: "Certificate of Insurance", "building-permit": "Building Permit",
  w9: "W-9", contract: "Contract", "lien-waiver": "Lien Waiver", "change-order": "Change Order",
  "purchase-order": "Purchase Order", "no-attachment": "Document", error: "Document",
  "all-skipped": "Document", skipped: "Document", unsupported: "Document",
};

export interface SimpleJobData {
  id: string;
  name: string;
  label: string;
}

export interface SubcontractFilingData {
  subcontractor: string;
  trade: string;
  job: SimpleJobData;
  subcontractNumber: string;
  contractSum: number | null;
  retainage: string | null;
  fileName: string;
}

export interface WarrantyFilingData {
  provider: string;
  providerKind: string | null;
  warrantyType: string | null;
  job: SimpleJobData;
  scope: string;
  fileName: string;
}

export interface OtherFilingData {
  source: string;
  classificationLabel: string;
  job: SimpleJobData;
  scope: string;
  received: string;
  subject: string;
  fileName: string;
}

const TYPE_ABBREVIATIONS: Partial<Record<Invoice["classification"], string>> = {
  invoice: "INV",
  receipt: "RCT",
  statement: "STMT",
  coi: "COI",
  w9: "W9",
  "lien-waiver": "LW",
  "building-permit": "PMT",
  warranty: "WTY",
};

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolvedFilingValue(record: Invoice, key: "vendor" | "job" | "scope" | "providerKind" | "warrantyType"): string | null {
  const value = record.filing?.[key]?.value;
  return typeof value === "string" ? present(value) : null;
}

export function classificationLabel(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Document";
}

export function getSimpleJobData(record: Invoice): SimpleJobData {
  // Legacy rows may lack the server envelope; these fallbacks are display-only
  // and never feed a filename or upload override.
  const id = resolvedFilingValue(record, "job")
    ?? present(record.extracted?.jobNumber)
    ?? present(record.matching?.job?.jobNumber)
    ?? UNKNOWN_JOB_NUMBER;
  const name = present(record.matching?.job?.jobDescription)
    ?? present(record.extracted?.projectName)
    ?? UNKNOWN_JOB_NAME;

  return {
    id,
    name,
    label: id === UNKNOWN_JOB_NUMBER ? name : `${id} / ${name}`,
  };
}

export function getSimpleDocumentVendor(record: Invoice): string {
  return resolvedFilingValue(record, "vendor")
    ?? present(record.extracted?.vendorName)
    ?? present(record.matching?.vendor?.vendorName)
    ?? record.email.from;
}

export function getSimpleDocumentScope(record: Invoice): string {
  return resolvedFilingValue(record, "scope")
    ?? present(record.extracted?.description)
    ?? present(record.extracted?.lineItems[0]?.description)
    ?? present(record.email.subject)
    ?? "Document review";
}

export function getFilenameExtension(fileName: string | null | undefined): string {
  const match = fileName?.match(/\.([A-Za-z0-9]{1,8})$/);
  return match ? `.${match[1].toLowerCase()}` : ".pdf";
}

export function stripFilenameExtension(fileName: string | null | undefined): string {
  return (fileName ?? "").replace(/\.[A-Za-z0-9]{1,8}$/, "");
}

export function withOriginalFileExtension(input: string, originalFileName: string | null | undefined): string {
  const baseName = sanitizeFilenamePiece(stripFilenameExtension(input)) || sanitizeFilenamePiece(stripFilenameExtension(originalFileName)) || "document";
  return `${baseName}${getFilenameExtension(originalFileName)}`;
}

function sanitizeFilenamePiece(value: string): string {
  return value
    .replace(/[~"%&*:<>?/\\{|}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const trimmed = value.slice(0, maxLength + 1);
  const wordBoundary = trimmed.lastIndexOf(" ");
  if (wordBoundary > 4) return trimmed.slice(0, wordBoundary).trim();
  return value.slice(0, maxLength).trim();
}

function formatShortDate(value: string | null | undefined): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}-${day}-${year}`;
}

export function buildSharePointFilename(record: Invoice): string {
  const type = record.classification === "invoice"
    ? (TYPE_ABBREVIATIONS[record.classification] ?? "DOC")
    : (CANONICAL_TYPE_LABELS[record.classification] ?? "Document");
  const vendorSource = getSimpleDocumentVendor(record);
  const vendorName = vendorSource.includes("@") ? vendorSource.split("@")[0] ?? vendorSource : vendorSource;
  const vendor = truncateAtWord(
    sanitizeFilenamePiece(vendorName),
    15,
  );
  const date = formatShortDate(record.filing?.date?.value ?? record.extracted?.invoiceDate ?? record.email.receivedAt);
  const ref = sanitizeFilenamePiece(record.extracted?.invoiceNumber ?? "");
  const shortRef = ref.length > 0 && ref.length <= 10 ? ref : "";
  const pieces = [type, vendor, date, shortRef].filter((piece) => piece.length > 0);
  const extension = getFilenameExtension(record.file);

  const base = pieces.join(" ");
  return `${base.slice(0, Math.max(1, 128 - extension.length)).replace(/[. ]+$/g, "")}${extension}`;
}

export function getRetainageLabel(record: Invoice): string | null {
  const candidates = [
    record.extracted?.description,
    record.notes,
    record.email.subject,
  ];
  for (const candidate of candidates) {
    const match = candidate?.match(/retainage[:\s-]*(\d+(?:\.\d+)?)\s*%/i);
    if (match?.[1]) return `${match[1]}%`;
  }
  return null;
}

export function getSubcontractFilingData(record: Invoice): SubcontractFilingData {
  return {
    subcontractor: getSimpleDocumentVendor(record),
    trade: getSimpleDocumentScope(record),
    job: getSimpleJobData(record),
    subcontractNumber: present(record.matching?.subcontract?.subcontractNumber)
      ?? present(record.extracted?.invoiceNumber)
      ?? record.id,
    contractSum: record.extracted?.amount ?? record.matching?.sourceInvoiceTotal ?? null,
    retainage: getRetainageLabel(record),
    fileName: record.file,
  };
}

export function getWarrantyFilingData(record: Invoice): WarrantyFilingData {
  return {
    provider: getSimpleDocumentVendor(record),
    // These are display-only server values. The browser deliberately does not
    // infer provider kind from matching or warranty type from scope text.
    providerKind: resolvedFilingValue(record, "providerKind"),
    warrantyType: resolvedFilingValue(record, "warrantyType"),
    job: getSimpleJobData(record),
    scope: getSimpleDocumentScope(record),
    fileName: record.file,
  };
}

export function getOtherFilingData(record: Invoice): OtherFilingData {
  return {
    source: getSimpleDocumentVendor(record),
    classificationLabel: classificationLabel(record.classification),
    job: getSimpleJobData(record),
    scope: getSimpleDocumentScope(record),
    received: record.email.receivedAt,
    subject: record.email.subject,
    fileName: record.file,
  };
}

export function getReclassifyOptions(
  currentClassification: string,
  classifications: readonly ClassificationInfo[] = [],
): ClassificationInfo[] {
  return classifications.filter((classification) => (
    classification.status === "active" &&
    classification.name !== currentClassification &&
    classification.name !== "invoice"
  ));
}
