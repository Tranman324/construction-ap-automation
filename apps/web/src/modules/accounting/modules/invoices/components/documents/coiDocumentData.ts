import { formatDocumentMoney, getDocumentVendor } from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

export interface CoiCoverageLimitDisplay {
  label: string;
  value: number;
}

export interface CoiCoverageLineDisplay {
  id: string;
  label: string;
  carrier: string;
  policyNumber: string;
  expirationDate: string | null;
  limits: readonly CoiCoverageLimitDisplay[];
}

export interface CoiDisplayData {
  insured: string;
  vendorCode: string;
  coverageLines: readonly CoiCoverageLineDisplay[];
}

function displayLabel(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/[-_]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

/** Raw extracted display fields only; compliance interpretation remains server-owned. */
export function getCoiDisplayData(record: Invoice): CoiDisplayData {
  const insured = record.extracted?.insuredName?.trim() || getDocumentVendor(record);
  const coverageLines = (record.coiData?.coverageLines ?? []).map((line) => ({
    id: line.type,
    label: displayLabel(line.type),
    carrier: line.carrier ?? "Unknown",
    policyNumber: line.policyNumber ?? "",
    expirationDate: line.expirationDate,
    limits: Object.entries(line.limits ?? {}).map(([label, value]) => ({ label: displayLabel(label), value })),
  }));

  return {
    insured,
    vendorCode: record.matching?.vendor?.vendorCode ?? "",
    coverageLines,
  };
}

/** Form seeds are editable inputs only; they never determine compliance. */
export function getCoiFormSeeds(record: Invoice): { vendorCode: string; expirationDate: string } {
  return {
    vendorCode: record.compliance?.vendorCode.value ?? record.matching?.vendor?.vendorCode ?? "",
    expirationDate: record.compliance?.expiration.value.expirationDate ?? record.extracted?.expirationDate ?? record.extracted?.dueDate ?? "",
  };
}

export function formatCoiLimit(value: number): string {
  return formatDocumentMoney(value);
}
