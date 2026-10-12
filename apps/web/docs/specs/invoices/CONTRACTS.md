# Invoice Backend Contracts

This document is the Stage 1 contract assembly for invoice/document workers. Implemented backend code is the authority when older prose disagrees with it.

## Stage 4 access and request-boundary contract

### A7 canonical error contract

All non-HEAD failures use `{ error, code?, details? }`. `code` remains the top-level machine-readable discriminator; route metadata belongs in `details`. HTTP HEAD errors have no body. This is an error-only standardization: success payloads, state transitions, and audit behavior are unchanged.

#### A7c amendment — emission boundary

The API enforces the A7 envelope at the response-emission boundary, rather than relying on individual handlers to construct it correctly. Every emitted `>=400` API body is canonicalized; response-method aliases, detached methods, helper-returned bodies, and external emitters are covered by the same boundary. Canonical Express `json` and `send` bodies preserve their exact `{ error, code?, details? }` shape through Express's nested emission chain. A body with no top-level string `error` becomes `{ error: "Request failed", details: <original body> }`, so its original machine-readable fields remain available under `details`; direct non-bodyless `end(body)` is serialized as canonical JSON. Streaming `write()` is blocked before it can emit an error body outside the boundary. In production, each repair logs only the route, status, request ID, and repair reason. The backend test command arms strict mode, which throws on a nonconforming error body instead of repairing it. HEAD/bodyless errors remain bodyless and successful responses are unaffected.

The backend now returns the existing `403 { error: "Forbidden" }` response before processing these route families unless the authenticated caller has the stated existing permission: job lookup/folders, subcontract lookup, feedback writes, user directory/photos, lien-waiver browse/detail, and approval/GL/routing/phase lookup use `accounting.invoices.view_details`; vendor search and classifications/approval schema use `accounting.invoices.view`; pipeline-error operations, vendor-refresh status, and retention reads use `accounting.invoices.manage_settings`; Spectrum COI upload retains `accounting.invoices.submit_spectrum`.

Strict Zod validation rejects unknown or malformed query/path values with `400 { error: "Validation failed", details }` before calling the service. This affects the documented invoice list/stats/trash, jobs, vendor, subcontract, SharePoint-folder, GL-account, pipeline-error, lien-waiver, user/photo, settings, platform-list, feature-request, and split-queue query/path inputs; their successful response shapes do not change, so no frontend API type change is required. Bounded list schemas default to `limit=50`, reject a limit above `200` or a negative offset, and retain an optional invoice-list `offset` so `page` still computes an offset when no explicit offset is supplied. The established classifications request `GET /api/classifications?include=associations&status=all` remains accepted exactly; other status values and unknown keys remain rejected.

The user-approved authenticated zero-permission feature-request self-service endpoints remain an intentional exception: list, create, cast vote, and remove vote do not require a role permission. Deletion still requires `feature_requests.manage`; a PATCH remains author-owned unless it changes status, which also requires `feature_requests.manage`.

## Shared Document Response

`rowToDoc()` is the shared mapper for document list/detail responses. Stage 1 added or confirmed these camelCase fields:

```ts
interface InvoiceDocument {
  id: string;
  classification: string;
  status: string;
  extracted: ExtractedData;
  statementLines: StatementLine[];
  matching: MatchingData;
  filed: boolean;
  filedAt: string | null;
  filedDestination: string | null;
  filingNote: string | null;
  holdReason: string | null;
  spFileUrl: string | null;
  sharePointItemId: string | null;
  sharePointFilename: string | null;
  reconciled: boolean;
  reconciledAt: string | null;
  waiverOnDocument: boolean;
  waiverOnDocumentAt: string | null;
  waiverOnDocumentBy: string | null;
  waiverType: string | null;              // PERSISTED waiver_type only — never inferred from filename/subject
  waiverRequestedAt: string | null;
  waiverRequestedBy: string | null;
  waiverLinkSource: "email-thread" | "request-thread" | "subject-vendor" | "manual" | "suggestion" | null;
  // Explicit lien-waiver workflow state, derived from persisted columns (M-022/23/24).
  // Primarily for lien-waiver documents; well-defined for any row.
  pairingStatus: "paired" | "unpaired";                // paired iff linked_lien_waiver_id is set
  filingStatus: "filed" | "shelved" | "unfiled";       // filed = filed + SharePoint copy; shelved = filed, no SP; unfiled = not filed
  releaseStatus: "released" | "held";                  // released iff sp_file_url set OR status === "submitted"
}
```

`waiverLinkSource` records how the linked waiver was paired. `"email-thread"` means the pipeline auto-linked it from an unambiguous document-email conversation match; `"request-thread"` means it matched the conversation created by the waiver-request email; and `"subject-vendor"` means an unambiguous requested invoice matched the reply's normalized subject plus vendor code after Graph changed the conversation ID. Cleared on unlink.

Extraction note: the pipeline preserves extraction-enabled non-invoice payload fields while queueing. Only fields backed by existing document columns are guaranteed on API reads. Today `rowToDoc()` exposes `projectAddress`, `statementLines`, and statement `statementPeriod`/`balance`; COI `insuredName`/`expirationDate` and statement `vendor` remain processing payload fields.

Statement line note: API document reads normalize missing/null persisted `statement_lines` to an empty `statementLines` array at both the document top level and `extracted.statementLines`. Intermediate extraction payloads may omit `statementLines` when no lines were found; frontend code should coalesce optional extraction payloads with `statementLines ?? []`.

## Extraction And Queueing

Extraction-enabled types and normalized fields:

| Classification | Extracted fields | Notes |
|---|---|---|
| `building-permit` | `projectName`, `projectAddress` | Uses document-visible project data only. |
| `other` | `projectName`, `projectAddress` | Same project extraction path as permits. |
| `receipt` | Existing invoice-like fields plus `jobRef` | Existing receipt/invoice fields are preserved. `jobRef` is found from PO/reference/line/document/subject text and can match `##-###` or `##-SVC###`. |
| `coi` | `insuredName`, `expirationDate` | Used for vendor matching and future Spectrum COI handoff. |
| `statement` | `vendor`, `statementPeriod`, `balance`, optional `statementLines` | `vendor` comes from document-visible statement content only; never from the email sender. `statementPeriod` and `balance` persist under `statement_attributes` and serialize by M-077 precedence. |

Non-invoice extracted payloads are carried into the queued document payload. During DB insert, existing document columns persist the pieces currently backed by schema, including `project_name`, `project_address`, `statement_lines`, and match columns.

## Matching And Persistence

Persisted match columns:

| Match area | Columns |
|---|---|
| Vendor | `vendor_code`, `matched_vendor_name`, `vendor_match_confidence`, `vendor_match_method` |
| Job | `job_match_number`, `job_match_confidence`, `job_match_method` |
| Subcontract | `subcontract_number`, `subcontract_match_confidence`, `subcontract_match_method` |
| Aggregate | `overall_confidence` |

API response shape:

```ts
interface MatchingData {
  vendor: {
    vendorCode: string | null;
    vendorName: string | null;
    confidence: number | null;
    method: string | null;
  } | null;
  job: {
    jobNumber: string | null;
    confidence: number | null;
    method: string | null;
    jobDescription?: string;
  } | null;
  subcontract: {
    subcontractNumber: string;
    confidence: number | null;
    method: string | null;
  } | null;
  overallConfidence: number | null;
}
```

Confidence rules:

| Confidence | Semantics |
|---|---|
| `>= 0.85` | Automatic match. The selected key (`vendorCode`, `jobNumber`, `subcontractNumber`) is populated. |
| `>= 0.70` and `< 0.85` | Suggestion only. Vendor/job selected keys stay `null`; confidence and method are retained, and `method` contains suggestion semantics. |
| `< 0.70` | No match. The API returns `null` for that match object unless a suggestion method was persisted. |

Low-confidence limitation: existing columns do not fully preserve candidate identifiers for suggestion-only rows. The API can expose a candidate vendor name via `matched_vendor_name` and `vendorCode: null`, and a job suggestion with `jobNumber: null` when a suggestion method was persisted. Subcontract suggestions are not surfaced as a `matching.subcontract` object unless `subcontract_number` is populated. Preserving candidate codes for all suggestions would require future additive columns.

The retired review flag is not part of document API responses. Frontend consumers derive attention states from the document status and current validation data instead.

Per-type matching routes through existing matcher helpers:

| Classification | Matching input |
|---|---|
| `receipt` | `extracted.jobRef || extracted.jobNumber` feeds job matching. |
| `building-permit`, `other` | `projectAddress`, `projectName`, email subject, and description feed job matching. |
| `coi` | `insuredName` feeds vendor matching; email is not supplied. |
| `statement` | Document-visible `vendor` feeds vendor matching; email is not supplied. Statement lines match under the selected vendor code. |

## Invoice Navigation And Update

### Panel-group filtering

`GET /api/invoices`, `GET /api/invoices/stats`, and `GET /api/invoices/trash` accept the optional `panel` query parameter. Allowed values are exactly `invoice`, `receipt`, `statement`, `coi`, `w9`, `lien-waiver`, and `other`; invalid values return `400`. The Documents Shelf is covered through `GET /api/invoices?filed=true&panel=...`.

`GET /api/invoices` accepts an optional `flagged` query parameter — `"true"` (only documents with an active review flag, `flagged_at IS NOT NULL`) or `"false"` (only un-flagged); any other value returns `400`. This is the M-092 attention-flag, distinct from the legacy `flagged` ingestion split marker, and composes with the existing `status`/`panel`/`filed`/`search` filters. List rows serialize `flaggedAt`/`flaggedBy`/`flagReason` from DB state so the dashboard table badge reflects the true flag state; the `POST /:id/flag`/`unflag` endpoints and the flag-field definitions are unchanged.

`GET /api/invoices?scope=global&search=<nonblank>` is the dashboard's opt-in text-search contract. It searches all lifecycle statuses, all document types, jobs, filed records, and Trash (including soft-deleted rows), while deliberately ignoring retained `status`, `classification`, `panel`, `filed`, `flagged`, and `splitFrom` filters. This mode returns the standard paginated list shape; each row adds `isTrash: boolean`, the server-authoritative Trash marker. Frontend global-search rows must remain visibly labeled and must not expose active-record mutations for `isTrash === true`. Clearing text restores the preserved URL filters and ordinary list contract.

The effective group comes from `custom_classifications.opens_as` first, including built-in overrides and custom mappings. Canonical associations map directly; legacy associations outside the seven public groups, including `subcontract` and `warranty`, normalize to `other`. When no association override exists, built-ins map as follows:

| Effective panel | Classifications |
|---|---|
| `invoice` | `invoice`, `pay-application`, `purchase-order`, `credit-memo` |
| `receipt`, `statement`, `coi`, `w9`, `lien-waiver` | Same-name classification |
| `other` | `other`, `building-permit`, and all unknown classifications |

The existing `classification` parameter remains an exact classification filter. When `classification` and `panel` are both supplied, both constraints apply. On the stats endpoint, status counts, amounts, `trashTotal`, `shelfTotal`, `globalTotal`, and `total` are scoped to `panel`. Invoice list/trash queries are strict; unknown keys and invalid/out-of-range values fail before their handlers. The known legacy lifecycle and dashboard sort values remain accepted for existing deep links.

For every invoice-list `sort` value, the backend appends `id` using the same direction as the requested primary sort. Tied primary values therefore remain stable across offset pages.

### `GET /api/invoices/:id/neighbors`

Requires `accounting.invoices.view`. Server-computed keyset previous/next for the detail-panel Previous/Next arrows and post-action auto-advance. It accepts the SAME filter and ordering parameters as `GET /api/invoices` **minus pagination** (`page`/`limit`/`offset` are rejected by the strict schema): `status`, `search`, `classification`, `panel`, `filed`, `flagged`, `splitFrom`, `sort`, `sortDir`.

```ts
interface InvoiceNeighborsResponse {
  prev: string | null;     // id of the row immediately before the anchor, or null at the head
  next: string | null;     // id of the row immediately after the anchor, or null at the tail
  position: number | null; // anchor's 1-based rank in the filtered order ("N"); null when out of set
  total: number;           // count of rows matching the filter ("M")
}
```

- **Ordering guarantee.** Neighbors are computed against the EXACT order `GET /api/invoices` produces for the same params — same sort column, same direction, PostgreSQL default NULL positioning (`ASC` → NULLS LAST, `DESC` → NULLS FIRST), same `id` tie-breaker (both built from the shared `buildInvoiceListFilter` WHERE and `getInvoiceOrder` ORDER BY). Walking `next` from the first list row reproduces the list order exactly.
- **`position` / `total` (N of M).** `total` is the count of rows matching the filter WHERE. `position` is the anchor's 1-based rank — the count of rows ordering strictly before the anchor + 1, computed with the SAME keyset comparison as `prev`/`next`, so `position` can never disagree with them (walking `next` yields `position` `1, 2, …, total`). For an in-set anchor, `position` equals its list index + 1.
- **Anchor-out-of-set (load-bearing).** The anchor is fetched by `:id` regardless of whether it still matches the filter; `prev`/`next` are the matching rows immediately before/after the anchor's sort position. After an action moves a document out of the active filter (e.g. approving while viewing `status=pending`), `next` still resolves to the next matching document after the now-excluded anchor's position — this powers auto-advance without the frontend re-deriving neighbors. In that case `position` is `null` (the anchor has no rank in the set) while `total` still reflects the filter count.
- `404` when the anchor id does not exist (hard-deleted or unknown). Returns ids plus the position counter; fetch full rows via `GET /api/invoices/:id`. No pagination.

