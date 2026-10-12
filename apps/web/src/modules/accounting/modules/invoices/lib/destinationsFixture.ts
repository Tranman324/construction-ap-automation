import type { DocumentDestinationsConfig } from "@/modules/accounting/modules/invoices/types/api";

// ─────────────────────────────────────────────────────────────────────────────
// TEST FIXTURE ONLY — NOT production data.
//
// This is the single non-test-file location where the former hardcoded
// SharePoint destination catalog literals are permitted to live, and it exists
// solely to seed unit/integration tests (imported only by *.test.* files).
// Production reads the served catalog via `useDocumentDestinations()`
// (GET /api/document-destinations) — there is no runtime fallback to this data.
// ─────────────────────────────────────────────────────────────────────────────

export const SEEDED_DESTINATIONS: DocumentDestinationsConfig = {
  rootLabel: "(Job root)",
  tree: [
    {
      id: "contracts",
      name: "01 Contracts",
      children: [
        { id: "subcontracts", name: "Subcontracts", children: [] },
        { id: "executed-agreements", name: "Executed Agreements", children: [] },
      ],
    },
    {
      id: "financials",
      name: "02 Financials",
      children: [
        { id: "pay-applications", name: "Pay Applications", children: [] },
        { id: "lien-waivers", name: "Lien Waivers", children: [] },
        { id: "retention", name: "Retention", children: [] },
      ],
    },
    {
      id: "insurance",
      name: "03 Insurance & Compliance",
      children: [
        { id: "coi", name: "Certificates of Insurance", children: [] },
        { id: "w9", name: "W-9s", children: [] },
        { id: "safety", name: "Safety Documents", children: [] },
      ],
    },
    {
      id: "closeout",
      name: "04 Closeout",
      children: [
        { id: "warranties", name: "Warranties", children: [] },
        { id: "om-manuals", name: "O&M Manuals", children: [] },
        { id: "as-builts", name: "As-Builts", children: [] },
      ],
    },
    { id: "archive", name: "99 Archive", children: [] },
  ],
  defaults: {
    subcontract: "01 Contracts / Subcontracts",
    warranty: "04 Closeout / Warranties",
    "lien-waiver": "02 Financials / Lien Waivers",
    other: "(Job root)",
  },
};
