import { getDocumentVendor } from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import type { W9TaxIdType } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentModel";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

export interface W9Option {
  value: string;
  label: string;
  description?: string;
}

export interface W9InitialData {
  vendorName: string;
  vendorType: string;
  taxClass: string;
  taxIdType: W9TaxIdType;
  taxId: string;
  contactEmail: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  fileName: string;
}

export const W9_VENDOR_TYPES: readonly W9Option[] = [
  { value: "professional", label: "Professional", description: "Lawyer, doctor, accounting." },
  { value: "subcontractor", label: "Subcontractor", description: "Labor provider requiring insurance." },
  { value: "material", label: "Material", description: "Materials only, no labor." },
  { value: "government", label: "Government", description: "Government agency vendor." },
  { value: "owner", label: "Owner", description: "Owner-related vendor." },
  { value: "employee", label: "Employee", description: "Employee reimbursement vendor." },
  { value: "cleaning", label: "Cleaning Services", description: "Cleaning provider." },
  { value: "misc", label: "Miscellaneous", description: "One-off or uncategorized vendor." },
];

export const W9_TAX_CLASSES: readonly W9Option[] = [
  { value: "individual", label: "Individual / Sole proprietor" },
  { value: "c-corp", label: "C corporation" },
  { value: "s-corp", label: "S corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "trust", label: "Trust / Estate" },
  { value: "llc-c", label: "LLC (C corporation)" },
  { value: "llc-s", label: "LLC (S corporation)" },
  { value: "llc-p", label: "LLC (Partnership)" },
  { value: "professional", label: "Lawyer / Accountant / Medical" },
];

export const W9_US_STATES: readonly W9Option[] = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN",
  "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV",
  "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN",
  "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
].map((state) => ({ value: state, label: state }));

function inferTaxClass(vendorName: string): string {
  const normalized = vendorName.toLowerCase();
  if (normalized.includes("llc")) return "llc-s";
  if (normalized.includes("inc") || normalized.includes("corp")) return "c-corp";
  return "";
}

function inferVendorType(record: Invoice): string {
  const subject = record.email.subject.toLowerCase();
  if (subject.includes("subcontract") || subject.includes("labor")) return "subcontractor";
  if (subject.includes("material") || subject.includes("supply")) return "material";
  return "";
}

function parseAddress(address: string | null | undefined) {
  if (!address) return { addressLine1: "", city: "", state: "GA", zip: "" };
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const tail = parts.at(-1) ?? "";
  const stateZip = tail.match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/);
  return {
    addressLine1: parts[0] ?? "",
    city: parts.length > 2 ? parts[parts.length - 2] : "",
    state: stateZip?.[1] ?? "GA",
    zip: stateZip?.[2] ?? "",
  };
}

export function getInitialW9DocumentData(record: Invoice): W9InitialData {
  const vendorName = getDocumentVendor(record);
  const address = parseAddress(record.extracted?.vendorAddress);
  return {
    vendorName,
    vendorType: inferVendorType(record),
    taxClass: inferTaxClass(vendorName),
    taxIdType: "feid",
    taxId: "",
    contactEmail: record.email.from.includes("@") ? record.email.from : "",
    addressLine1: address.addressLine1,
    city: address.city,
    state: address.state,
    zip: address.zip,
    fileName: record.file,
  };
}