### `PATCH /api/invoices/:id`

Requires `accounting.invoices.view_details`. Request fields use the frontend camelCase document convention, including `glDate`:

```ts
interface InvoiceUpdateRequest {
  glDate?: string | null;
  waiverType?: string | null;
  // Other editable document fields remain optional.
}
```

The backend maps `glDate` to the persisted `documents.gl_date` column. A cleared date (`""`) is normalized to `null`. Document responses map `gl_date` back to `glDate` as `YYYY-MM-DD` or `null`.

`linkedLienWaiverId` is not an editable field on this generic endpoint. The
strict schema rejects it; callers must use the dedicated link/unlink endpoints
so reciprocal locking, classification checks, shelf state, and audits cannot be
bypassed.
Changing `classification` while the document remains linked returns
`409 { code: "WAIVER_LINKED_CLASSIFICATION_PROTECTED" }`; the dedicated
reclassify endpoint applies the same locked refusal.

This differs intentionally from Spectrum submission overrides, whose wire shape follows the existing snake_case convention and uses `overrides[id].gl_date`.

`waiverType` persists the lien-waiver document panel selection. Supported frontend values are `Conditional progress waiver`, `Unconditional progress waiver`, `Conditional final waiver`, and `Unconditional final waiver`.

**Amount semantics (waived amount = `amount`):** `amount` accepts a number, a numeric string, or `null`. `null` clears the persisted amount; a valid number/numeric string persists as-is. A non-numeric string / NaN / non-finite value is REJECTED with `422 { error, code: "INVALID_AMOUNT" }` and the row is unchanged — the backend never coerces or silently drops an invalid amount (validated at the service before the write, inside the locked edit transaction).

When a statement's `vendorCode` changes, the same response additionally contains `{ statementLines, statusChanges }`. Both are server-authoritative: `statementLines` is the complete post-save array and `statusChanges` contains each `[oldStatus, newStatus]` transition produced by that vendor-scoped rematch. A cleared or absent vendor returns the canonical invoice with unchanged lines and `statusChanges: []`; clients must not infer or synthesize transitions.

## Statement Attribute Sources

Statement document reads expose resolved values at `invoice.extracted.statementPeriod` and `invoice.extracted.balance`, with source metadata at:

```ts
type StatementAttributeSource = "manual" | "extracted" | "computed" | null;

invoice.statementAttributes = {
  statementPeriod: { value: string | null, source: StatementAttributeSource },
  balance: { value: number | null, source: StatementAttributeSource },
};
```

M-077 is canonical: a non-null manual value wins, otherwise extracted wins, otherwise computed wins. A null-clear removes only the manual slot and exposes the next source. Legacy reads are pure and write-free; `documents.amount` is never a statement-balance source.

Filing-related document values are server-owned and returned under `filing`. One resolver applies `manual → extracted → matching → email` precedence and includes provenance for `vendor`, `job`, and `scope`; `fileName` is the computed current candidate. Warranty documents also return `providerKind` and `warrantyType` envelopes. These are live computations unless `documents.warranty_manual_values` contains an intact `{ value, setBy, setAt }` manual entry; manual values win with `provenance: "manual"` and remain untouched by source/rematch changes. Reads are write-free and a cleared entry reveals the current computation. The same resolved values feed filename generation and SharePoint metadata, while persisted `sharePointFilename` remains historical provenance and is never regenerated.

## Statement Lines

Persisted JSONB column: `documents.statement_lines`.

```ts
type StatementLineStatus =
  | "matched"
  | "in_toolbox_not_spectrum"
  | "not_received"
  | "amount_differs";

type StatementLineSource = "extracted" | "manual";

interface StatementLine {
  id: string;
  invoiceNumber: string;
  date: string | null;
  amount: number;
  status: StatementLineStatus;
  source: StatementLineSource;
  clear: boolean; // server-derived: matched, Toolbox-only, or explicitly resolved
}

interface StatementReconcileState {
  blockers: Array<{ code: "STATEMENT_LINE_UNRESOLVED"; lineId: string; message: string }>;
  counts: { total: number; clear: number; unresolved: number };
  canReconcile: boolean;
  permittedActions: Array<"reconcile">;
}
```

Statement extraction stores one line per parent invoice/reference. Detail `subItems` roll up into the parent amount and remain extraction evidence only; they are not stored as separate `statement_lines` entries.

`StatementLine.id` is an operation handle for UI updates and manual-line endpoints, not a durable business key. Use `invoiceNumber` plus date/amount context for display and reconciliation identity.

Statement documents expose the same array in two API locations:

```ts
invoice.statementLines;
invoice.extracted.statementLines;
invoice.reconcile; // StatementReconcileState
```

If a statement has no persisted lines, document reads return `[]`. Intermediate extraction output may omit the key entirely when no lines were extracted, so consumers outside the document-read API should use `statementLines ?? []`.

`clear`, `reconcile.blockers`, `reconcile.counts`, and `reconcile.canReconcile` are computed by the same backend predicate used by `POST /api/invoices/:id/reconcile`. An empty statement has the `statement-lines-empty` blocker. `permittedActions` is caller-aware: it includes `"reconcile"` only when the statement is not already fully reconciled/shelved, all lines are clear, and the caller has `accounting.invoices.approve`. Detail and every successful statement-line mutation return this canonical state; the top-level `statementLines` response sibling remains compatibility-only and agrees with `invoice.statementLines`.

`PATCH /api/invoices/:id/statement-attributes` requires `accounting.invoices.approve` and accepts a strict, nonempty subset of `{ statementPeriod: string | null, balance: finite number | numeric string | null }`. It returns `{ invoice }` with the canonical `invoice.statementAttributes`. Non-null values become manual values; `null` clears only that manual attribute and reveals the next M-077 source. Empty, unknown, empty-string, and non-finite inputs return `422` with no write. The mutation locks the current `statement_attributes` JSONB object and commits the complete replacement with `document.statement_attributes_updated`; it never changes `documents.amount`.

`PATCH /api/invoices/:id/warranty-classification` requires `accounting.invoices.approve` and accepts a strict, nonempty subset of `{ providerKind: string | null, warrantyType: string | null }`. Empty, unknown, empty-string, and non-string inputs return `422` with no write. Non-null values become attributed manual values; `null` clears only that manual slot and reveals the live computed warranty classification. The mutation locks the current `warranty_manual_values` JSONB object, commits the complete replacement with `document.warranty_classification_updated`, preserves unrelated manual slots, and never changes `documents.classification`. Successful responses return `{ invoice }` with canonical `invoice.filing.providerKind` and `invoice.filing.warrantyType`.

Manual line matching remains injectable/local for tests and offline use. Current production lookup behavior:

- Toolbox lookup is scoped by `invoiceNumber`, `vendorCode`, and the statement document id.
- Spectrum lookup is currently injectable and defaults to `null` locally.
- Matching statuses are `matched`, `in_toolbox_not_spectrum`, `not_received`, or `amount_differs`.
- Explicit user resolutions persist on a line as optional `resolvedAt`, `resolutionType` (`accept_line` or `use_ap_amount`), and `resolvedBy` fields.

## Statement Line Endpoint

### `POST /api/invoices/:id/statement-lines`

Requires `accounting.invoices.approve`.

Request body is strict:

```ts
interface AddStatementLineRequest {
  invoiceNumber: string;
  date: string | null; // null or YYYY-MM-DD
  amount: number | string; // numeric strings are accepted and coerced
}
```

Response:

```ts
interface AddStatementLineResponse {
  invoice: InvoiceDocument;
  statementLines: StatementLine[];
  addedLine: StatementLine & { source: "manual" };
}
```

Side effects:

- Appends one non-colliding `source: "manual"` line.
- Re-runs statement-line matching for the new line.
- Persists the full `statement_lines` array.
- Emits audit event `document.statement_line_added` with `target.type = "document"`.
- Also writes legacy `audit_log` action `statement-line-added`.

### `PATCH /api/invoices/:id/statement-lines/:lineId`

Requires `accounting.invoices.approve`.

Request body is strict and must include at least one editable field:

```ts
interface UpdateStatementLineRequest {
  invoiceNumber?: string; // 1-100 chars
  date?: string | null; // null or YYYY-MM-DD
  amount?: number | string; // numeric strings are accepted and coerced
}
```

`id` and `status` are not editable. The line id is stable after edits.

Response:

```ts
interface UpdateStatementLineResponse {
  invoice: InvoiceDocument;
  statementLines: StatementLine[];
  updatedLine: StatementLine;
}
```

Side effects:

- Re-runs statement-line matching after the edit; `updatedLine.status` and sibling line statuses may change.
- Persists the full `statement_lines` array.
- Consumers must replace local rows from `statementLines` in the response.
- Protected lines with status `matched` or `in_toolbox_not_spectrum` return `409 { code: "LINE_STATUS_PROTECTED" }` until unmatched.

### `DELETE /api/invoices/:id/statement-lines/:lineId`

Requires `accounting.invoices.approve`.

Response:

```ts
interface DeleteStatementLineResponse {
  invoice: InvoiceDocument;
  statementLines: StatementLine[];
  removedLine: StatementLine;
}
```

Side effects:

- Removes one statement line and persists the full `statement_lines` array.
- Consumers must replace local rows from `statementLines` in the response.
- Protected lines with status `matched` or `in_toolbox_not_spectrum` return `409 { code: "LINE_STATUS_PROTECTED" }` until unmatched.

### `POST /api/invoices/:id/statement-lines/rematch`

Requires `accounting.invoices.approve`.

Response:

```ts
interface RematchStatementLinesResponse {
  invoice: InvoiceDocument;
  statementLines: StatementLine[];
  statusChanges: Array<{
    lineId: string;
    invoiceNumber: string;
    status: [StatementLineStatus, StatementLineStatus]; // [old, new]
  }>;
}
```

Side effects:

- Re-checks all statement lines against Toolbox and Spectrum under the statement vendor.
- A missing or whitespace-only statement vendor is refused after the locked read with `422 { code: "STATEMENT_VENDOR_REQUIRED" }`; it performs no lookup, JSONB write, or audit.
- Persists refreshed statuses in the full `statement_lines` array.
- Returns an empty `statusChanges` array when statuses are already current.
- Foreign-vendor lookup records are not evidence that a confirmed match should be cleared.
- Consumers must replace local rows from `statementLines` in the response.

### `POST /api/invoices/:id/statement-lines/:lineId/resolve`

Requires `accounting.invoices.approve`. The strict request body is `{ resolutionType: "accept_line" | "use_ap_amount" }`; `accept_line` applies to `not_received` lines and `use_ap_amount` applies to `amount_differs` lines.

The response is `{ invoice, statementLines, updatedLine }`. It persists `resolvedAt`, `resolutionType`, and `resolvedBy` in `statement_lines` and emits `document.statement_line_resolved`. Consumers must replace local rows from the returned array.

### `POST /api/invoices/:id/statement-lines/:lineId/unresolve`

Requires `accounting.invoices.approve`. No body. Clears persisted resolution metadata and returns `{ invoice, statementLines, updatedLine }`. Emits `document.statement_line_unresolved`.

## Permissions And Migration Columns

Invoice permissions dual-accept legacy and accounting namespaces:

- A requested `accounting.invoices.X` accepts either `accounting.invoices.X` or legacy `invoices.X`.
- A requested `invoices.X` accepts either `invoices.X` or `accounting.invoices.X`.
- Non-invoice namespaces remain exact-match only.
- `requireAnyPermission()` uses the same alias behavior for each candidate.

Additive migration `apps/api/migrations/2026-07-02_document_statement_waiver_columns.sql` adds:

| Column | Type | Purpose |
|---|---|---|
| `sharepoint_item_id` | `TEXT` | Graph drive item id for the filed SharePoint copy. |
| `sharepoint_filename` | `TEXT` | Final uploaded SharePoint filename. |
| `statement_lines` | `JSONB` | Statement line review/reconciliation data. |
| `waiver_on_document` | `BOOLEAN NOT NULL DEFAULT false` | Document-level waiver override flag. |
| `waiver_on_document_at` | `TIMESTAMPTZ` | Override timestamp. |
| `waiver_on_document_by` | `TEXT` | Actor who set the override. |

UNVERIFIED: live migration application. Local validation is static only; Server-side gate applies the migration.

## Filing And SharePoint

### `POST /api/invoices/:id/file`

Requires `accounting.invoices.approve`.

Request body:

```ts
interface FileDocumentRequest {
  destination?: string;
  destinationAbsolute?: string;
  filename?: string;
  note?: string;
  holdReason?: string;
  uploadToSharePoint?: boolean;
}
```

Response:

```ts
interface FileDocumentResponse {
  invoice: InvoiceDocument;
  action?: {
    actionId: string | null;
    type: "file";
    undoable: boolean;
    undoEndpoint?: string;
  };
  sharePoint?: {
    uploaded: boolean;
    webUrl?: string;
    itemId?: string;
    filename?: string;
    warning?: string;
    error?: string;
  };
}
```

Filename rules:

- Every invoice includes `filing.fileName: { value, provenance: "computed", permittedActions: ["edit"], blockers: [] }`, the server-generated pre-collision suggestion. The frontend may edit it for this filing attempt.
- `filename` is an optional user override (≤128 characters) for the SharePoint copy. The server sanitizes it, preserves the source extension, resolves collisions during upload, and never renames the local source file. It traverses both direct-destination and job-folder upload paths.
- Successful filing replaces the exact `invoice` query cache from the response envelope and only marks invoice collections stale. `403`/`409`/`422` refusals preserve prior cache/form state and surface the literal server message in the panel; stale-preview recovery is not part of this contract.
- Omitted confirmation still uses the server-generated `{Type} {Vendor} {MM-DD-YY} {Ref}.{ext}` candidate.
- Invoice candidates retain the established `INV` prefix. Non-invoice candidates use their human-readable classification label, with `Document` as the fallback.
- Vendor is sanitized and truncated to 15 characters at a word boundary.
- References longer than 10 characters are dropped.
- SharePoint-illegal characters are stripped from generated pieces. Short hash refs such as `#2` are intentionally preserved for the accepted example.
- Collisions append ` (2)`, ` (3)`, etc. while keeping the base within 40 characters.
- The backend pure candidate helper consumes `test-fixtures/invoices/filename-golden-vectors.json` and reproduces the browser candidate byte-for-byte before any upload-time collision suffix; collision resolution remains a filing-boundary concern.

Examples:

- `INV Halden Brooks 06-15-26 #2.pdf`
- `RCT Home Depot 06-15-26 8841.pdf`
- `PMT Harbor View 06-15-26.pdf`

SharePoint behavior:

- An explicit `destinationAbsolute: ""` selects Projects drive root, bypasses matched-job lookup, and overrides `destination` or a previously stored folder. Omitted/null absolute paths retain job-relative routing. Explicit-root success persists `filed_destination = ""`; canonical `invoice.filedDestination` and filing undo snapshots preserve the empty string instead of falling back to a stale folder or null. A root upload still requires a local source file; upload failure follows the unchanged-document contract below.
- Successful uploads persist `sp_file_url`, `sharepoint_item_id`, and the actual uploaded `sharepoint_filename` (including any collision suffix); historical filenames are never regenerated.
- API exposes those as `spFileUrl`, `sharePointItemId`, and `sharePointFilename`.
- Metadata stamping uses Graph item ids and is best-effort.
- An explicit upload failure, including missing source/job prerequisites, leaves the complete locked document unchanged. HTTP 200 returns the canonical `invoice` plus `sharePoint: { uploaded: false, error }`, with no `action`. An unfiled record remains unfiled after reload/remount and can retry; a previously shelved record keeps its prior state and metadata. The client must not treat the HTTP 200 alone as filing success or create a success undo record. Local-only shelving is unchanged.
- Metadata stamping failure does not block upload/local filing; response includes `sharePoint.warning`.
- Statement documents skip the SharePoint upload path from this endpoint.
- Filing holds one document lock through the optional upload, recheck, and local update. A concurrent filing request waits; if the first request files the document, the waiting request returns `409 { code: "ALREADY_FILED" }` without creating another copy. If a guarded recheck follows a newly-created SharePoint item, it best-effort deletes only that new item. A failed cleanup preserves the guarded `409` and returns `sharePoint: { uploaded: true, itemId, warning }` for operator follow-up; it does not change local state.
- Successful filing emits `invoice.filed` and legacy `filed`, with the existing actor and undo snapshots. Failed uploads emit neither success audit and return no undo action; existing upload-failure logging remains in place.

Post-upload metadata fields:

```ts
interface SharePointMetadataFields {
  DocType: string;
  JobNumber: string | null;
  Vendor: string | null;
  DocDate: string | null;
  Amount: number | null;
  SourceEmail: string | null;
  ToolboxId: string | null;
}
```

UNVERIFIED: live SharePoint upload, live metadata fields, and collision behavior against real Graph.

### `GET /api/jobs/sharepoint/folders`

Authenticated through the `/api/jobs` route mount. Lazy-browses one SharePoint drive-relative folder for the document panel DestinationPicker.

Query params:

```ts
interface SharePointFolderBrowseQuery {
  path?: string; // empty or omitted = Projects drive root
}
```

Response:

```ts
interface SharePointFolderBrowseResponse {
  path: string;
  folders: Array<{ id: string; name: string; hasChildren: null }>;
  files: Array<{ id: string; name: string; webUrl: string | null }>;
}
```

Folder rows are navigable/selectable destinations. File rows are display-only/openable context for the current folder.

### Sidecar-first job folder resolution

Implementation uses `DATA_DIR/job_sharepoint_folders.json`.

- 15-minute in-memory cache is checked first.
- Sidecar hit skips live Graph lookup.
- Sidecar miss with live Graph success writes `source: "runtime-miss"`.
- Stale 404/not-found while listing a stored folder refreshes through live Graph and rewrites with `source: "runtime-refresh"`.
- Missing sidecar falls back to the live path without noisy failure.
- No `apps/api/data/` sidecars are committed.

UNVERIFIED: live server sidecar contents and live Graph refresh behavior.

## Undo And Waiver Override

### `POST /api/invoices/:id/link-waiver`

Requires `accounting.invoices.approve`.

```ts
interface LinkLienWaiverRequest {
  waiverId: string;
}
```

Response: `{ success: true, invoiceId, waiverId, linkedAt }`.

The server assigns `source: "manual"`, creates both sides of the link, and
shelves the lien-waiver document in the same transaction. Shelving sets
`filed = true` while preserving an existing `filed_at`, removing the waiver
from active queue queries and making it available through the document shelf;
it does not rewrite the document's workflow `status`.
Pipeline auto-links use the same transition. Unlinking clears this shelf state
so an unpaired waiver returns to the active queue.
When the linked invoice is submitted to Spectrum, the waiver's discard
transition clears the shelf state so it is available in Trash.
Historical already-linked waivers in a protected terminal status retain that
status and their shelf state; the link endpoint rejects new links to those
statuses.

The invoice and selected target are read under a stable row lock and must not be soft-deleted. Missing or soft-deleted invoice/target returns `404`; an existing target that is not currently classified as `lien-waiver` returns `422 { code: "WAIVER_CLASSIFICATION_MISMATCH" }`. A document cannot link to itself (`422 { code: "WAIVER_SAME_DOCUMENT" }`). These validation failures do not create links or audit events.
Parents already `submitted`, `submitting`, `split-processing`, or `discarded`
are rejected with `409 { code: "WAIVER_PARENT_STATUS_PROTECTED" }` before any
link, shelf, or audit write.
Waivers in those same statuses are rejected with
`409 { code: "WAIVER_STATUS_PROTECTED" }` before any link, shelf, or audit
write. The invoice orphan-waiver list excludes those statuses so the UI does
not offer a waiver the link endpoint will refuse.

The frontend uses the target invoice's exact `status` as the client-side gate
for linkage controls. When that status is `approved`, link and unlink controls
remain visible but disabled with `Approved invoices are locked — unapprove first
to change waiver linkage.` A stale link or unlink refusal with HTTP `409` and
`code: "WAIVER_PARENT_STATUS_PROTECTED"` is shown as a toast using the server
message verbatim; other linkage errors retain their existing inline/fallback
handling.

### `POST /api/invoices/:id/actions/:actionId/undo`

Requires `accounting.invoices.approve`.

Only `invoice.filed` footer undo has a 300-second TTL. Expired file undo returns `410`:

```ts
interface UndoWindowExpiredResponse {
  error: string;
  code: "UNDO_WINDOW_EXPIRED";
  details: {
    actionId: string;
    undoWindowSeconds: 300;
    expiresAt?: string;
  };
}
```

Other undo failure bodies are explicit:

```ts
type UndoActionErrorCode =
  | "ACTION_NOT_FOUND"
  | "ALREADY_UNDONE"
  | "ACTION_NOT_UNDOABLE"
  | "STATE_CHANGED_SINCE_ACTION";

interface UndoActionErrorResponse {
  error: string;
  code: UndoActionErrorCode;
  details?: {
    actionId?: string;
    staleFields?: string[];
  };
}
```

Statuses: missing invoice returns `404` with `{ error }`; missing action returns `404 ACTION_NOT_FOUND`; already-undone, non-undoable, and stale-state failures return `409`; expired file undo returns `410 UNDO_WINDOW_EXPIRED`.

Successful file undo response:

```ts
interface UndoActionResponse {
  invoice: InvoiceDocument;
  undoneActionId: string;
  sharePoint?: {
    deleted: boolean;
    itemId: string;
    driveId: string;
    warning?: string;
  };
}
```

Side effects:

- Restores local filing metadata from audit `beforeState`.
- Deletes the filed SharePoint copy by `sharepoint_item_id` using `deleteDriveItem(driveId, itemId)`.
- SharePoint delete is best-effort and warning-based; local rollback still commits.
- Emits `invoice.file_undo` for file undo.

### Invoice detail waiver-action authority

`GET /api/invoices/:id` and every successful waiver override/bypass mutation response include the caller-aware `invoice.waiverActions` envelope:

```ts
interface WaiverActionCapability {
  permitted: boolean;
  blockers: Array<{ code: string; message: string }>;
}

interface WaiverActionState {
  request: WaiverActionCapability;
  resend: WaiverActionCapability;
  markOnDocument: WaiverActionCapability;
  clearOnDocument: WaiverActionCapability;
  bypass: WaiverActionCapability;
  revertBypass: WaiverActionCapability;
  bypassHint: { count: number; show: boolean };
}
```

The server derives these decisions from the persisted document state and the current caller's `request_waiver`/`approve` permissions. UI controls consume this envelope rather than checking roles or recomputing action eligibility. Each write endpoint remains independently permission-gated and validates state again under its own transaction.
The server-provided `bypassHint` count records vendor bypass history since the last attached waiver; clients render the hint only when `show` is true. The hint is informational and does not affect Bypass eligibility or execution.

### `POST /api/invoices/:id/waiver-override`

Requires `accounting.invoices.approve`.

No request body.

Response:

```ts
interface WaiverOverrideResponse {
  invoice: InvoiceDocument;
  action?: {
    actionId: string | null;
    type: "waiver_override";
    undoable: boolean;
    undoEndpoint?: string;
  };
  waiverOverride: {
    active: boolean;
    at: string | null;
    by: string | null;
  };
}
```

Sets `waiver_on_document = true`, `waiver_on_document_at = NOW()`, and `waiver_on_document_by = actor`. Emits `document.waiver_override_set` with `target.type = "document"` and legacy action `waiver-override-set`.

Approval validation treats `waiver_on_document = true` as satisfying `lien_waiver_required` when no linked waiver exists.

### `POST /api/invoices/:id/waiver-bypass`

Requires `accounting.invoices.approve`. No request body.

Records that no lien waiver is required by setting only `lien_waiver_required = false`; it never changes `lien_waiver_status`, the link, or the Attached (`waiver_on_document`) override. The response is `{ invoice, action? }`, where `action.type` is `"waiver_bypass"` and its undo endpoint is `/api/invoices/:id/waiver-bypass/revert`. The mutation emits `document.waiver_bypass_set` and legacy action `waiver-bypass-set` with the actor and before/after state.

### `POST /api/invoices/:id/waiver-bypass/revert`

Requires `accounting.invoices.approve`. No request body.

Restores the requirement by setting only `lien_waiver_required = true`. The response is `{ invoice, action? }`, with `action.type` `"waiver_bypass_revert"` and undo endpoint `/api/invoices/:id/waiver-bypass`. It emits `document.waiver_bypass_reverted` and legacy action `waiver-bypass-reverted` with actor and before/after state. The waiver marker is shown exactly when `lien_waiver_required IS TRUE AND linked_lien_waiver_id IS NULL AND lien_waiver_status IS DISTINCT FROM 'attached' AND waiver_on_document IS NOT TRUE`; this is the Boolean inverse of the submit gate.

### `GET /api/invoices/:id/waiver-recipient`

Requires `accounting.invoices.request_waiver`. Resolves whether the original sender is a direct vendor address or needs confirmation because it is an internal forward or billing platform.

```ts
interface WaiverRecipientResponse {
  recipientType: "direct" | "parsed" | "manual";
  directEmail: string | null;
  candidates: Array<{
    email: string;
    source: "body" | "forwarded_header" | "vendor_record" | "sender";
  }>;
  cachedVendorEmail: string | null;
  emailFrom: string | null;
  reason: string;
  directoryContacts: WaiverDirectoryContact[];
}

interface WaiverDirectoryContact {
  email: string;
  name: string | null;
  source: "observed" | "confirmed_send" | "manual";
  lastSeenAt: string | null;
}
```

Direct external senders return `direct`. Internal and known billing-platform senders return `parsed` when a body, forwarded-header, or cached vendor address exists; otherwise they return `manual`.

`directoryContacts` is the server-ordered vendor contact directory. The UI displays source labels exactly as `confirmed send`, `manual`, and `seen`; an empty array is valid and does not suppress Add Contact for callers with `accounting.invoices.request_waiver`.

### `POST /api/invoices/:id/waiver-contacts`

Requires `accounting.invoices.request_waiver`. Accepts `{ email: string; name?: string }`; blank names are omitted. The response is authoritative and replaces the visible directory and the cached `waiver-recipient` response.

```ts
interface AddWaiverContactResponse {
  success: true;
  directoryContacts: WaiverDirectoryContact[];
}
```

The caller selects the normalized newly returned contact locally. This mutation never sends a waiver request; only the final confirmation Send invokes `POST /api/invoices/:id/request-waiver`.

### `POST /api/invoices/:id/request-waiver`

Requires `accounting.invoices.request_waiver`. Optional body: `{ resend?: boolean; recipientOverride?: string }`.

Replies on the source invoice email thread (subject `RE: {original subject, RE:/FW: chains stripped} — Lien Waiver Request`) and persists `waiverRequestedAt` and `waiverRequestedBy` on the document response. Emits `invoice.waiver_requested` and legacy action `waiver-requested`.

```ts
interface RequestWaiverResponse {
  success: true;
  sentTo: string;
  requestedAt: string;
  invoice: Invoice;
}
```

Missing documents return `404`. Documents without a source email and classifications outside `invoice` or `pay-application` return `422`. A second request returns `409` unless `resend: true` is passed — the “Resend Request” button must send it explicitly.

When the source sender is internal or belongs to QuickBooks, Siteline, Zoho Books, Versapay, Amazon, Trimble, TermSync, or ServiceTrade, `recipientOverride` is required. Overrides must be valid external email addresses and cannot use internal or billing-platform domains. The Graph reply draft's `toRecipients` is replaced with the confirmed override, `sentTo` and `originalEmailFrom` are audited, and the successful direct or overridden recipient updates `vendor_mappings.vendor_email` for every existing row with the same `vendor_code`.

### `POST /api/invoices/:id/attach-file`

Requires `accounting.invoices.view_details`. Accepts `multipart/form-data` with one `file` field (PDF or image, maximum 25 MB) for pending/modified `no-attachment`, `error`, or `unsupported` documents that do not already have a file.

### Inbound attachment review and promotion

The activity feed may expose an inbound email with `hasAttachments: true` and
`attachmentReviewed: false`. Review is read-only: attachment bytes never enter
the normal pipeline automatically. The authenticated caller may list safe file
attachment metadata with `GET /api/documents/:id/inbound-attachments`, then
preview or download one attachment through its `attachmentId`. Item
attachments are excluded. Preview uses an inline disposition only for PDF and
common image types; other content is forced to download and carries browser
sniffing/sandbox protections.

`POST /api/documents/:id/inbound-attachments/:attachmentId/promote` requires
`accounting.invoices.view_details`, accepts an empty body, and explicitly runs
the selected attachment through normal classification/extraction/matching as a
new document. The response is `201` with
`{ promoted, duplicate, documentId, sourceDocumentId, sourceEmailMessageId }`.
The source document, source file, and inbound body are never replaced; the new
document retains source document, inbound message-row, and attachment
provenance. A durable source-message/attachment guard makes retries and
concurrent requests return one resulting document. Ambiguous, unmatched, and
NDR messages are held or rejected; automatic replies are dropped by inbound
diversion. Missing mailbox content returns `410` with
`INBOUND_SOURCE_UNAVAILABLE` (or the specific unavailable attachment code),
and a forged/non-file attachment id returns `404`.

```ts
interface AttachFileResponse {
  success: true;
  documentId: string;
  classification: string;
  flagged: boolean;
  notes: string | null;
  emailAttached: boolean;
  extracted: Record<string, unknown> | null;
  matching: {
    vendorCode: string | null;
    jobNumber: string | null;
    subcontractNumber: string | null;
    overallConfidence: number | null;
    isMultiJob: boolean;
  } | null;
}
```

The synchronous response arrives after storage, classification, extraction, matching, and in-place document update. Appending the uploaded file to the source email is best-effort; `emailAttached: false` is not a request failure. Errors use `{ error: string }`: `400` malformed upload, `404` missing document, `409` existing file, `413` oversized file, `422` ineligible/rejected file, or `500` processing failure.

### `POST /api/invoices/:id/waiver-override/revert`

Requires `accounting.invoices.approve`.

No request body. Clears `waiver_on_document`, `waiver_on_document_at`, and `waiver_on_document_by`. Emits `document.waiver_override_reverted` and legacy action `waiver-override-reverted`. Reverting restores the missing `linked_lien_waiver_id` approval validation failure when no linked waiver exists.

## Statement Reconcile And Split Confirm

### `POST /api/invoices/:id/reconcile`

Requires `accounting.invoices.approve`. No body.

Response: `{ invoice, action? }`.

Both a successful mutation and an idempotent no-op return the same canonical post-state `invoice` envelope. For statement documents, `invoice.statementLines[].clear` and `invoice.reconcile` are present; `action` is supplied only when a new undoable audit action was emitted.

General documents set `reconciled = true`, `reconciled_at = NOW()`. Statement documents first require at least one line and require every line to be matched/in Toolbox or explicitly resolved; otherwise they return `409 { code: "STATEMENT_LINES_UNRESOLVED", unresolvedLineIds }`. Successful statement reconciliation also shelves locally with `filed = true`, `filed_at = NOW()`. Statement reconcile does not call SharePoint upload, rename, metadata, or delete paths.

Audit event: `invoice.reconciled`. The action undo endpoint points to `POST /api/invoices/:id/unreconcile`.

### `POST /api/invoices/:id/unreconcile`

Requires `accounting.invoices.approve`. No body.

Response: `{ invoice, action? }`.

Both a successful mutation and an idempotent no-op return the same canonical post-state `invoice` envelope. For statement documents, `invoice.statementLines[].clear` and `invoice.reconcile` are present; `action` is supplied only when a new undoable audit action was emitted.

Uses undo-safety state checks. For statement documents, restores `reconciled`, `reconciled_at`, `filed`, and `filed_at` from the reconcile audit before-state. Audit event: `invoice.unreconciled`.

### `POST /api/invoices/:id/flag`

Requires `accounting.invoices.view_details`. Flags a document for review ("needs attention"). Workflow-neutral: never changes status, never affects approve/submit/file eligibility.

Request body (optional): `{ reason?: string }` — `reason` trimmed, max 500 chars. Unknown keys rejected with `400 { error: "Validation failed", details }`.

Response `200`: `{ invoice: InvoiceDocument, auditId: string | null }`.

The `InvoiceDocument` gains three fields for this flag (distinct from the legacy `flagged: boolean` split marker):

```ts
flaggedAt: string | null;   // ISO timestamp; flag state is flaggedAt !== null
flaggedBy: string | null;   // acting user's email
flagReason: string | null;
```

Persists `flagged_at = NOW()`, `flagged_by = <acting user>`, `flag_reason`. Audit event: `invoice.flagged` (undoable).

### `POST /api/invoices/:id/unflag`

Requires `accounting.invoices.view_details`. No body. Removes a document's review flag.

**Service-level authorization runs before the no-op check:** only the original flagger (`flaggedBy` equals the acting user) or a holder of `accounting.invoices.manage_rules` may unflag. Any other caller receives `403 { error, code: "FLAG_UNFLAG_FORBIDDEN" }` and the row is unchanged, including when the document is already unflagged. An already-unflagged document is a no-op success only for an authorized original flagger or `manage_rules` holder.

Response `200`: `{ invoice: InvoiceDocument }` with `flaggedAt`, `flaggedBy`, `flagReason` cleared to `null`. Audit event: `invoice.unflagged` (undoable).

### `POST /api/splits/:id/confirm`

Requires `accounting.invoices.manage_splits`.

Request body is strict:

```ts
interface SplitConfirmGroup {
  pages: number[];
  docType?: string; // kebab-case active classification name
  displayName?: string;
}

interface ConfirmSplitRequest {
  groups: SplitConfirmGroup[];
  discardPages?: number[];
}
```

`docType` is validated against active classification names from the merged built-in/custom classification list used by `/api/classifications`. Disabled names are rejected.

Response status: `202 Accepted`.

```ts
interface ConfirmSplitResponse {
  parentId: string;
  childIds: string[];
  backupChildId: string | null;
  discardedPages: number[];
  status: "processing";
  message: string;
}
```

Side effects and invariants:

- Parent must be `needs-split`; row is locked during confirm.
- Child documents insert as `split-processing`.
- Child `queued_at`, `updated_at`, and `created_at` are set to `NOW()` so children enter the tail of the queue.
- Parent becomes terminal `status = "split"`.
- Optional discarded pages create a backup `other` document in `reviewed` status.
- Split worker is spawned best-effort after commit; spawn failure does not fail the request.
- Emits `document.split_confirmed` with `target.type = "document"` and legacy audit action `split`.

## Spectrum COI Upload

## COI overrides

Invoice detail responses add `coiOverrides: CoiOverride[]` (empty for non-COI documents). `POST /api/invoices/:id/coi-overrides` and `DELETE /api/invoices/:id/coi-overrides/:checkId` require `accounting.invoices.coi_override`; approval returns `{ override, activeOverrides }` and revocation returns `{ revokedOverride, activeOverrides }`. The body is `{ checkId: string, reason?: string }`; failing checks require a nonblank reason. The service rejects `UNKNOWN_COI_CHECK`, `OVERRIDE_NOT_REQUIRED`, `OVERRIDE_REASON_REQUIRED`, `ACTIVE_OVERRIDE_EXISTS`, `ACTIVE_OVERRIDE_NOT_FOUND`, and `CLASSIFICATION_MISMATCH` with the documented 422/409/404 taxonomy.

COI detail and both override responses additionally include a server-time/config-version-stamped `compliance` result. It exposes raw/effective checks, value provenance, blockers, and upload readiness; a mismatched override config version yields `OVERRIDE_STALE` and does not override the raw status.

`GET /api/invoices/:id` returns the following additional fields for a COI document (`coiOverrides` is `[]` for a non-COI document, which has no `compliance` field):

```ts
interface Resolved<T> {
  value: T;
  provenance: 'manual' | 'extracted' | 'config' | 'unknown';
  permittedActions: string[];
  blockers: Array<{ code: string; message: string }>;
}
interface CoiComplianceResult {
  verdict: 'compliant' | 'review-required' | 'non-compliant';
  evaluatedAt: string;
  configVersion: string;
  configVersionId: string;
  checks: Array<{
    id: string; label: string;
    rawStatus: 'pass' | 'warn' | 'fail'; effectiveStatus: 'pass' | 'warn' | 'fail';
    provenance: 'computed' | 'override'; detail: string; required: boolean;
    code?: 'OVERRIDE_STALE';
  }>;
  coverageFailures: Array<{ coverageId: string; coverageLabel: string; limitLabel: string; value: number | null; minimum: number }>;
  expiration: Resolved<{ state: 'active' | 'expiring-soon' | 'expired' | 'unknown'; expirationDate: string | null; daysRemaining: number | null }>;
  vendorCode: Resolved<string | null>;
  uploadReady: boolean;
  blockers: Array<{ code: string; message: string }>;
}
```

`configVersion` and `configVersionId` are both returned by the current detail response and carry the selected version identifier. A stale persisted override remains in `coiOverrides`, but the affected check has `code: 'OVERRIDE_STALE'` and `effectiveStatus` remains its raw status.
### `PATCH /api/invoices/:id/coi-manual-values`

Requires `accounting.invoices.coi_override`. Accepts one or both of `{ vendorCode?: string | null, expirationDate?: string | null }`. A non-null vendor code is validated by the request-time server vendor master (an injected server lookup wins); `null` clears only that field. The response is `{ manualValues, compliance }`; each retained manual field is `{ value, setBy, setAt }` and takes precedence over extracted values. Invalid dates and unknown vendors return `422` with `INVALID_EXPIRATION_DATE` or `UNKNOWN_VENDOR_CODE`; unavailable, unreadable, or malformed vendor reference data returns `503 VENDOR_MASTER_UNAVAILABLE` without a write.
### `POST /api/documents/:id/upload-to-spectrum`

Requires `accounting.invoices.submit_spectrum`.

Request body:

```ts
interface UploadCoiToSpectrumRequest {
  vendorCode: string;        // Spectrum vendor code (e.g. "Z1EL91")
  expirationDate: string;    // YYYY-MM-DD
}
```

Response status: `202 Accepted`.

```ts
interface UploadCoiToSpectrumResponse {
  status: "queued";
  documentId: string;
  vendorCode: string;
  expirationDate: string;
  attempt: number;
  queuePosition: number;
  message: string;
}
```

Error responses:

| Status | Code | Condition |
|--------|------|----------|
| `400` | — | Missing or invalid `vendorCode` or `expirationDate` |
| `404` | — | Document not found |
| `409` | `CLASSIFICATION_MISMATCH` | Document is not classified as `coi` |
| `409` | `NO_FILE` | Document has no file on disk |
| `409` | `ALREADY_IN_PROGRESS` | Upload is `queued` or `processing` |
| `409` | `ALREADY_UPLOADED` | Upload already succeeded (returns prior `transId`, `trackingCode`, `completedAt`) |

Semantics:

- Requests serialize through a single PROIV session queue (stateful terminal protocol).
- Auto-creates tracking code `COI [YYYY]` if it doesn't exist (derived from `expirationDate` year).
- COI tracking codes use trigger basis `expiration` with actions 1 (Exception Report) + 4 (Disallow payment).
- Assigns tracking item to vendor with expiration date, then uploads PDF via `ImageUploadServlet`.
- Returns `202` immediately; upload processes asynchronously in the background.
- Session lifetime ~6 hours; auth takes ~25 seconds (Playwright SSO). 405 errors trigger automatic re-auth.
- Failed uploads can be retried by re-posting (status resets from `failed` to `queued`).
- On successful upload, the document transitions to `submitted`, persists the requested `vendor_code`, and records canonical match metadata: `matched_vendor_name` when the authoritative vendor reference supplies one, confidence `1`, and method `coi-upload-confirmed`.
- Moving a COI upload to `queued` is an atomic conditional claim. Only the current `coi` row with a local file and a `null`/`failed` upload status can claim the work; a concurrent loser re-reads the row and receives the ordinary `409` in-progress or already-uploaded response.

Document status columns (on `documents` table):

| Column | Type | Description |
|--------|------|------------|
| `spectrum_upload_status` | `TEXT` | `NULL` \| `queued` \| `processing` \| `success` \| `failed` |
| `spectrum_upload_queued_at` | `TIMESTAMPTZ` | When the upload was queued |
| `spectrum_upload_started_at` | `TIMESTAMPTZ` | When background processing began |
| `spectrum_upload_completed_at` | `TIMESTAMPTZ` | When upload finished (success or failure) |
| `spectrum_upload_error` | `TEXT` | Error message on failure |
| `spectrum_upload_trans_id` | `TEXT` | PROIV transaction ID on success |
| `spectrum_upload_tracking_code` | `TEXT` | Tracking code used (e.g. `COI 2029`) |
| `spectrum_upload_vendor_code` | `TEXT` | Vendor code used |
| `spectrum_upload_attempts` | `INTEGER` | Total attempt count |

Audit events:

| Event | Trigger |
|-------|--------|
| `document.spectrum_upload_queued` | First upload attempt queued |
| `document.spectrum_upload_retried` | Failed upload re-queued |
| `document.spectrum_upload_succeeded` | Upload completed successfully |
| `document.spectrum_upload_failed` | Upload failed (error in summary) |

## Automation Rule Actions

Rule create/update payloads use actions shaped as `{ type: string, value?: string, clear?: boolean }`. Existing value-based payloads remain valid. `set_vendor`, `set_job`, `set_phase_code`, `set_gl_account`, `set_cost_type`, and `set_routing_code` may send `clear: true` instead of `value`; the rule engine persists SQL `NULL` to the mapped document column. Clear actions must omit `value`, while value-based setters require a nonempty value. `set_classification` remains value-only because documents must retain an active classification. All other action types reject `clear: true`.

**Rule ID serialization.** The rule primary key is a database integer. Every response that carries a rule ID (`GET /api/rules`, `POST /api/rules`, the atomic create+apply result) serializes it as a `string` — including the `matchedRules` in `rules-applied` audit-log entries, which the audit read path returns — so no rule ID ever leaves the API as a number. Request paths that accept a rule ID (e.g. `ruleIds` on `POST /api/rules/apply`) coerce both string and number inbound, so existing numeric callers keep working.

**Atomic create-and-apply.** `POST /api/rules` with `"apply": true` creates the rule and applies it in ONE transaction. A failure anywhere after the rule INSERT (including mid-apply) rolls the whole transaction back — there is never an orphaned rule that was created but not applied. Request adds `apply?: boolean`, plus the same `scope?: "all" | "pending" | "queue"` (default `pending`), `documentIds?: string[]`, and `includeScope?: boolean` (default `true`) selectors as `POST /api/rules/apply` (`includeScope: false` requires nonempty `documentIds`). `sourceDocumentId?: string` requests an authoritative outcome for that one document. Response with `apply: true` is `201 { rule: Rule, applied: { matchedInvoices: number, actionsApplied: number }, sourceOutcome?: { id: string, matched: boolean, status: string | null } }`; `sourceOutcome` is present only when requested and must not be inferred from aggregate counts. Without apply the response is the created `Rule` as before.

## Spectrum Invoice Submission

`POST /api/invoices/submit` requires `accounting.invoices.submit_spectrum`. Before claiming rows or sending any Spectrum request, the backend rejects `400` when a selected eligible local document shares the same trimmed `(vendorCode, invoiceNumber)` pair with any other local document that is approved, submitting, or submitted:

Each successful `results[]` item may include `waiverDiscard`, the canonical local cleanup outcome for its linked lien waiver: `discarded`, `already_discarded`, `no_link`, `not_found`, `not_lien_waiver`, `link_changed`, `protected`, or `raced`. The field is informational; Spectrum submission success remains controlled by `success`.

```ts
interface DuplicateInvoiceSubmissionResponse {
  error: string;
  detail: string;
  duplicates: Array<{
    vendorCode: string;
    invoiceNumber: string;
    documentIds: string[];
    /** Additive context for the duplicate-resolution UI. */
    reason?: "already_submitted" | "batch_duplicate";
    documents?: Array<{
      id: string;
      status: string;
      jobNumber: string | null;
      amount: number | null;
    }>;
  }>;
}
```

`reason` and `documents` are additive fields. `already_submitted` identifies a
matching document that is already in Spectrum; `batch_duplicate` identifies
two approved local documents in the requested batch. Existing consumers may
continue to use `vendorCode`, `invoiceNumber`, and `documentIds` alone.

**Canonical waiver status.** Every invoice list and detail envelope carries
`waiverStatus` as one of `"attached" | "bypassed" | "requested" | "required" |
"not-required"`. It is server-owned presentation state; clients must not infer
it from the legacy diagnostic `lienWaiverStatus` field.

This makes one local document map to one Spectrum invoice identity. Result correlation uses `Vendor_Code` plus `Invoice_Number`, not response order. Extra, duplicate, unidentifiable, and malformed `APInvoices` response entries are never applied positionally to another local document. `UNVERIFIED`: capture a non-production Spectrum response to confirm its returned result identity fields before relying on any live integration behavior.

For an ordinary invoice detail line, the Spectrum distribution GL resolves server-side in strict order: nonblank submit override `gl_account`, nonblank persisted row `gl_account`, then the served `approvalRules.json` `codingDefaults.costTypeGlMap`. A phase-allocation line instead derives its distribution GL solely from that allocation's `cost_type` through the served map; document-level override and persisted GL values do not replace allocation-level derivation. No policy literal or last-resort GL is used. A single-ID or multi-ID request containing any invoice or phase-allocation line without a resolvable GL rejects the whole submit before the ordinary claim, database write, Spectrum post, or audit:

```ts
interface UnresolvableSpectrumGlResponse {
  error: "Cannot submit: a GL account is required for every Spectrum distribution.";
  code: "SPECTRUM_GL_ACCOUNT_UNRESOLVED";
  details: {
    unresolvedGlAccounts: Array<{
      id: string;
      invoiceNumber: string;
      costType: string | null;
      allocationIndex?: number; // zero-based phase-allocation index
    }>;
  };
}
```

The claimed rows are checked again to close a concurrent preflight-to-claim change. If that second check fails, every claimed row is restored to `approved`, no Spectrum request or audit fires, and the same `422` response is returned. This exceptional race path includes a transient `approved` → `submitting` → `approved` write; the ordinary unresolved path has no write and leaves the row unchanged.

Startup stale-submit recovery only restores interrupted `submitting` rows. `POST /api/invoices/:id/retry` only reprocesses classification-error documents. The additive `POST /api/invoices/:id/reprocess` endpoint accepts any stored-file document except `submitted`, `submitting`, and `split-processing`; it records request attribution, leaves status unchanged, and dispatches only the stored-file classifier/extractor/matcher worker. Neither endpoint calls the Spectrum invoice payload or dispatch path, and every later manual single/bulk submission re-enters `POST /api/invoices/submit`. `UNVERIFIED` at G-1: the product owner runs the `t23r` and `wuvf` post-deploy cases without editing production rows, confirms the 422/no-side-effect behavior and durable row state, and confirms one resolvable invoice still submits successfully.

## Bulk Invoice Actions

`POST /api/invoices/bulk` returns `200` with `updated` and optional `skipped`/`skippedInvoices` details for mixed results. Each `skippedInvoices` entry has `id` and `invoiceNumber` (which may be `null`), a reason (`error` or `reason`) and optional `code`; approval skips may additionally include `missing`, `path`, `subcontractNumber`, `nextAction`, `invoiceAmount`, `subcontractUnbilled`, and `overageAmount`. For `action: "discard"`, if every selected invoice is protected (`split-processing`, `submitting`, or `submitted`), it instead returns `409 { error, code: "BULK_ACTION_SKIPPED", details: { updated: 0, skipped, skippedInvoices } }`. This is intentional; other bulk-action status behavior is unchanged.

The duplicate rule is a preflight guard, not a database uniqueness constraint. A concurrent document change between preflight and claim remains `UNVERIFIED`; verify that race under production-equivalent database concurrency before claiming strict global uniqueness.

## Trash Restore (soft-delete + discarded delegation)

`POST /api/invoices/:id/restore` (`accounting.invoices.delete`) restores a document from the Trash view. A genuinely soft-deleted document is restored as before (`{ restored: true, id, status }`). Because the Trash view surfaces stranded discarded documents too, the SAME Restore button must handle them: when the document is not soft-deleted but `status = "discarded"`, the endpoint DELEGATES to the undiscard semantics (it reuses `POST /api/invoices/:id/undiscard`, it does not duplicate them):

- an undoable `invoice.discarded` event exists → the document is undiscarded (real undo, restored to its pre-discard status), returning `{ invoice, action }`;
- no undo record (discarded outside the app — a raw-SQL/ops sweep, split rejection, or auto-discard rule) → `422 { code: "DISCARD_NOT_UNDOABLE" }` ("This document was discarded outside the app and has no undo record, so it cannot be restored from here."), row unchanged.

A row that is neither soft-deleted nor discarded still returns `409 "Invoice is not deleted"`. This routes the M-087 graceful-undiscard message through the button users actually press, instead of the bare `409` the restore path previously returned for a discarded row.

## Document Destinations Catalog

The SharePoint destination catalog (folder tree + per-document-type default paths) is served from the backend (`document_destinations`) rather than the frontend `documentDestinations.ts`/`*_DESTINATION` constants. The frontend rewire consumes this contract and deletes those constants; the pure tree helpers (`formatDestinationPath`, `getDestinationPathNodes`, etc.) remain client-side logic operating on the served `tree`.

### `GET /api/document-destinations`

Requires `accounting.invoices.view_details`. No body.

```ts
interface DestinationFolderNode {
  id: string;
  name: string;
  children: DestinationFolderNode[]; // leaves carry []
}
interface DocumentDestinationsConfig {
  rootLabel: string;                 // "(Job root)"
  tree: DestinationFolderNode[];     // order is meaningful
  defaults: {
    subcontract: string;             // "01 Contracts / Subcontracts"
    warranty: string;                // "04 Closeout / Warranties"
    "lien-waiver": string;           // "02 Financials / Lien Waivers"
    other: string;                   // "(Job root)"
  };
}
```

Response `200`: `DocumentDestinationsConfig`. `404 { error, code: "DESTINATIONS_NOT_CONFIGURED" }` before the seed migration is applied. Seeded value-identical to the frontend constants at migration time.

### `PUT /api/document-destinations`

Requires `accounting.invoices.manage_settings`. Body: the full `DocumentDestinationsConfig` plus optional canonical ISO `effectiveFrom`. Unknown keys / malformed nodes → `400 { error: "Validation failed", details }`; invalid timestamps → `422 { error, code: "INVALID_DOCUMENT_DESTINATIONS_CONFIG", details }`; no version is appended on rejection. Each accepted write appends one immutable version with a physical `id`, serialized `version`, and acting-user audit event `settings.document_destinations.updated` in the same transaction. A write without `effectiveFrom` (or effective at server time) retains the legacy bare config response; a future-effective write returns `{ version: DocumentDestinationVersion, config: DocumentDestinationsConfig }`, where `config` remains the currently effective destination catalog.

Destination history is append-only in `document_destination_versions`. The
legacy singleton is backfilled as physical version `v1` and remains available
for compatibility during the route cutover. Effective selection uses server
time and the deterministic order `effectiveFrom DESC, createdAt DESC, id DESC`.

```ts
interface DocumentDestinationVersion {
  id: string;                 // immutable physical version id
  config: DocumentDestinationsConfig;
  effectiveFrom: string;     // ISO timestamp
  author: string;
  createdAt: string;         // ISO timestamp
}
```

### `GET /api/document-destinations/versions`

Requires `accounting.invoices.manage_settings`. Optional `limit` (1–200) and
nonnegative `offset` are clamped to safe bounds. Results are ordered by
`effectiveFrom DESC, createdAt DESC, id DESC` and preserve each immutable
physical `id`.

```ts
interface DocumentDestinationVersionList {
  versions: DocumentDestinationVersion[];
  total: number;
  limit: number;
  offset: number;
}
```

### `GET /api/document-destinations/versions/:id`

Requires `accounting.invoices.manage_settings`. Returns one
`DocumentDestinationVersion` by physical `id`; missing ids return
`404 { error, code: "DOCUMENT_DESTINATION_VERSION_NOT_FOUND" }`.

## COI Compliance Config

The COI compliance configuration is served from the backend (`coi_compliance_config`) rather than the frontend `coiComplianceConfig.ts`. The compliance ENGINE (`normalizeCoverageType`, the evaluation logic in `coiDocumentData.ts`) stays client-side this session; only its config source moves server-side.

### `GET /api/coi-config`

Requires `accounting.invoices.view_details`. No body.

```ts
interface CoiComplianceConfig {
  certificateHolder: { name: string; nameAliases: string[]; address: string };
  cancellationNoticeMinimumDays: number;      // integer days
  warnWindowDays: number;                     // integer days, defaults to 30
  coverageRequirements: Array<{
    type: string; label: string; required: boolean;
    limits: Array<{ key: string; label: string; minimum: number }>; // minimum = integer dollars
  }>;
  coverageTypeAliases: Record<string, string>; // raw alias -> canonical type key
}
```

Response `200`: `CoiComplianceConfig`. `404 { error, code: "COI_CONFIG_NOT_CONFIGURED" }` before the seed migration is applied. Seeded value-identical to `coiComplianceConfig.ts`.

### `PUT /api/coi-config`

Requires `accounting.invoices.manage_settings`. Body: the full `CoiComplianceConfig`, with optional ISO `effectiveFrom`. A malformed config → `422 { error, code: "INVALID_COI_CONFIG", details }` and appends no version. Immediate writes return the bare config for compatibility; future writes return `{ version: CoiConfigVersion, config: CoiComplianceConfig }`, retaining the current effective config.

### `GET /api/coi-config/versions?limit&offset`

Requires `accounting.invoices.manage_settings`. Returns `{ versions: CoiConfigVersion[], total, limit, offset }`, ordered by `effectiveFrom DESC, createdAt DESC, id DESC`.

### `GET /api/coi-config/versions/:id`

Requires `accounting.invoices.manage_settings`. Returns `CoiConfigVersion` (`id`, `config`, `effectiveFrom`, `author`, `createdAt`) or `404 COI_CONFIG_VERSION_NOT_FOUND`.

## Rule Builder + Cost-Type Catalogs

Served from the backend (`lib/ruleCatalog.js`) rather than the frontend `ruleOptions.ts` / `SpectrumSubmitSection.tsx` constants. The rule action/field/operator sets are the SAME definitions rule validation uses, so the served catalog and validation cannot drift.

### `GET /api/rule-options`

Requires `accounting.invoices.view_details`. No body.

```ts
interface RuleSelectOption { value: string; label: string }
interface RuleOptionsResponse {
  actions: RuleSelectOption[];    // 14; mirrors ruleActionSchema.type
  fields: RuleSelectOption[];     // 10; mirrors ruleCriterionSchema.field
  operators: RuleSelectOption[];  // 13; mirrors ruleCriterionSchema.operator (legacy greater_than/less_than excluded)
  statuses: RuleSelectOption[];   // 8; status values for the `status` criterion field
}
```

Response `200`: `RuleOptionsResponse`, value-identical to the frontend constants at introduction. The frontend rewire consumes this and deletes `ACTION_LABELS`/`FIELD_LABELS`/`OPERATOR_LABELS`/`STATUS_OPTIONS`.

### `GET /api/cost-types`

Requires `accounting.invoices.view_details`. No body. Response `200`: `{ costTypes: RuleSelectOption[] }` — the 6 Spectrum cost types (S, M, L, O, E, B), value-identical to `COST_TYPE_LABELS`. Option list only; cost-type default derivation is owned elsewhere.

## Routing Code Catalog

`GET /api/routing-codes` (and its `/api/backend/routing-codes` alias) returns the existing response envelope used by `useRoutingCodes`:

```ts
interface RoutingCodeOption {
  code: string;
  description: string;
  label: string; // equals code
  confirm_by?: string;
  approvers?: Array<{ sequence: string; operator: string; limit: number }>;
}

interface RoutingCodesResponse {
  routing_codes: RoutingCodeOption[];
  pm_to_routing: Record<string, string>;
  refreshed_at?: string;
}
```

`routing_codes` always contains exactly one `{ code: "D", description: "AP Default Routing", label: "D" }` entry. It is server-owned: the response adds it when Spectrum reference data omits it and replaces duplicate or non-canonical upstream `D` rows. The refreshed catalog contains only headers with a matching live Spectrum operator and excludes retired `JT`; its `pm_to_routing` entries refer only to those active catalog codes. Frontend consumers must use this served entry rather than create a local fallback routing code.

## Classification Metadata

`GET /api/classifications` now returns an **additive** `panel` object on every classification (built-in AND custom). All pre-existing fields (`name`, `label`, `action`, `builtIn`, `opensAs`, `status`, custom `addedAt`/`updatedAt`/`updatedBy`) are byte-identical — no existing consumer is affected.

```ts
interface ClassificationPanelMetadata {
  surface: "invoice_workflow" | "document_panel" | "generic_panel"; // routing (documentRouting.getSurface(opensAs))
  filterGroup: "invoice" | "receipt" | "statement" | "coi" | "w9" | "lien-waiver" | "other"; // dashboard panel group (= opensAs)
}
// each classification gains: panel: ClassificationPanelMetadata
```

`panel` is never null: `surface`/`filterGroup` derive from `opensAs`, which every classification resolves (custom rows default to `other`). The frontend can later derive routing (`documentRouting.ts`) and dashboard filter pills (`DashboardPanelFilters.tsx`) from this metadata instead of the hardcoded tables. The unknown-type Generic fallback remains frontend-owned (unchanged, not served).

## Approval State (server-authoritative verdict)

`GET /api/validate-approval/:id` returns the complete approval/coding verdict composed from backend single-source services — the foundation for retiring the client-side `approvalValidation.ts` derivation. Requires `accounting.invoices.view_details`.

```ts
interface ApprovalState {
  path: "1" | "2" | "3";           // 1=job+subcontract within budget, 2=job-only/over-budget, 3=no job
  requiredFields: string[];        // per-path required columns (multi-phase-aware)
  blockers: string[];              // human-readable; matches what approve/bulk-approve reject (empty = allowed)
  blockerDetails: ApprovalBlockerDetail[]; // structured blocker metadata for typed recovery actions
  unbilledBalance: number | null;  // subcontract sidecar; null when no subcontract
  asOf: string;                    // ISO server timestamp
  codingDefaults: {
    glAccount: string;             // row value, else config default: subcontract "5450" / otherwise "5300"
    costType: string;              // row value, else subcontract "S" (trg_default_cost_type-consistent) / otherwise "M"
    phaseCode: string | null;
    routingCode: string | null;    // path 1/3 auto-routing default "D"
    glDate: string | null;         // defaults to invoice_date
  };
  suggestedRoutingCode: string | null; // phaseOptionsService (PM→routing); null unless over-budget with a job PM
  suggestedRoutingPm: string | null;
}
```

### Closed-period approval recovery (W7)

The validation preview retains `blockers: string[]` and also returns `blockerDetails: ApprovalBlockerDetail[]`. Clients must select recovery behavior from the structured `code`, never from blocker copy:

```ts
interface ApprovalBlockerDetail {
  code: string;
  invoiceDateMonth?: string;
  suggestedInvoiceDate?: string;
  // Compatibility aliases retained while the backend dual-emits both shapes.
  glDateMonth?: string;
  currentMonth?: string;
  suggestedGlDate?: string;
  nextAction?: string;
}
```

When `code` is `"CLOSED_PERIOD_DATE"` and `invoiceDateMonth`, `currentMonth`, and `suggestedInvoiceDate` are served, the invoice approval surface shows `Invoice date falls in {invoiceDateMonth} — a closed period. Only {currentMonth} is open.` with `Use {suggestedInvoiceDate}`. The shared parser and recovery selector read these canonical fields first and use `glDateMonth` / `suggestedGlDate` only when the canonical name is absent during the dual-emit rollout. They never parse copy, derive a month, or manufacture a date.

The CTA sends one ordinary `PATCH /api/invoices/:id` containing only `invoiceDate: suggestedInvoiceDate`. It never queues, calls, or infers approval, and the save leaves invoice status unchanged. Pending or failed validation produces no recovery notice, recovery state is isolated by invoice identity, and the ordinary update response refreshes the canonical invoice date and approval verdict.

A raw single-approve rejection may carry the same structured fields alongside `error` and `code: "CLOSED_PERIOD_DATE"`; the shared API client preserves both canonical and legacy fields verbatim. W7 introduces no client date derivation, Spectrum submit auto-correction, or bulk approve. Recovery does not use the save-before-approve continuation, and `POST /api/invoices/:id/approve` rejects `invoiceDate`; callers must save it first. The backend remains the only writer of the canonical date through the ordinary update endpoint, whose audit records that edit.

`blockers` is the load-bearing field: it is built from the SAME `validateApprovalEligibility` gate the approve/bulk-approve mutations use, so a non-empty `blockers` corresponds exactly to a rejection those mutations would produce (proven by a cross-check test driving the same fixtures through both the preview and the real `approveInvoice`). `404` if the document is not found.

Successful `PATCH /api/invoices/:id` responses add `approvalVerdict: ApprovalState` beside their existing `invoice` and `action` fields. It is composed from the post-commit saved row by the same `buildApprovalState(row, { invoiceId, log })` path as `GET /api/validate-approval/:id`; clients must not derive or merge a verdict locally.

**`codingDefaults` — advisory pre-fill, config-sourced (G-2 B1/B2).** These are pre-fill HINTS the client applies to an in-progress invoice, NOT persisted state; the DB triggers persist only their own case (`trg_default_cost_type`: matched subcontract + empty `cost_type` → `"S"`, unchanged). Precedence is always the row/trigger value first; a configured default applies only when the column is unset. The policy VALUES live in `approvalRules.json` `codingDefaults` (the config home served additively by `GET /api/approval-schema`), never as code literals:
- `glAccount` — row `gl_account`, else `codingDefaults.glAccount.subcontract` (`"5450"`) for subcontract rows or `codingDefaults.glAccount.nonSubcontract` (`"5300"`) otherwise. (This is the server-side implementation of the former frontend `derivedGlAccount`.)
- `costType` — row `cost_type`, else `codingDefaults.costType.subcontractDefault` (`"S"`, which MUST equal the trigger's persisted value) for subcontract rows or `codingDefaults.costType.nonSubcontractDefault` (`"M"`) otherwise.

**Exact multi-phase `requiredFields` shape.** `requiredFields` is the selected path's `required` list from `approvalRules.json`. When `multi_phase_candidate === true` AND `phase_allocations` is set, the fields in `approvalRules.json` `multiPhaseOverrides.skipFields` (`["phase_code", "cost_type"]`) are removed from that list — each allocation row carries its own phase/cost type instead. Reconciliation with `approvalRules.json`: `requiredFields === paths[path].required.filter(f => !multiPhaseOverrides.skipFields.includes(f))`. Concretely, a path-1 multi-phase-allocated invoice yields `["invoice_number", "vendor_code", "invoice_date", "gl_date", "amount", "job_match_number", "gl_account"]` (path-1 `required` minus `phase_code`/`cost_type`). A `multi_phase_candidate` invoice with `phase_allocations` still `null` does NOT drop the fields — it keeps requiring `phase_code`/`cost_type` and additionally surfaces the `MULTI_PHASE_ALLOCATION_REQUIRED` blocker.

## Multi-Phase Allocation Validation

`PATCH /api/invoices/:id/phase-allocations` (`accounting.invoices.view_details`) is the server-authoritative chokepoint and the only writer of `phase_allocations`. It validates on a `FOR UPDATE` locked read: an invalid set never persists (the browser's real-time sum feedback in `MultiPhaseAllocationPanel.tsx` is advisory only). An invalid set → `422`:

```ts
interface PhaseAllocationError {
  error: "Invalid phase allocation";
  code: "INVALID_PHASE_ALLOCATION";
  details: {
    lines: Array<{ line: number; phase_code?: string; error: string }>; // every bad line
    total: string | null; // set when the sum != invoice total to the cent
  };
}
```

Rules: each `phase_code` must be a phase on the matched subcontract, each `amount` a positive number, no duplicate phases, and the sum must equal the invoice total to the cent (the backend cent tolerance is canonical). On rejection the row is unchanged.

## Endpoint Table

| Method | Path | Permission | Request summary | Response summary | Audit event(s) | Local/live side effects | UNVERIFIED gates |
|---|---|---|---|---|---|---|---|
| `GET` | `/api/invoices` | `accounting.invoices.view` | Query params, including optional exact `classification`, grouped `panel`, and `flagged=true|false` | `{ invoices, total, page, limit, pages }`; documents include Stage 1 row fields plus the attention-flag fields `flaggedAt`/`flaggedBy`/`flagReason` | None | Local read | None |
| `GET` | `/api/invoices/:id/neighbors` | `accounting.invoices.view` | Same filter/sort params as `GET /api/invoices` (`status`, `search`, `classification`, `panel`, `filed`, `flagged`, `splitFrom`, `sort`, `sortDir`) minus pagination | `{ prev: id\|null, next: id\|null, position: number\|null, total: number }`; `404` if the anchor id does not exist | None | Server-computed keyset prev/next plus 1-based `position`/`total` (N of M) in the SAME order the list produces; anchor resolved by id even when it no longer matches the filter (`position: null`, auto-advance) | None |
| `GET` | `/api/invoices/stats` | `accounting.invoices.view` | Optional `filed=true|false` and `panel` | `{ total, activeTotal, trashTotal, shelfTotal, globalTotal, pending, approved, rejected, submitted, skipped, discarded, duplicate, reviewed, errors, flaggedCount, todayProcessed, avgConfidence, amounts }`; `pending` includes underlying `pending` + `modified`, `activeTotal = pending + approved + submitted`, `globalTotal = activeTotal + trashTotal + shelfTotal`, and `total` mirrors `globalTotal`; `flaggedCount` counts documents with `flaggedAt !== null` (needs-attention marker, excluded from all bucket totals); all totals are panel-scoped when filtered | None | Local read | None |
| `GET` | `/api/invoices/trash` | `accounting.invoices.view` | Optional `search`, `panel`, `limit`, and `offset` | `{ invoices, total, limit, offset }`; case-insensitive search covers vendor name/code/matched vendor, invoice number, job number/match number, sender, subject, and description | None | Local read | None |
| `GET` | `/api/invoices/:id` | `accounting.invoices.view_details` | Path id | Single document with Stage 1 row fields | None | Local read | None |
| `PATCH` | `/api/invoices/:id` | `accounting.invoices.view_details` | Optional camelCase editable fields; `glDate` maps to `gl_date` | `{ invoice, action, approvalVerdict }`; `approvalVerdict` is the post-save `ApprovalState`, with `glDate` as `YYYY-MM-DD` or `null` | `invoice.edited` for non-empty edits | Local document update | None |
| `GET` | `/api/invoices/:id/waiver-suggestions` | `accounting.invoices.view_details` | Path id; strict `limit`/`offset` | `{ suggestions }`; each suggestion includes `filed: boolean` | None | Local read; includes filed and unfiled unlinked waivers; source queue tie-breaks with id | None |
| `GET` | `/api/invoices/:id/waiver-panel` | `accounting.invoices.view_details` | Strict optional vendor/job/search plus pagination params | `{ invoiceId, suggestions, orphans, totalOrphans }`; suggestions and orphans include `filed: boolean` | None | Local read; unified pairing pool includes filed and unfiled unlinked waivers; source queue tie-breaks with id | None |
| `GET` | `/api/invoices/:id/orphan-waivers` | `accounting.invoices.view_details` | Path id; strict optional `page` and `q`; fixed 10/page | `{ target, paired, waivers, total, page, limit }`; `paired` is the server-supplied linked counterpart summary or `null` with exactly `id`, `fileName`, `vendorName`, `vendorCode`, `amount`, `invoiceNumber`, `jobNumber`, `status`; candidate and target summaries also include `receivedAt` | None | Local read; server derives same-vendor-first priority; unlinked lien waivers include filed rows and exclude discarded/deleted before pagination | None |
| `GET` | `/api/lien-waivers/:id/orphan-invoices` | `accounting.invoices.view_details` | Path id; strict optional `page` and `q`; fixed 10/page | `{ target, paired, invoices, total, page, limit }`; `paired` is the server-supplied linked counterpart summary or `null` with exactly `id`, `fileName`, `vendorName`, `vendorCode`, `amount`, `invoiceNumber`, `jobNumber`, `status`; candidate and target summaries also include `receivedAt` | None | Local read; server derives same-vendor-first priority; unlinked invoices/pay-apps exclude submitted/submitting/discarded/deleted before pagination | None |
| `POST` | `/api/invoices/:id/attach-file` | `accounting.invoices.view_details` | Multipart `file` (PDF/image, max 25 MB) | `{ success, documentId, classification, flagged, notes, emailAttached, extracted, matching }` | Backend-owned processing audit | In-place storage, classification, extraction, matching, and best-effort source-email attachment | Live production E2E verified 2026-07-15 |
| `POST` | `/api/invoices/submit` | `accounting.invoices.submit_spectrum` | `{ ids?: string[], overrides?: Record<string, SubmitOverride> }` | Submit result summary; duplicate preflight returns `400 { error, details: { duplicates } }`; unresolved GL returns `422 { error, code: "SPECTRUM_GL_ACCOUNT_UNRESOLVED", details: { unresolvedGlAccounts } }` for single or bulk requests | `invoice.submitted_spectrum` per successful invoice; legacy submitted audit; none on GL refusal | Duplicate and GL preflight before ordinary claim/post; post-claim GL race guard restores `approved`; identity-based Spectrum result handling | G-1 `t23r`/`wuvf` refusal and resolvable-submit smoke; live Spectrum returned-result shape |
| `GET` | `/api/jobs/sharepoint/folders` | Authenticated `/api/jobs` route | Optional `path` query | `{ path, folders, files }`; folders selectable, files display/open context | None | Live SharePoint read | Live SharePoint browsing |
| `POST` | `/api/invoices/:id/file` | `accounting.invoices.approve` | Optional filing metadata, filename override, `uploadToSharePoint` | `{ invoice, action?, sharePoint? }` | `invoice.filed`; legacy `filed` | Explicit upload failure preserves prior filing state without success audit/action; metadata-only warnings and local-only shelving still complete | Live SharePoint upload/metadata/collision |
| `POST` | `/api/invoices/:id/actions/:actionId/undo` | `accounting.invoices.approve` | Path ids | `{ invoice, undoneActionId, sharePoint? }`, `404 ACTION_NOT_FOUND`, `409 ALREADY_UNDONE/ACTION_NOT_UNDOABLE/STATE_CHANGED_SINCE_ACTION`, or `410 UNDO_WINDOW_EXPIRED` | `invoice.file_undo` for file undo; other undo events for older actions | Local rollback; optional live SharePoint delete best-effort | Live SharePoint delete |
| `POST` | `/api/invoices/:id/waiver-override` | `accounting.invoices.approve` | No body | `{ invoice, action?, waiverOverride }` | `document.waiver_override_set`; legacy `waiver-override-set` | Local waiver override fields set; approval validation sees waiver satisfied | Live approval E2E |
| `POST` | `/api/invoices/:id/waiver-override/revert` | `accounting.invoices.approve` | No body | `{ invoice, action?, waiverOverride }` | `document.waiver_override_reverted`; legacy `waiver-override-reverted` | Local waiver override fields cleared; missing-waiver validation restored | Live approval E2E |
| `POST` | `/api/invoices/:id/waiver-bypass` | `accounting.invoices.approve` | No body | `{ invoice, action? }` | `document.waiver_bypass_set`; legacy `waiver-bypass-set` | Sets only `lien_waiver_required = false`; leaves status/link/Attached untouched | Live approval E2E |
| `POST` | `/api/invoices/:id/waiver-bypass/revert` | `accounting.invoices.approve` | No body | `{ invoice, action? }` | `document.waiver_bypass_reverted`; legacy `waiver-bypass-reverted` | Sets only `lien_waiver_required = true`; marker returns when no other satisfaction exists | Live approval E2E |
| `POST` | `/api/invoices/:id/reconcile` | `accounting.invoices.approve` | No body | `{ invoice, action? }` | `invoice.reconciled` | Local reconcile; statement documents also shelf via `filed`/`filed_at`; no SharePoint path | Live workflow E2E |
| `POST` | `/api/invoices/:id/unreconcile` | `accounting.invoices.approve` | No body | `{ invoice, action? }` | `invoice.unreconciled` | Local restore from audit before-state; no SharePoint path | Live workflow E2E |
| `PATCH` | `/api/invoices/:id/statement-attributes` | `accounting.invoices.approve` | Nonempty subset of `{ statementPeriod: string \| null, balance: finite number \| numeric string \| null }` | `{ invoice }` with canonical `invoice.statementAttributes` | `document.statement_attributes_updated` | Locked full-object JSONB manual set/clear; clear reveals M-077 fallback; never changes `documents.amount` | Live DB transaction visibility |
| `PATCH` | `/api/invoices/:id/warranty-classification` | `accounting.invoices.approve` | Nonempty subset of `{ providerKind: string \| null, warrantyType: string \| null }` | `{ invoice }` with canonical `invoice.filing.providerKind` and `invoice.filing.warrantyType` | `document.warranty_classification_updated` | Locked full-object JSONB manual set/clear; clear reveals computed fallback; classification unchanged | Live DB transaction visibility |
| `POST` | `/api/invoices/:id/statement-lines` | `accounting.invoices.approve` | `{ invoiceNumber, date, amount }` | `{ invoice, statementLines, addedLine }` | `document.statement_line_added`; legacy `statement-line-added` | Local JSONB append and injected/local matching | Live Spectrum lookup quality |
| `PATCH` | `/api/invoices/:id/statement-lines/:lineId` | `accounting.invoices.approve` | One or more of `{ invoiceNumber, date, amount }` | `{ invoice, statementLines, updatedLine }` | Statement-line edit audit | Local JSONB update and injected/local rematching | Live Spectrum lookup quality |
| `DELETE` | `/api/invoices/:id/statement-lines/:lineId` | `accounting.invoices.approve` | Path ids | `{ invoice, statementLines, removedLine }` | Statement-line delete audit | Local JSONB removal and injected/local rematching | Live Spectrum lookup quality |
| `POST` | `/api/invoices/:id/statement-lines/rematch` | `accounting.invoices.approve` | No body | `{ invoice, statementLines, statusChanges }` | Statement-line rematch audit | Local JSONB status refresh from Toolbox/Spectrum matching | Live Spectrum lookup quality |
| `POST` | `/api/invoices/:id/statement-lines/:lineId/resolve` | `accounting.invoices.approve` | `{ resolutionType }` | `{ invoice, statementLines, updatedLine }` | `document.statement_line_resolved` | Persists JSONB resolution metadata | Live DB persistence |
| `POST` | `/api/invoices/:id/statement-lines/:lineId/unresolve` | `accounting.invoices.approve` | No body | `{ invoice, statementLines, updatedLine }` | `document.statement_line_unresolved` | Clears JSONB resolution metadata | Live DB persistence |
| `POST` | `/api/rules` | `accounting.invoices.manage_rules` | Rule fields; optional `apply?: boolean` with `scope?`, `documentIds?`, `includeScope?` (same selectors as `/apply`), and `sourceDocumentId?` | `201` created `Rule` (string `id`); with `apply: true`, `201 { rule: Rule, applied: { matchedInvoices, actionsApplied }, sourceOutcome?: { id, matched, status } }` | `rules-applied` per changed document when `apply: true` | `apply: true` creates and applies in ONE transaction — a failure after the INSERT rolls the rule back (no orphan); rule IDs serialize as strings. `sourceOutcome` is emitted only when `sourceDocumentId` is requested; a missing source returns `{ id: sourceDocumentId, matched: false, status: null }` rather than an aggregate inference. | None |
| `POST` | `/api/rules/apply` | `accounting.invoices.manage_rules` | `{ ruleIds?: string[], scope?: "all" \| "pending" \| "queue", documentIds?: string[], includeScope?: boolean }`; `scope` defaults to `pending`, `includeScope` defaults to `true`; `includeScope=false` requires nonempty `documentIds` | `{ matchedInvoices, actionsApplied, errors, durationMs }` | `rules-applied` per changed document | Applies active rules to the deduplicated union of the broad scope and explicit document IDs; explicit IDs are selected regardless of status | None |
| `POST` | `/api/splits/:id/confirm` | `accounting.invoices.manage_splits` | `{ groups, discardPages? }`, group `docType` active classification | `202 { parentId, childIds, backupChildId, discardedPages, status, message }` | `document.split_confirmed`; legacy `split` | Local child rows/files; worker spawn best-effort | Live split worker E2E |
| `POST` | `/api/documents/:id/upload-to-spectrum` | `accounting.invoices.submit_spectrum` | `{ vendorCode, expirationDate }` | `202 { status, documentId, vendorCode, expirationDate, attempt, queuePosition, message }` | `document.spectrum_upload_queued`, `document.spectrum_upload_retried`, `document.spectrum_upload_succeeded`, `document.spectrum_upload_failed` | Async PROIV session: auto-create tracking code, assign to vendor, upload PDF via ImageUploadServlet; status columns on `documents` row | Live Spectrum session E2E |

## Frontend Type Mirror Checklist

- `Invoice.extracted.projectAddress` is included; COI/statement non-persisted payload fields are optional at most and should not be treated as guaranteed API row fields.
- `Invoice.matching.vendor.vendorCode` and `Invoice.matching.job.jobNumber` are nullable for suggestion-only matches.
- `Invoice.matching.overallConfidence` mirrors the backend nested response field; the retired review flag is not emitted or mirrored.
- Invoice updates send frontend `glDate`; the backend persists `gl_date` and maps it back to `glDate` on document responses. Spectrum submit overrides continue to use `gl_date`.
- `DashboardStats.activeTotal` mirrors the backend All-tab-compatible count: `pending` (including underlying `modified`) + `approved` + `submitted`. `trashTotal`, `shelfTotal`, and `globalTotal` expose the dashboard bucket invariant.
- `StatementLine.status` includes `matched`, `in_toolbox_not_spectrum`, `not_received`, and `amount_differs`.
- `StatementLine.source` in `types/invoice.ts` includes `extracted` and `manual`; `AddStatementLineResponse.addedLine.source` in `types/api.ts` narrows to `manual`.
- Statement-line consumers should render from `invoice.statementLines ?? invoice.extracted?.statementLines ?? []`; extraction-only payload consumers should coalesce omitted empty lines with `statementLines ?? []`.
- `Invoice` includes `filed`, `filedAt`, `filedDestination`, `filingNote`, `holdReason`, `spFileUrl`, `sharePointItemId`, `sharePointFilename`, `reconciled`, `reconciledAt`, `waiverOnDocument`, `waiverOnDocumentAt`, `waiverOnDocumentBy`, `waiverType`, `waiverRequestedAt`, and `waiverRequestedBy`.
- `WaiverSuggestion` and `OrphanWaiver` include `filed: boolean`; `filed === false` is informational only and must not block linking.
- API mirror types include `FileDocumentRequest/Response`, `UndoActionResponse`, `WaiverOverrideResponse`, `AddStatementLineRequest/Response`, `UpdateStatementLineRequest/Response`, `DeleteStatementLineResponse`, `RematchStatementLinesResponse`, `ReconcileDocumentResponse`, and widened split confirm group `docType?: string`.
- `POST /api/documents/:id/upload-to-spectrum` is live (BE-C confirmed 2026-07-04) and requires `accounting.invoices.submit_spectrum`. Document status columns are exposed as `spectrumUploadStatus`, `spectrumUploadQueuedAt`, `spectrumUploadStartedAt`, `spectrumUploadCompletedAt`, `spectrumUploadError`, `spectrumUploadTransId`, `spectrumUploadTrackingCode`, `spectrumUploadVendorCode`, and `spectrumUploadAttempts`; upload failures also populate `lastSpectrumError` for existing error UI compatibility.
# PATCH subcontract derivation

`PATCH /api/invoices/:id` may return `subcontractDerivation` after a Vendor or
Job-only edit: `{ method, subcontractNumber, options? }`. It is canonical for
that request's vendor/job pair; explicit `{ subcontractNumber }` picker and
clear requests remain authoritative.

## W13 — Multi-Waiver Bundle Guidance

The shared invoice/document response may include the additive field
`waiverAutoLinkSkipReason: "multi-waiver-bundle" | null`. The frontend renders the
bundle guidance only for a lien-waiver document when the served value is exactly
`"multi-waiver-bundle"`; an absent value, `null`, or any other served value renders
nothing. The guidance is: `This PDF looks like a bundle of multiple waivers (>2
pages), so auto-link was skipped. Split it first, then link each waiver.`

Its `Split Document` CTA reuses the route's existing split action, including its
`Scissors` icon and callback. Pending-like documents continue through the existing
flag-then-navigate branch; documents already in `needs-split` navigate directly to
split review. No client-side page-count, bundle, orphan, or detection inference is
permitted, and no second mutation or split route is introduced.

## Document collaboration — comments/activity (Stage 1)

The same collaboration handlers are available through two explicit caller
families: `/api/invoices/:id/...` for documents opened with `opensAs: "invoice"`
and `/api/documents/:id/...` for the eight non-invoice surfaces (receipt,
statement, COI, W-9, lien waiver, subcontract, warranty, and other). Custom
classifications follow their resolved `opensAs` mapping: invoice uses the
invoice family and every other value uses the document family. Response
envelopes, permissions, validation, and missing-document behavior are shared.
The comment, activity, and activity-view paths are available under both route
families with the same method and response envelope.

Source: `docs/document-collaboration/BUILD-SPEC-DOCUMENT-COLLABORATION.md`
§§2–4 and comments appendix checklist 1.1–1.6. Existing Notes/Line Items and
`GET /api/invoices/:id/audit` are preserved.

- `POST /api/invoices/:id/comments`, permission `accounting.invoices.view_details`:
  strict `{ body: string }`, trimmed 1–2000 characters. Unknown actor/other keys
  fail 400; server derives actor. 201 `{ comment: { kind: 'comment', id,
  documentId, body, timestamp, actor: { userId, name, role, azureId,
  avatarUrl } } }`. `name` is the server-resolved platform display name, not
  an email. `azureId` and `avatarUrl` are nullable (`string | null`) for
  unresolved or external actors and must never be derived from an email. Rows
  whose historical actor cannot be resolved use `name: "Former user"` with
  `userId`, `azureId`, and `avatarUrl` all `null`. External vendors, NDRs, and
  System keep their own non-platform identity and null platform photo fields.
  Body is plain text: future renderers must use text nodes. Immutable; no edit
  or delete. Locked/discarded documents remain commentable while viewable.
- `GET /api/invoices/:id/activity`, same permission: strict `{ limit?, offset? }`
  query (default 50/0, limit 1–200). Response `{ entries, pagination: { limit,
  offset, total, hasMore } }`. Comments use the shape above; events retain the
  platform AuditEvent fields with `kind: 'event'`, the same safe actor
  projection (`userId`, `name`, `role`, nullable `azureId`/`avatarUrl`), and an
  optional request-scoped `documentClassification: string | null`. It is derived
  once from the requested document and appears only on event entries; comment and
  email entries omit it.
  SQL merges before paging by timestamp/id DESC, kind DESC on collisions.
  The metadata-only comment audit row is omitted from visible entries. Both invoice and document targets are included for the same ID, preserving split-request history; unrelated target types are excluded.
  The merged feed also accepts `kind: 'email'` metadata for inbound messages and
  confirmed outbound messages. It exposes metadata/bodyPreview only, never a full
  body; its display timestamp is separate from server-arrival created_at. GET is
  read-only and does not mutate the unread cutoff.
- `POST /api/invoices/:id/activity/view`, same permission and empty body, returns
  `{ documentId, priorActivityViewedAt, activityViewedAt, unreadReplies,
  unreadComments }`. The server locks the document, returns the prior cutoff, then
  advances it with server time and bulk-sets inbound read_at through that cutoff.
  Client timestamps are rejected by the empty-body contract; later committed
  comments/inbound messages remain unread. Prefetch and inactive GETs do not clear.
- Invoice list and detail responses add `unreadReplies` and `unreadComments`.
  Only comments and inbound email kind count; confirmed outbound email is visible
  in Activity but not unread. List projections are scalar and preserve one row per
  document and the existing pagination contract.
- Both validate IDs; 403 permission and 404 missing document; canonical
  `{ error, code?, details? }` errors. Comment/audit persistence is atomic.
- `invoice.intake` starts forward-only with changes `{ from, subject,
  receivedAt }`; `invoice.reclassified` adds `{ classification: [before, after] }`.
  New invoice-wrapper audit names and comment names resolve the directory at
  write, falling back to email. Historical names remain as stored.
- D4: successful approve/reject/delete/restore/permanent-delete hooks stop
  posting duplicate browser audit events; existing server coverage and query
  invalidation remain. Split-created and submission emitters are preserved.
  No new UI surface, read-state model, Notes migration or dual-write lands here.

## Document collaboration email backend (Stage 2)

Authenticated `accounting.invoices.request_waiver` protects the following routes under
both `/api/invoices/:id/...` and `/api/documents/:id/...`:
POST `/api/documents/:id/reply`, GET `/api/documents/:id/reply-recipient`,
POST `/api/documents/:id/forward`, and GET `/api/documents/:id/forward-defaults`.
Reply JSON is `{body:string(1..5000),recipient?:email}`; Forward JSON is `{recipients:UUID[1..10],body:string(0..5000)}`.
Both require a UUID `X-Send-Token` header. No actor or attachPdf fields are accepted.
Success200 preserves `{ok:true,sentTo:string}` for Reply and `{ok:true,sentTo:string[]}` for Forward.
Defaults return `{defaultRecipients:[{userId,name,email}]}` with exactly one matched job PM or [].
Recipient IDs are Azure directory IDs from `/api/users`, not Toolbox user IDs.

Canonical failures:400 invalid input/recipient/header;403 permission;404 document;
409 `EMAIL_NO_THREAD` or `EMAIL_SEND_DUPLICATE`;422 `EMAIL_INVALID_SENDER`/`EMAIL_FILE_UNAVAILABLE`;
429 `EMAIL_SEND_LIMIT`;503 `{error:"email_sends_disabled"}`;502 `EMAIL_SEND_FAILED` or
`EMAIL_SEND_AMBIGUOUS`, both with `details.attemptId`. Ambiguous includes accepted Graph send
whose exact Sent copy is not yet visible. Preserve the composer text, show uncertainty, and never
retry automatically or automatically replace its token. Same token blocks60s and indefinitely while
pending/ambiguous. A deliberate new composition/token remains permitted. Confirmed is sent-copy
confirmation, not delivery; NDR and reconciliation follow in Stage4.

Attachment selection is server-automatic: <=3*1024*1024 file bytes attach, larger files add an omission
note. Forward includes the APP_BASE_URL `/accounting/documents/:id` link; external Reply omits it.
Reply stays in-thread. `GET .../reply-recipient` returns a direct prefill only for a verified vendor sender;
blocked or unrecognized senders return a picker with thread-history addresses ranked before body-parsed,
cached-vendor, and directory contacts. Such replies must submit a returned `recipient`, and a confirmed
reply touches that vendor contact. Both replyTo the AP mailbox. Audit follows confirmed send only,
with server actor and <=200-character preview. Later frontend PRs must follow master §0.2 and §11;
this backend change implements no UI and does not alter Notes, Line Items, activity or unread state.

## Inbound correlation and activity projection (Stage 4.1)

The pipeline inspects mailbox headers before downloading attachments or applying
the legacy attachmentless-reply discard. It matches a reply first by an exact
outbound `internet_message_id` in `References`/`In-Reply-To`, then by a
conversation that resolves to exactly one document (split children may fall
back to their one parent root). Ambiguous references/conversations are held as
review rows with `correlationState: "ambiguous"` and never select a document,
download attachments, or enter normal ingestion; unmatched mail continues
through normal ingestion. Participant
verification is server-owned and an unverified match remains attached with
`verifiedParticipant: false` for the UI badge.

Inbound rows expose only metadata, a <=200-character `bodyPreview`, and
server-sanitized allowlisted `sanitizedBodyHtml`; raw body content is never
serialized. `hasAttachments` and `attachmentReviewed` describe the review
boundary, and inbound attachments never enter normal ingestion automatically.
Automatic replies are dropped before lookup. NDRs are retained as
`emailKind: "ndr"` facts and do not contribute to unread reply counts. Duplicate
inbound internet message identities are ignored after the first capture. Waiver
sends are recorded in the same message table, so promoted waiver attachments
can use tier-zero identity lookup before the existing conversation and
subject/vendor fallbacks.

The correlation columns and replay index are delivered by the later additive
`2026-09-17_document_email_correlation.sql` migration so deployments with the
historical email-table migration already applied can adopt the projection safely.

Activity comment and event actors are enriched by the shared server activity
read path, not by the client. One batched `toolbox_users` lookup per activity
page resolves a non-system, non-external stored actor identifier in order of
platform ID, Azure AD ID, then normalized email. Matched actors expose the
canonical platform name and `avatarUrl: "/api/users/<azure_id>/photo"`; that
photo path uses the Azure AD ID rather than the platform UUID. Unmatched,
System, and external actors retain their existing fields and expose no platform
avatar URL. Invoice and document activity aliases have identical behavior.

Permanent document deletion sets the email row's document_id to NULL, retaining attempt identity,
quota accounting and unresolved-token protection. Orphan attempts are not thread destinations;
Stage4 matching must ignore them. This preserves existing deletion behavior without resetting sends.

## Email outbox reconciliation (Stage 4)

`accounting.invoices.view_details` protects both attempt endpoints:

| Route | Request | Success |
|---|---|---|
| GET `/api/documents/email-attempts/:attemptId` | no body | `{ attemptId, documentId, kind, status, actorUserId, subject, recipients, conversationId, internetMessageId, hasAttachments, attemptedAt, sendStartedAt, sentAt, resolvedAt }` |
| POST `/api/documents/email-attempts/:attemptId/reconcile` | `{}` | `{ attempt, transitioned }` |

Status is server-owned metadata only; message bodies are not returned. Reconciliation
uses the persisted immutable Graph message ID and confirms only an exact response
with `isDraft === false`, `internetMessageId`, and `sentDateTime`. Similar subject/time
messages, missing/partial results, mismatched IDs, and timeouts remain `ambiguous`.
Only explicit positive failure evidence can produce `failed`. Replays and overlapping
reconciliations are idempotent, terminal attempts are not regressed or re-audited,
and reconciliation never sends mail. The future sweep declaration is not activated
by API startup; live mailbox/Graph, scheduler, delivery, deployment, and SSO checks
remain UNVERIFIED.
