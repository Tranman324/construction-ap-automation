# NCG Invoice Pipeline — API Reference

## Overview

The invoice pipeline exposes a REST API on port `3456` (configurable via `INVOICE_SERVER_PORT`).  
Base URL: `http://localhost:3456`

All responses are JSON. CORS is enabled. Legacy write coverage is logged to `audit_log`; Stage 1 document mutations also emit structured `audit_events` where noted below.

## Error response contract

Every non-HEAD API error body uses one canonical shape:

```ts
interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}
```

`code` is the stable, machine-readable field and is always top-level. Route-specific metadata (for example `missing`, `actionId`, `staleFields`, `duplicates`, or `skippedInvoices`) is under `details`. HTTP `HEAD` failures intentionally have no response body, but use the same shared responder for their status handling. Successful response shapes are unchanged.

The A7c response-finalization boundary enforces this envelope at emission time for every API response with status `>=400`, including response-method aliases and external emitters. It preserves canonical Express `json` and `send` bodies through their nested emission chain. In production, a nonconforming error body is repaired to the canonical envelope and logged with the route, status, and request ID (never the body); a body without a top-level string `error` is preserved under `details`. Direct non-bodyless `end(body)` error emissions are serialized as canonical JSON. Streaming `write()` is blocked before any error bytes emit, preventing it from bypassing the boundary. The test command runs in strict mode, where the same nonconforming emission throws before a body is sent.

## Authorization and boundary validation

Every route below other than public `GET /api/health` is mounted behind authentication and now has a handler-level permission check. The API reuses existing permission keys only; this change adds no permission migration or role grant. An authenticated caller without the listed key receives `403 { "error": "Forbidden" }` before the route handler runs.

| Endpoint family | Reused permission | Boundary validation |
|---|---|---|
| `GET /api/jobs`, `/sharepoint/folders`, `/:jobNumber/folders` | `accounting.invoices.view_details` | Jobs: `search` (max 200), `status` (max 100), and bounded `limit`/`offset` (default 50, max 200). SharePoint path max 1000; job number is a nonblank path parameter (max 100). |
| `GET /api/vendors` | `accounting.invoices.view` | `search` max 200; bounded `limit`/`offset` (default 50, max 200). |
| `GET /api/vendors/refresh/status` | `accounting.invoices.manage_settings` | No payload. |
| `GET /api/subcontracts` | `accounting.invoices.view_details` | `vendorCode` and `jobNumber` max 100; bounded `limit`/`offset` (default 50, max 200). |
| `POST /api/feedback/vendor`, `/subcontract` | `accounting.invoices.view_details` | Existing strict feedback body schemas remain in force. |
| `GET /api/users`, `/:id/photo` | `accounting.invoices.view_details` | User-list pagination is strict (`limit` 1–200, `offset` >=0); photo id is a nonblank path parameter (max 100). |
| `GET /api/pipeline/errors`, `POST /errors/:id/resolve`, `/errors/:id/retry` | `accounting.invoices.manage_settings` | `resolved` is exactly `true`, `false`, or `all`; list reads use bounded `limit`/`offset` (default 50, max 200); error id is a nonblank path parameter. Resolve retains its strict body schema. |
| `GET /api/classifications`, `/approval-schema` | `accounting.invoices.view` | Classifications accepts `include=associations` and the established `status=all` pair plus bounded `limit`/`offset` (default 50, max 200); no other status value or unknown query key is accepted. |
| Routing/phase/GL lookups and `GET /api/validate-approval/:id` | `accounting.invoices.view_details` | GL: documented account `type`, `costType` max 20, `search` max 200, and bounded `limit`/`offset` (default 50, max 200); approval id is a nonblank path parameter. |
| `GET /api/retention` | `accounting.invoices.manage_settings` | Strict pagination (`limit` 1–200, `offset` >=0). |
| `POST /api/invoices/:id/reprocess` | `accounting.invoices.view_details` | Document id is a nonblank path parameter. Stored-file documents are eligible except `submitted`, `submitting`, and `split-processing`. |
| Lien-waiver browse/detail endpoints | `accounting.invoices.view_details` | Orphan filters, panel filters, page (>=1), and limit (1–200) are strict; waiver id is a nonblank path parameter. |
| `POST /api/documents/:id/upload-to-spectrum` | `accounting.invoices.submit_spectrum` | Document id is a nonblank path parameter; its existing upload validation remains unchanged. |

Unknown, malformed, or out-of-range query/path values return `400 { "error": "Validation failed", "details": ... }` before a service call. This applies to query and path parameters; multipart upload processing is unchanged.

Two narrowly scoped authenticated self-service exceptions remain deliberate:

- `POST /api/audit/events` remains ungated under SEC-01, but always derives the audit actor from `req.user`.
- The Stage 3-approved zero-permission feature-request landing retains authenticated list/create/vote access (`GET`/`POST /api/feature-requests`, `POST`/`DELETE /:id/vote`). Feature-request deletion remains `feature_requests.manage`; PATCH retains its author-ownership check and requires `feature_requests.manage` for status changes.

`GET /api/feature-requests` strictly accepts optional `category` (`workflow`, `reporting`, `integration`, `design`, `admin`, or `all`), `status` (`open`, `in_progress`, `completed`, `declined`, or `all`), and bounded `limit`/`offset`; omitting `status` preserves the existing `open` default. `GET /api/splits/queue` strictly accepts `sort` (`pages`, `vendor`, or `received`), `sortDir`, and bounded `limit`/`offset`.

---

## Data Model — Document

```json
{
  "id": "doc-1771376946553-v6q9",
  "classification": "invoice",
  "status": "pending",
  "confidence": 0.95,
  "file": "invoice_305.pdf",
  "email": {
    "messageId": "AAMkAGE1...",
    "from": "vendor@example.com",
    "subject": "FW: Invoice #305",
    "receivedAt": "2026-02-17T21:37:40Z",
    "bodyPreview": "...",
    "body": "...",
    "bodyContentType": "html"
  },
  "extracted": {
    "vendorName": "Palmetto Solutions",
    "vendorAddress": "1000 Highway 99 Loganville, GA",
    "invoiceNumber": "305",
    "invoiceDate": "2026-02-15",
    "dueDate": "2026-03-17",
    "amount": 874.00,
    "jobNumber": "25-559",
    "projectName": "NPX",
    "description": "Final clean for NPX",
    "lineItems": [{"description": "Final clean for NPX", "amount": 874.00}],
    "statementLines": []
  },
  "matching": {
    "vendor": {
      "vendorCode": "ZPAL91",
      "vendorName": "Palmetto Solutions LLC",
      "confidence": 0.96,
      "method": "fuzzy-high"
    },
    "job": {
      "jobNumber": "25-559",
      "jobDescription": "NPX Building 4 Interior Upfit",
      "confidence": 0.92,
      "method": "description-match"
    },
    "subcontract": {
      "subcontractNumber": "25-559.12",
      "confidence": 0.95,
      "method": "exact-unique"
    },
    "overallConfidence": 0.95
  },
  "statementLines": [],
  "splitFrom": null,
  "duplicateOf": null,
  "rejectionReason": null,
  "filed": false,
  "filedAt": null,
  "filedDestination": null,
  "spFileUrl": null,
  "sharePointItemId": null,
  "sharePointFilename": null,
  "linkedTo": null,
  "flagged": false,
  "hidden": false,
  "wasModified": false,
  "lienWaiverStatus": null,
  "displayName": null,
  "reviewedAt": null,
  "queuedAt": "2026-02-18T01:09:06.553Z",
  "updatedAt": "2026-02-18T01:09:06.553Z",
  "routingCode": null,
  "phaseCode": null,
  "costType": null,
  "glAccount": null,
  "glDate": null,
  "linkedLienWaiverId": null,
  "lienWaiverRequired": false,
  "mergedFilePath": null,
  "submitError": null
}
```

### Matching Objects

`matching.vendor`, `matching.job`, and `matching.subcontract` expose persisted match columns in camelCase. Automatic matches have confidence `>= 0.85` and populate the selected key (`vendorCode`, `jobNumber`, or `subcontractNumber`). Suggestion-only vendor/job matches have confidence `>= 0.70` and `< 0.85`; they keep the selected key `null`, include the persisted candidate name when available, and use a `method` containing `suggestion`. Current subcontract suggestions are not surfaced as a `matching.subcontract` object unless `subcontract_number` is populated. No-match results remain `null` in the response.

Persisted document columns:
- Vendor: `vendor_code`, `matched_vendor_name`, `vendor_match_confidence`, `vendor_match_method`
- Job: `job_match_number`, `job_match_confidence`, `job_match_method`
- Subcontract: `subcontract_number`, `subcontract_match_confidence`, `subcontract_match_method`

### Statement Lines

Statement documents expose `statementLines` at the document top level and under `extracted.statementLines`. API document reads normalize missing/null persisted `statement_lines` to an empty array in both locations. Intermediate extraction payloads may omit `statementLines` when no lines were found; consumers outside document-read responses should coalesce with `statementLines ?? []`. The persisted JSONB column is `statement_lines`; each stored line is one parent invoice/reference from the statement:

```json
{
  "id": "7552",
  "invoiceNumber": "7552",
  "date": "2026-05-06",
  "amount": 32590.00,
  "status": "not_received",
  "source": "extracted"
}
```

Sub-item/detail rows from extraction are roll-up evidence only and are not stored as separate `statement_lines` entries. Valid line statuses are `matched`, `in_toolbox_not_spectrum`, `not_received`, and `amount_differs`. Valid sources are `extracted` for model-produced rows and `manual` for user-added rows.

`id` is an operation handle for UI updates and manual-line endpoints, not a durable business key. Use `invoiceNumber` plus date/amount context for display and reconciliation identity.

### Stage 1 Contract Addendum

Permission compatibility: invoice permission checks dual-accept the legacy `invoices.X` namespace and the current `accounting.invoices.X` namespace in both directions. Non-invoice namespaces remain exact-match only.

Additive migration `migrations/2026-07-02_document_statement_waiver_columns.sql` adds `sharepoint_item_id`, `sharepoint_filename`, `statement_lines`, `waiver_on_document`, `waiver_on_document_at`, and `waiver_on_document_by`. Additive migration `migrations/2026-07-04_spectrum_coi_upload.sql` adds Spectrum COI upload status columns and seeds `accounting.invoices.submit_spectrum`. The operator applied the Spectrum COI migration server-side on 2026-07-04.

Stage 1 endpoint/audit summary:

| Method | Path | Permission | Request summary | Response summary | Audit event type(s) | Side effects / gates |
|---|---|---|---|---|---|---|
| GET | `/api/invoices` | `accounting.invoices.view` | Query params | Documents include `matching`, `statementLines`, filing/SP, reconcile, and waiver fields | None | Local read |
| GET | `/api/invoices/:id/neighbors` | `accounting.invoices.view` | Same queue filter + ordering params as `GET /api/invoices`, minus pagination | `{ prev: id\|null, next: id\|null, position: number\|null, total: number }` | None | Server-computed keyset prev/next plus the anchor's 1-based `position`/`total` in the filtered order |
| GET | `/api/invoices/:id` | `accounting.invoices.view_details` | Path id | Same document shape as list/detail mapper | None | Local read |
| POST | `/api/invoices/:id/file` | `accounting.invoices.approve` | Filing metadata, optional `filename`, optional SharePoint upload | `{ invoice, action?, sharePoint? }` | `invoice.filed`; legacy `filed` | Explicit upload failure preserves prior filing state without success audit/action; metadata warnings do not block completion; live SharePoint is `UNVERIFIED` locally |
| POST | `/api/invoices/:id/actions/:actionId/undo` | `accounting.invoices.approve` | Path ids | `{ invoice, undoneActionId, sharePoint? }`, `404 ACTION_NOT_FOUND`, `409 ALREADY_UNDONE/ACTION_NOT_UNDOABLE/STATE_CHANGED_SINCE_ACTION`, or `410 UNDO_WINDOW_EXPIRED` | `invoice.file_undo` for file undo | Local rollback; SharePoint delete by item id is best-effort and live Graph is `UNVERIFIED` locally |
| POST | `/api/invoices/:id/reconcile` | `accounting.invoices.approve` | No body | `{ invoice, action? }` | `invoice.reconciled` | Statements are shelved locally via `filed/filed_at`; no SharePoint path |
| POST | `/api/invoices/:id/unreconcile` | `accounting.invoices.approve` | No body | `{ invoice, action? }` | `invoice.unreconciled` | Restores reconcile and statement shelf fields from audit before-state |
| PATCH | `/api/invoices/:id/warranty-classification` | `accounting.invoices.approve` | Nonempty subset of `{ providerKind: nonempty string \| null, warrantyType: nonempty string \| null }` | `{ invoice }` with canonical `invoice.filing.providerKind` and `invoice.filing.warrantyType` | `document.warranty_classification_updated` | Locked full-object JSONB manual set/clear; clear reveals current computed fallback; classification is unchanged |
| POST | `/api/invoices/:id/statement-lines` | `accounting.invoices.approve` | `{ invoiceNumber, date, amount }` | `{ invoice, statementLines, addedLine }` | `document.statement_line_added`; legacy `statement-line-added` | Appends one manual JSONB line and runs injectable/local matching |
| POST | `/api/invoices/:id/statement-lines/:lineId/resolve` | `accounting.invoices.approve` | `{ resolutionType }` | `{ invoice, statementLines, updatedLine }` | `document.statement_line_resolved`; legacy `statement-line-resolved` | Persists line resolution metadata in JSONB |
| POST | `/api/invoices/:id/statement-lines/:lineId/unresolve` | `accounting.invoices.approve` | No body | `{ invoice, statementLines, updatedLine }` | `document.statement_line_unresolved`; legacy `statement-line-unresolved` | Clears line resolution metadata in JSONB |
| POST | `/api/invoices/:id/waiver-override` | `accounting.invoices.approve` | No body | `{ invoice, action?, waiverOverride }` | `document.waiver_override_set`; legacy `waiver-override-set` | Sets document-level waiver fields; approval validation accepts it |
| POST | `/api/invoices/:id/waiver-override/revert` | `accounting.invoices.approve` | No body | `{ invoice, action?, waiverOverride }` | `document.waiver_override_reverted`; legacy `waiver-override-reverted` | Clears document-level waiver fields; missing-waiver validation returns when no linked waiver exists |
| POST | `/api/invoices/:id/waiver-bypass` | `accounting.invoices.approve` | No body | `{ invoice, action? }` | `document.waiver_bypass_set`; legacy `waiver-bypass-set` | Sets only `waiver_bypassed = true` (+ at/by); persists across detection recomputes; does not alter pipeline-owned waiver status |
| POST | `/api/invoices/:id/waiver-bypass/revert` | `accounting.invoices.approve` | No body | `{ invoice, action? }` | `document.waiver_bypass_reverted`; legacy `waiver-bypass-reverted` | Sets only `waiver_bypassed = false` (clears at/by); the missing-waiver marker returns if still detected required and no other submit-gate satisfaction exists |
| PATCH | `/api/invoices/:id/coi-manual-values` | `accounting.invoices.coi_override` | `{ vendorCode?: string \| null, expirationDate?: string \| null }` | `{ manualValues, compliance }` | `document.coi_manual_values_updated` | Updates or clears only the supplied COI resolved values atomically with the audit event |
| GET | `/api/invoices/:id/waiver-recipient` | `accounting.invoices.request_waiver` | Path id | `{ recipientType, directEmail, candidates, cachedVendorEmail, emailFrom, reason }` | None | Resolves direct, parsed, or manual vendor-recipient flow; parses forwarded headers/body and consults `vendor_mappings.vendor_email` |
| POST | `/api/invoices/:id/request-waiver` | `accounting.invoices.request_waiver` | `{ resend?, recipientOverride? }` | `{ success, sentTo, requestedAt, invoice }`, `409` if already requested and `resend` not true, `422` when a blocked sender requires confirmation | `invoice.waiver_requested`; legacy `waiver-requested` | Sends the lien waiver request email as a Graph reply; validated overrides replace the draft recipient; the actual recipient is cached by `vendor_code`; audit records `sentTo` and `originalEmailFrom` |
| POST | `/api/rules` | `accounting.invoices.manage_rules` | Rule body; optional atomic `{ apply, scope, documentIds, includeScope, sourceDocumentId }` | `201 Rule`, or with `apply: true`, `{ rule, applied, sourceOutcome? }` | Rule creation and any applied document audits | `sourceOutcome` is returned only for the requested `sourceDocumentId`; it reports that document's `id`, whether it matched, and post-apply `status` |
| POST | `/api/splits/:id/confirm` | `accounting.invoices.manage_splits` | `{ groups, discardPages? }`; `docType` is an active kebab-case classification | `202 { parentId, childIds, backupChildId, discardedPages, status, message }` | `document.split_confirmed`; legacy `split` | Child rows/files are local; split worker spawn is best-effort |
| POST | `/api/documents/:id/upload-to-spectrum` | `accounting.invoices.submit_spectrum` | `{ vendorCode, expirationDate }` | `202 { status, documentId, vendorCode, expirationDate, attempt, queuePosition, message }` | `document.spectrum_upload_queued`, `document.spectrum_upload_retried`, `document.spectrum_upload_succeeded`, `document.spectrum_upload_failed` | Queues serialized Spectrum/PROIV COI upload; on success the document becomes `submitted` and persists canonical vendor/match metadata |

### Spectrum COI Upload

`POST /api/documents/:id/upload-to-spectrum` queues an asynchronous COI upload to Spectrum and returns `202 Accepted` immediately. The backend serializes work through one PROIV session, auto-creates the `COI [YYYY]` tracking code when missing, assigns the tracking item to the vendor with the requested expiration date, and uploads the PDF. On successful upload the document transitions to `submitted`, persists the requested `vendor_code`, and records canonical vendor-match metadata (`matched_vendor_name` when available, confidence `1`, method `coi-upload-confirmed`). Failed uploads can be retried by posting again after the document reaches `spectrum_upload_status = 'failed'`.

### COI overrides

`GET /api/invoices/:id` includes `coiOverrides`, the active persisted override rows for a COI document. `POST /api/invoices/:id/coi-overrides` requires `accounting.invoices.coi_override` and accepts `{ checkId, reason? }`; it returns `{ override, activeOverrides }`. `DELETE /api/invoices/:id/coi-overrides/:checkId` uses the same permission and returns `{ revokedOverride, activeOverrides }`. The server derives the raw check result and legacy singleton config identifier, requires a reason for a failing check, records append-only approval/revocation history, and emits `document.coi_override_applied` or `document.coi_override_revoked` atomically with the mutation.

### COI manual values

`PATCH /api/invoices/:id/coi-manual-values` requires `accounting.invoices.coi_override` and accepts one or both of `vendorCode` and `expirationDate`; a supplied `null` clears only that field. Non-null vendor codes are checked against the request-time server vendor reference (an injected lookup takes precedence); unknown codes return `422 UNKNOWN_VENDOR_CODE`, unavailable/malformed reference data returns `503 VENDOR_MASTER_UNAVAILABLE`, and invalid dates return `422 INVALID_EXPIRATION_DATE`. A successful response returns `{ manualValues, compliance }`: retained values include `{ value, setBy, setAt }`, take precedence over extracted values, and the mutation plus `document.coi_manual_values_updated` audit event commit atomically.

The transition to `queued` is an atomic conditional claim: only a current COI row with a local file and status `NULL` or `failed` can be claimed. Concurrent callers that lose the claim re-read the row and receive the existing `409` in-progress or already-uploaded response rather than enqueueing a second upload.

Document reads expose the status columns as `spectrumUploadStatus`, `spectrumUploadQueuedAt`, `spectrumUploadStartedAt`, `spectrumUploadCompletedAt`, `spectrumUploadError`, `spectrumUploadTransId`, `spectrumUploadTrackingCode`, `spectrumUploadVendorCode`, and `spectrumUploadAttempts`. `spectrumUploadError` is also mirrored to `lastSpectrumError` for existing Spectrum error UI compatibility.

Validation and conflict responses:

| Status | Code | Condition |
|---|---|---|
| 400 | — | Missing/invalid `vendorCode` or `expirationDate` |
| 404 | — | Document not found |
| 409 | `CLASSIFICATION_MISMATCH` | Document is not classified as `coi` |
| 409 | `NO_FILE` | Document has no local file |
| 409 | `ALREADY_IN_PROGRESS` | Upload is already queued or processing |
| 409 | `ALREADY_UPLOADED` | Upload already succeeded |

### Document Classifications
| Value | Meaning |
|-------|---------|
| `invoice` | Full extraction + vendor/subcontract matching |
| `receipt` | Receipt extraction with invoice-like matching; job matching may use extracted `jobRef` |
| `statement` | Vendor balance summary with document-derived vendor matching and parent invoice statement lines |
| `coi` | Certificate of Insurance with insured-name vendor matching |
| `w9` | W-9 tax form |
| `lien-waiver` | Lien waiver document |
| `building-permit` | Project document with job matching from project name/address |
| `change-order` | Change order document |
| `contract` | Contract or agreement |
| `other` | Unclassified, manual review |
| `no-attachment` | Email body only, no PDF |
| `error` | Processing error |

### Statement Attribute Sources

Statement documents persist period and balance sources in `documents.statement_attributes`. Document reads resolve each attribute in the canonical M-077 order: `manual`, then `extracted`, then `computed`; a cleared or absent manual value reveals the lower-priority source. `documents.amount` is never used as statement balance authority.

The response includes the resolved values at `invoice.extracted.statementPeriod` and `invoice.extracted.balance`, plus source-aware metadata:

```ts
invoice.statementAttributes = {
  statementPeriod: { value: string | null, source: "manual" | "extracted" | "computed" | null },
  balance: { value: number | null, source: "manual" | "extracted" | "computed" | null },
};
```

Legacy reads are pure: they do not backfill, recompute, or write `statement_attributes`.

### PATCH /api/invoices/:id/statement-attributes

Requires `accounting.invoices.approve`. The strict body accepts one or both of `statementPeriod` (`string | null`) and `balance` (finite number or numeric string, or `null`); an empty body, unknown key, empty period, or non-finite balance returns `422` before any database work. A non-null value is stored in the `manual` source with the acting user and timestamp. A `null` removes only that manual key and exposes the next M-077 source without changing `documents.amount`.

The service locks the statement row with `SELECT ... FOR UPDATE`, calculates one complete replacement `statement_attributes` object, and commits it with `document.statement_attributes_updated` in the same transaction. Its response is `{ invoice }`, using the canonical statement-attribute serialization. The audit before/after states include the retained manual slots and resolved sources, so a clear records both the removed manual value and the revealed lower-priority value.

### PATCH /api/invoices/:id/warranty-classification

Requires `accounting.invoices.approve`. The strict body accepts a nonempty subset of `providerKind` and `warrantyType`, each a non-empty string or `null`; unknown fields, empty bodies, empty strings, and non-string values return `422` before database work. A non-null value is stored as an attributed manual value with the acting user and timestamp. A `null` removes only that manual slot and exposes the current computed warranty classification.

The service locks the warranty row with `SELECT ... FOR UPDATE`, calculates one complete replacement `warranty_manual_values` object, and commits it with `document.warranty_classification_updated` in the same transaction. Its response is `{ invoice }` with canonical `invoice.filing.providerKind` and `invoice.filing.warrantyType`; it never changes `documents.classification`.

### Document Statuses
| Value | Meaning |
|-------|---------|
| `pending` | Awaiting Dana's review |
| `approved` | Dana approved, ready for submission |
| `modified` | Dana corrected and approved (triggers feedback) |
| `rejected` | Dana rejected |
| `discarded` | Dana discarded (non-invoice junk) |
| `submitted` | Sent to Spectrum successfully |
| `duplicate` | Flagged as duplicate |
| `reviewed` | Marked as reviewed (no status change) |

---

## Public Endpoints

> Safe for external consumers. Read-only.

---

### GET /api/invoices

List documents with filtering, pagination, and search.

**Query params:**
- `status`: `all` (default) or a supported invoice lifecycle value, including `pending`, `modified`, `approved`, `rejected`, `discarded`, `submitted`, `submitting`, `retry-pending`, `duplicate`, `reviewed`, `needs-split`, `split-processing`, and `split`. The established `documents` deep-link value remains accepted for compatibility.
- `page`: page number (default: 1)
- `limit`: items per page (default: 50, maximum: 200)
- `offset`: optional zero-based offset; when supplied it takes precedence over `page`
- `sort`: `date` | `vendor` | `amount` | `invoice` | `job` | `received` (default: `date`)
- `sortDir`: `asc` | `desc` (default: `asc`)
- `search`: text search across vendor name, vendor code, invoice number, job, description, email subject
- `classification`: filter by exact classification value
- `panel`: filter by effective panel group: `invoice` | `receipt` | `statement` | `coi` | `w9` | `lien-waiver` | `other`
- `filed`: `true` (Documents Shelf) | `false` (Invoice Queue) | omit for all
- `flagged`: `true` (only documents with an active review flag, `flagged_at IS NOT NULL`) | `false` (only un-flagged) | omit for all. This is the "needs attention" attention-flag (M-092), distinct from the legacy `flagged` ingestion split marker; it composes with `status`/`panel`/`filed`/`search`.
- `splitFrom`: filter by parent document ID
- `scope=global`: opt-in global text search. Requires a nonblank `search` value and returns matches across every lifecycle status, filed/shelved records, and Trash (including soft-deleted records). In this mode, `status`, `classification`, `panel`, `filed`, `flagged`, and `splitFrom` are deliberately ignored so a retained dashboard filter cannot narrow text results. Global-search rows add `isTrash: boolean`, the server-authoritative Trash membership marker; clients must label and restrict Trash rows accordingly.

List rows carry the attention-flag fields — `flaggedAt` (ISO timestamp; flag state is `flaggedAt !== null`), `flaggedBy`, and `flagReason` — alongside the other document fields, so the dashboard table can render the flag badge without a per-row detail fetch.

`panel` resolves each document through its classification association. A `custom_classifications.opens_as` mapping or built-in override takes precedence; canonical values map directly and legacy values such as `subcontract` or `warranty` normalize to `other`. Without an override, built-ins map as follows: `invoice`, `pay-application`, `purchase-order`, and `credit-memo` to `invoice`; `receipt`, `statement`, `coi`, `w9`, and `lien-waiver` to themselves; all unknown values, `building-permit`, and `other` to `other`. `classification` remains an exact filter, and when both filters are supplied both constraints apply. These list query keys are strict: unknown keys and invalid/out-of-range pagination values return `400` before the handler. `offset` is optional so an omitted offset preserves page-based navigation; an explicit offset takes precedence over `page`.

Every selected invoice sort appends `id` in the same direction as its requested primary sort. That makes offset pages stable when the selected sort value is tied.

**Response:**
```json
{
  "invoices": [...],
  "total": 292,
  "page": 1,
  "limit": 50,
  "pages": 6
}
```

---

### GET /api/invoices/:id/neighbors

Return the immediate previous and next document ids for the anchor `:id` within the SAME filtered, ordered queue `GET /api/invoices` produces — server-computed with keyset seeks, for the detail Previous/Next arrows and post-action auto-advance. Requires `accounting.invoices.view`.

**Query params:** the same filter and ordering vocabulary as `GET /api/invoices`, minus pagination (`page`/`limit`/`offset` are rejected by the strict schema):
- `status`: `pending` | `approved` | `rejected` | `submitted` | `all` (default: `all`); `pending` includes `pending` and `modified`
- `sort`: `date` | `vendor` | `amount` | `invoice` | `job` | `received` (default: `date`)
- `sortDir`: `asc` | `desc` (default: `asc`)
- `search`, `classification`, `panel`, `filed`, `flagged`, `splitFrom` — identical semantics to `GET /api/invoices`

**Ordering guarantee:** neighbors are computed against the EXACT ordering the list endpoint produces for the same params — same sort column, same direction, PostgreSQL's default NULL positioning (`ASC` → NULLS LAST, `DESC` → NULLS FIRST), and the same `id` tie-breaker. Walking `next` from the first list row reproduces the list order exactly.

**Anchor-out-of-set semantics (load-bearing):** the anchor row is resolved by `:id` regardless of whether it still matches the filter. `prev`/`next` are the rows immediately before/after the anchor's sort position among the rows that DO match the filter. So after an action moves a document out of the current filter (e.g. approving a doc while viewing `status=pending`), `next` still resolves to the next matching document after the (now-excluded) anchor's position — this is what powers auto-advance.

**Response:**
```json
{ "prev": "doc-1771376946553-v6q9", "next": "doc-1771376947001-a1b2", "position": 12, "total": 48 }
```
- `prev` / `next` are document ids, or `null` at the first/last position (or when no other row matches the filter).
- `position` — the anchor's 1-based rank within the filtered, ordered set ("N" in an "N of M" counter). Computed as the count of rows ordering strictly before the anchor + 1, using the SAME keyset comparison as `prev`/`next`, so it can never disagree with them. `null` when the anchor no longer matches the filter (its rank is undefined) — `total` is still returned.
- `total` — the count of rows matching the filter ("M"), using the same `WHERE` as the list.
- `404` if the anchor document does not exist (hard-deleted or unknown id).

The endpoint returns ids plus the position counter; fetch full rows via `GET /api/invoices/:id`. It does not paginate — two single-row keyset seeks plus two counts.

---

### GET /api/invoices/stats

Queue statistics.

**Query params:**
- `filed`: `true` | `false` | omit
- `panel`: effective panel group; allowed values and mapping match `GET /api/invoices`

**Response:**
```json
{
  "total": 314,
  "activeTotal": 266,
  "trashTotal": 31,
  "shelfTotal": 17,
  "globalTotal": 314,
  "pending": 178,
  "approved": 11,
  "rejected": 40,
  "submitted": 77,
  "skipped": 0,
  "discarded": 25,
  "duplicate": 1,
  "reviewed": 0,
  "errors": 5,
  "flaggedCount": 3,
  "todayProcessed": 0,
  "avgConfidence": 0.95,
  "amounts": {
    "pending": 1583314.72,
    "approved": 202239.22,
    "submitted": 790046.26,
    "total": 3624533.49
  }
}
```

Dashboard buckets are mutually exclusive: `pending` includes both underlying `pending` and `modified` documents, `activeTotal = pending + approved + submitted`, `trashTotal` is queue documents outside those active buckets plus soft-deleted documents, `shelfTotal` is non-deleted filed/shelved documents, and `globalTotal = activeTotal + trashTotal + shelfTotal`. `total` mirrors `globalTotal` for dashboard summary use. When `panel` is supplied, status counts, amounts, `trashTotal`, `shelfTotal`, `globalTotal`, and `total` are all scoped to that panel group.

`flaggedCount` is the number of documents with an active review flag (`flagged_at IS NOT NULL`) within the same non-deleted / `filed` / `panel` scope as the other scalar aggregates. It is a "needs attention" marker only and does not affect any dashboard bucket total.

---

### GET /api/invoices/trash

List soft-deleted documents and non-active, unfiled queue documents in Trash.

**Query params:**
- `limit`: items per response (default: 50, maximum: 200)
- `offset`: zero-based result offset (default: 0)
- `search`: optional case-insensitive text search across vendor name/code/matched vendor, invoice number, job number/match number, sender, subject, and description
- `panel`: effective panel group; allowed values and mapping match `GET /api/invoices`

**Response:** `{ invoices, total, limit, offset }`

---

### POST /api/invoices/:id/restore

Restore a document from Trash. Requires `accounting.invoices.delete`. `404` if the document is not found.

- **Soft-deleted row** (the normal case): clears `deleted_at`/`deleted_by`/`deletion_reason`, stamps `restored_at`/`restored_by`, and returns `{ restored: true, id, status }`.
- **Discarded row** (`status = 'discarded'`, not soft-deleted): the Trash view's Restore button also covers stranded discarded documents, so the request DELEGATES to the undiscard semantics (`POST /api/invoices/:id/undiscard`) — it does not duplicate them. If an undoable `invoice.discarded` event exists, the document is undiscarded (real undo — restored to its pre-discard status, `{ invoice, action }`). If the document was discarded outside the app and has no undo record, it returns `422 { code: "DISCARD_NOT_UNDOABLE" }` with the message "This document was discarded outside the app and has no undo record, so it cannot be restored from here." and the row is left unchanged.
- **Neither deleted nor discarded** (an active row): `409 "Invoice is not deleted"` (unchanged).

---

### GET /api/invoices/:id

Get a single document by ID. Returns the full document shape. For a COI document, the response additionally has `coiOverrides` and `compliance`:

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
    rawStatus: 'pass' | 'warn' | 'fail';
    effectiveStatus: 'pass' | 'warn' | 'fail';
    provenance: 'computed' | 'override';
    detail: string; required: boolean;
    code?: 'OVERRIDE_STALE';
  }>;
  coverageFailures: Array<{ coverageId: string; coverageLabel: string; limitLabel: string; value: number | null; minimum: number }>;
  expiration: Resolved<{ state: 'active' | 'expiring-soon' | 'expired' | 'unknown'; expirationDate: string | null; daysRemaining: number | null }>;
  vendorCode: Resolved<string | null>;
  uploadReady: boolean;
  blockers: Array<{ code: string; message: string }>;
}
```

`configVersion` and `configVersionId` currently carry the same selected config identifier. A persisted override whose `configVersionId` differs from the selected version remains in `coiOverrides`, but its check has `code: 'OVERRIDE_STALE'`, retains `effectiveStatus === rawStatus`, and does not apply the override. Non-COI details return `coiOverrides: []` and do not include `compliance`.

For statement documents, every `statementLines` entry adds server-derived `clear`. The detail also includes `reconcile: { blockers, counts: { total, clear, unresolved }, canReconcile, permittedActions }`. These values use the exact predicate enforced by `POST /api/invoices/:id/reconcile`: matched, Toolbox-only, or explicitly resolved lines are clear; an empty line set exposes the `statement-lines-empty` blocker. `permittedActions` includes `reconcile` only for callers with `accounting.invoices.approve` when the current state still needs reconciliation.

All document responses also expose additive filing values under `filing`. The backend uses one pure resolver with precedence `manual → extracted → matching → email` and returns `{ value, provenance, permittedActions, blockers }` for `vendor`, `job`, and `scope`; the `fileName` candidate remains `provenance: "computed"`. Warranty rows additionally expose `providerKind` and `warrantyType` in the same shape. These values are computed from current canonical sources on every read unless the additive `documents.warranty_manual_values` JSONB object contains an intact manual entry (`{ value, setBy, setAt }`), in which case that value wins with `provenance: "manual"`. Reads never persist computed classifications, and source/rematch changes do not overwrite manual entries; clearing an entry reveals the current computation. These values are reused by filename generation and SharePoint metadata stamping; historical `sharePointFilename` remains unchanged.

---

### GET /api/invoices/:id/file

Download the PDF/image file for a document. Streams the file with correct `Content-Type`.

Falls back to Box if local file is missing (requires Box credentials).

---

### GET /api/invoices/:id/pdf

Legacy PDF endpoint. Same behavior as `/file`.

---

### GET /api/invoices/:id/email

Email metadata and body for a document.

**Query params:**
- `raw=true`: returns raw HTML/text body instead of JSON

**Response:**
```json
{
  "from": "vendor@example.com",
  "subject": "Invoice #305",
  "receivedAt": "2026-02-17T21:37:40Z",
  "bodyPreview": "...",
  "body": "...",
  "bodyContentType": "html"
}
```

---

### GET /api/invoices/:id/audit

Audit trail for a document (all actions logged against it).

**Query params:** bounded `limit` and `offset` (default `50`/`0`, maximum limit `200`).

**Response:**
```json
[{
  "id": 42,
  "action": "approved",
  "actor": "dashboard",
  "changes": {"status": ["pending", "approved"]},
  "createdAt": "2026-02-18T10:00:00Z"
}]
```

---

### GET /api/invoices/:id/siblings

Documents from the same email (same `email_message_id`). Returns array of documents.

---

### GET /api/invoices/:id/linked

Documents linked to this invoice (child documents).

---

### GET /api/invoices/:id/waiver-suggestions

Lien waiver suggestions scored against this invoice.

**Response:**
```json
{
  "suggestions": [{
    "waiverId": "doc-xxx",
    "fileName": "waiver.pdf",
    "vendorCode": "ZPAL91",
    "jobNumber": "25-559",
    "amountWaived": 874.00,
    "matchScore": 95,
    "matchStrength": "strong",
    "tags": ["same-vendor", "amount-exact", "same-job"]
  }]
}
```

---

### GET /api/invoices/:id/waiver-panel

Combined suggestions + orphan waivers panel.

**Query params:** `vendor`, `job`, `search`, `limit`, `offset`

**Response:**
```json
{
  "invoiceId": "doc-xxx",
  "suggestions": [...],
  "orphans": [...],
  "totalOrphans": 12
}
```

---

### GET /api/invoices/:id/orphan-waivers

Unlinked lien waivers available for a specific invoice or pay application.
The server derives same-vendor priority from the target document; `q` searches
filename, vendor name/code, invoice number, job, amount, email sender, and
email subject. Results are filtered before deterministic pagination (10/page).

**Response:** `{ target, paired, waivers, total, page, limit }`, where
`paired` is the linked counterpart's server-supplied summary or `null`, with
exactly `id`, `fileName`, `vendorName`, `vendorCode`, `amount`,
`invoiceNumber`, `jobNumber`, and `status`. Candidate and target summaries
also include `receivedAt`.

---

### GET /api/vendors

Search Spectrum vendor list (cached JSON).

**Query params:**
- `search`: partial match on name or vendor code
- `limit`: max results (default: 50, maximum: 200)
- `offset`: zero-based result offset (default: 0)

**Response:** `[{"code": "ZPAL91", "name": "Palmetto Solutions LLC"}, ...]`

The cache is ordered by normalized vendor name and then vendor code before filtering and offset slicing.

---

### GET /api/vendors/refresh/status

Status of the last Spectrum data refresh.

**Response:**
```json
{
  "running": false,
  "lastRefresh": "2026-03-20T10:00:00Z",
  "lastResult": {"vendors": 1681, "jobs": 502, "subcontracts": 2408, "durationMs": 12000}
}
```

---

### GET /api/jobs

Search Spectrum job list (cached JSON).

**Query params:**
- `search`: partial match on job number, description, or address
- `status`: filter by status code (e.g., `A` = active)
- `limit`: max results (default: 50, maximum: 200)
- `offset`: zero-based result offset (default: 0)

**Response:**
```json
[{
  "number": "25-559",
  "description": "NPX",
  "address": "3301 Example Ridge Pkwy SE, Atlanta, GA",
  "status": "A",
  "pm": "CB"
}]
```

---

### GET /api/jobs/:jobNumber/folders

Live SharePoint folder tree for a job (two levels deep, folders only). Used to resolve a matched job's SharePoint root before the doc-panel DestinationPicker lazy-browses contents.

**Response:**
```json
{
  "jobNumber": "26-409",
  "jobFolder": "26-409 NPX",
  "folders": [
    { "id": "...", "name": "01 Contracts", "children": [{ "id": "...", "name": "Subcontracts", "children": [] }] }
  ]
}
```

`404` when no SharePoint folder exists for the job number.

---

### GET /api/jobs/sharepoint/folders

Authenticated lazy SharePoint folder browser. `path` is a drive-relative folder path; omit it or pass an empty string for the Projects drive root. Folder rows are navigable/selectable destinations. File rows are returned for display/opening context only.

**Query params:**
- `path`: drive-relative folder path

**Response:**
```json
{
  "path": "26-000/26-434 - Brightwater/03 Insurance",
  "folders": [
    { "id": "...", "name": "COIs", "hasChildren": null }
  ],
  "files": [
    { "id": "...", "name": "Existing COI.pdf", "webUrl": "https://..." }
  ]
}
```

`404` when the requested SharePoint path does not exist.

---

### GET /api/subcontracts

Filtered subcontract lookup (cached JSON).

**Query params:**
- `vendorCode`: filter by vendor code
- `jobNumber`: filter by job number
- `limit`: maximum results (default: 50, maximum: 200)
- `offset`: zero-based result offset (default: 0)

**Response:**
```json
[{
  "subcontractNumber": "25-559.12",
  "job": "25-559",
  "vendorCode": "ZPAL91",
  "vendor": "Palmetto Solutions LLC",
  "revContract": 12000,
  "totalBilled": 0,
  "totalPaid": 0,
  "unpaidBalance": 12000,
  "unbilled": 12000,
  "pctBilled": 0,
  "retPct": 0,
  "status": "Active",
  "phases": [{"phaseCode": "01", "costType": "S", "description": "...", "originalAmount": 12000, "amountBilled": 0}]
}]
```

---

### GET /api/routing-codes

Routing code lookup table. The `routing_codes` catalog always includes exactly one canonical AP default entry:

```json
{ "code": "D", "description": "AP Default Routing", "label": "D" }
```

This entry is served even when the upstream Spectrum cache omits `D`; duplicate or non-canonical upstream `D` rows are replaced. Refreshes include only routing headers with a matching active Spectrum operator and exclude the retired `JT` code; `pm_to_routing` is filtered to that same catalog. The response otherwise preserves the existing `routing_codes`, `pm_to_routing`, and optional `refreshed_at` shape.
Alias: `/api/backend/routing-codes`

---

### GET /api/phase-codes

Phase code lookup table.  
Alias: `/api/backend/phase-codes`

---

### GET /api/gl-accounts

Live GL account lookup — queries Spectrum SQL directly. Requires active SQL connection.  
Alias: `/api/backend/gl-accounts`

**Query params:**
- `type`: filter by account type (`E`=expense, `I`=income, `A`=asset, `L`=liability, `C`=capital)
- `costType`: filter by cost type (`S`=subcontract, etc.)
- `search`: partial match on code or description
- `limit`: maximum results (default: 50, maximum: 200)
- `offset`: zero-based result offset (default: 0)

**Response:** `[{"code": "5450", "description": "Subcontract Labor", "accountType": "E", "costType": "S"}]`

---

### GET /api/classifications

All document classification types (built-in + custom).

**Query params:** optional `include=associations`, established `status=all`, and bounded `limit`/`offset` (default `50`/`0`, maximum limit `200`).

**Response:**
```json
[{"name": "invoice", "label": "Invoice", "action": "extract-match", "builtIn": true,
  "opensAs": "invoice", "status": "active",
  "panel": {"surface": "invoice_workflow", "filterGroup": "invoice"}}, ...]
```

Each classification (built-in AND custom) carries an additive `panel` object with routing + dashboard-filter metadata derived from `opensAs`, so the frontend can route documents and build filter pills from the API instead of hardcoded tables. This is never null for any classification.
- `panel.surface`: `"invoice_workflow"` (when `opensAs === "invoice"`), `"generic_panel"` (when `opensAs === "other"`/absent), else `"document_panel"`.
- `panel.filterGroup`: the dashboard panel group the classification's documents appear under (equals `opensAs`; one of `invoice`, `receipt`, `statement`, `coi`, `w9`, `lien-waiver`, `other`).

All pre-existing fields (`name`, `label`, `action`, `builtIn`, `opensAs`, `status`, and custom `addedAt`/`updatedAt`/`updatedBy`) are unchanged — the `panel` field is purely additive. With `include=associations` the response is `{ classifications, availableAssociations }` and each `classifications[]` entry carries `panel`.

---

### GET /api/rules

List all automation rules.

Requires `invoices.manage_rules`.

**Response:** `{"rules": [...], "total": 5}`

Rules are ordered by `rule_order`, `created_at`, then `id`; the same stable order is used for active-rule evaluation when rule-order ties exist.

---

### GET /api/pipeline/status

**Response:**
```json
{
  "running": false,
  "lastRun": "2026-03-20T18:04:25Z",
  "lastResult": {"processed": 31, "queued": 33, "errors": 0}
}
```

---

### GET /api/pipeline/errors

Pipeline processing errors, ordered by `created_at DESC, id DESC`.

**Query params:**
- `resolved`: `true` | `false` | `all` (default: `false`)
- `limit`: maximum results (default: 50, maximum: 200)
- `offset`: zero-based result offset (default: 0)

---

### GET /api/ignore-rules

List all ignore rules.

---

### GET /api/health

System health check.

**Response:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "supabase": true,
  "spectrumSql": false,
  "lastPipelineRun": "2026-03-20T18:04:25Z",
  "pendingCount": 138,
  "version": "1.0.0"
}
```

---

### GET /api/lien-waivers/orphans

Unlinked filed lien waivers.

**Query params:** `vendorCode`, `jobNumber`, `search`, `limit`, `page`, `offset`; `limit` defaults to `50` and is capped at `200`, while `offset` defaults to `0` when used instead of `page`.

---

### GET /api/lien-waivers/:id/invoice-suggestions

Invoices that could match a given lien waiver (reverse lookup).

---

### GET /api/lien-waivers/:id/orphan-invoices

Unlinked invoice and pay-application candidates for a specific lien waiver.
The server derives same-vendor priority from the target waiver. Submitted,
submitting, discarded, and deleted documents are excluded before deterministic
pagination (10/page). Response is `{ target, paired, invoices, total, page,
limit }`, with the same document-summary envelope as the inverse endpoint;
`paired` is the linked counterpart summary or `null` with exactly `id`,
`fileName`, `vendorName`, `vendorCode`, `amount`, `invoiceNumber`,
`jobNumber`, and `status`.

---

## Write Endpoints

> Dashboard-only. Side effects: write to DB, trigger processes, modify state.

---

### PATCH /api/invoices/:id

When a PATCH changes `vendorCode` or `jobNumber` without an explicit
`subcontractNumber`, the response may include `subcontractDerivation`:
`{ method, subcontractNumber, options? }`. `options` is present for ambiguous
pairings; an explicit subcontract picker choice or clear remains authoritative.

Edit invoice fields. Only send changed fields.

Auto-records vendor/subcontract/job feedback when those fields change. Confirmed job corrections may populate `subject_job_mappings` (vendor + normalized subject) and `sender_job_mappings` (vendor + sender domain). Sender mappings begin with `hit_count = 1`; matching uses them only after at least two consistent corrections, and a job change resets the count to 1.

The additive `migrations/2026-07-09_job_feedback_mappings.sql` migration defines both job-feedback cache tables.

Auto-clears `submitError` on edit.

For a statement vendor change, the successful response remains the canonical `{ invoice, action, approvalVerdict }` envelope and adds `{ statementLines, statusChanges }`. `statementLines` is the complete canonical post-save array and `statusChanges` is produced by the server's vendor-scoped rematch; clearing a vendor leaves the lines unchanged and returns `statusChanges: []`.

**Body (all optional):**
```json
{
  "vendorCode": "ZPAL91",
  "jobNumber": "25-559",
  "subcontractNumber": "25-559.12",
  "amount": 874.00,
  "invoiceNumber": "305",
  "invoiceDate": "2026-02-15",
  "dueDate": "2026-03-17",
  "description": "Final clean",
  "vendorName": "Palmetto Solutions",
  "projectName": "NPX",
  "routingCode": "D",
  "phaseCode": "01",
  "costType": "S",
  "glAccount": "5450",
  "glDate": "2026-02-28",
  "lienWaiverRequired": false,
  "classification": "invoice",
  "displayName": "Custom display name"
}
```

`linkedLienWaiverId` is intentionally rejected here. Reciprocal waiver links
must be created or removed through the dedicated approve-gated link endpoints,
which own classification validation, row locking, shelf state, and audits.
While either side is linked, changing its classification through this endpoint
returns `409 { code: "WAIVER_LINKED_CLASSIFICATION_PROTECTED" }`.

`glDate` accepts a string or `null` and persists to the `gl_date` document column independently of `invoiceDate`.

---

### POST /api/invoices/:id/approve

Approve an invoice. Validates required fields per approval path.

**Approval paths:**
- **Path 1** (has job + subcontract + amount ≤ unbilled): Direct approval, auto-sets `routing_code = D`
- **Path 2** (has job, no subcontract or over budget): Requires `routing_code`
- **Path 3** (no job, SG&A): Minimal required fields

**Optional body overrides:**
```json
{"routingCode": "D", "phaseCode": "01", "costType": "S", "glAccount": "5450", "glDate": "2026-02-28"}
```

`invoiceDate` is not an approval override. For a closed-period suggestion, first
`PATCH /api/invoices/:id` with only the suggested `invoiceDate`, then submit a
separate approval request. The PATCH preserves status; an approve request that
contains `invoiceDate` returns `400` with code
`INVOICE_DATE_APPROVAL_OVERRIDE_UNSUPPORTED`. `glDate` remains an independent
approval override.

**Error response (400 if missing required fields):**
```json
{"error": "Missing required fields for approval", "details": {"missing": ["phase_code", "cost_type"], "path": "1"}}
```

If the waiver requirement is effective (`lien_waiver_required = true` AND `waiver_bypassed IS NOT TRUE`), approval also requires either `linkedLienWaiverId`/`linked_lien_waiver_id` or `waiverOnDocument`/`waiver_on_document = true`. A missing waiver returns `linked_lien_waiver_id` in `missing`; `POST /api/invoices/:id/waiver-override` satisfies this requirement until reverted, while `POST /api/invoices/:id/waiver-bypass` records a persistent human decision that no waiver is required for this invoice (serialized `lienWaiverRequired` is the EFFECTIVE value; the bypass itself is exposed as `waiverBypassed`/`waiverBypassedAt`/`waiverBypassedBy`).

#### Detail waiver-action authority

`GET /api/invoices/:id` and every successful waiver override/bypass mutation response include a caller-aware `waiverActions` envelope. Each of `request`, `resend`, `markOnDocument`, `clearOnDocument`, `bypass`, and `revertBypass` is `{ permitted: boolean, blockers: Array<{ code, message }> }`. The API computes permission and current persisted-state eligibility; clients render this canonical envelope and do not re-derive waiver control state. Mutation routes remain independently permission-gated and validate their state at write time.

#### Lien waiver gate (2026-07-14)

- **Detection is authoritative and automatic.** A DB trigger (`trg_lien_waiver_detection`) computes `lien_waiver_required` on every insert/update of `cost_type`, `job_match_number`, `phase_code`, or `classification`: required when `cost_type = 'S'`, a `job_match_number` is present, and `phase_code` is not in the exempt list (`01502`, `01503`, `01812`, `01850`, `01900`). Manual writes to the flag alone are preserved. The flag is a pure detection output — human bypass decisions live in `waiver_bypassed` (+ `_at`/`_by`) and survive trigger recomputes; the effective requirement everywhere is `lien_waiver_required AND NOT waiver_bypassed` (2026-08-06).
- **Spectrum submit is gated at claim time.** `claimInvoicesForSubmit` refuses to move a gated invoice to `submitting` unless a waiver is linked or the override is set. Unlinking a waiver after approval re-blocks submission automatically; the invoice stays `approved`.
- **Missing marker and submit gate are exact complements.** A document blocks submit (and receives the visible missing-waiver marker) iff `lien_waiver_required IS TRUE AND waiver_bypassed IS NOT TRUE AND linked_lien_waiver_id IS NULL AND lien_waiver_status IS DISTINCT FROM 'attached' AND waiver_on_document IS NOT TRUE`. The claim and preflight queries use the Boolean complement, including nullable pipeline state.
- **Bulk approve is guarded like single approve.** `POST /api/invoices/bulk` accepts `approve` only after each invoice is locked and passes the lien-waiver and multi-phase/PM-routing checks; only `pending`, `modified`, and `reviewed` invoices may transition to approved. Bulk reject remains unsupported and must be performed per-invoice.
- **Lien-waiver auto-linking.** When the pipeline ingests a document classified `lien-waiver`, it links only an unambiguous eligible invoice (waiver required, unlinked, active status). Tier one compares the waiver conversation ID against both an invoice's `email_conversation_id` (`waiver_link_source = 'email-thread'`) and `waiver_request_conversation_id` (`'request-thread'`). If tier one finds no match, tier two accepts exactly one requested invoice with the same vendor code and normalized base subject (`'subject-vendor'`), covering Graph replies whose conversation ID changed after a request-subject modification. Ambiguous thread/subject matches and multi-waiver bundles (>2 waiver pages) fall back to manual pairing suggestions. Unlink clears the source.
- **Grandfather clause.** Invoices approved before the gate went live were exempted via `waiver_on_document` with actor `grandfathered-pre-gate-2026-07-14`.
- **Response fields.** `waiverType`, `waiverRequestedAt`, `waiverRequestedBy`, `waiverLinkSource` are returned on invoice payloads; `waiverType` is PATCHable via `/api/invoices/:id`. `waiverType` is the PERSISTED `waiver_type` only — the backend never infers it from filename/subject; when unset it is `null`.
- **Explicit workflow state (M-022/23/24).** Every document response carries `pairingStatus`, `filingStatus`, `releaseStatus`, derived from persisted columns (for lien-waiver documents especially): `pairingStatus` = `"paired"` when `linked_lien_waiver_id` is set else `"unpaired"`; `filingStatus` = `"filed"` (filed with a SharePoint copy), `"shelved"` (filed, no SP copy), or `"unfiled"`; `releaseStatus` = `"released"` when `sp_file_url` is set OR `status === "submitted"`, else `"held"`. These replace the frontend's filename/subject inference.
- **Amount semantics.** On `PATCH /api/invoices/:id`, `amount` accepts a number, a numeric string, or `null` (clears). A non-numeric / NaN / non-finite value is rejected `422 { code: "INVALID_AMOUNT" }` with the row unchanged — never coerced or silently dropped.

---

### POST /api/invoices/:id/unapprove

Revert an `approved` or `modified` invoice back to `pending`.

---

### POST /api/invoices/:id/reject

```json
{"reason": "Duplicate invoice"}
```

---

### POST /api/invoices/:id/discard

```json
{"reason": "Marketing email, not an invoice"}
```

---

### POST /api/invoices/:id/review

Mark as reviewed (status → `reviewed`).

---

### POST /api/invoices/:id/flag

Flag a document for review ("needs attention"). Gated by `accounting.invoices.view_details`. Workflow-neutral — flagging never changes status and never affects approve/submit/file eligibility.

Body (optional):

```json
{ "reason": "Needs Dana's review" }
```

- `reason` (string, ≤500, optional): free-text note persisted to `flag_reason`.

Persists `flagged_at = NOW()`, `flagged_by = <acting user email>`, and `flag_reason`. Flag state is defined as `flagged_at IS NOT NULL` (there is no separate boolean for this flag; the legacy `flagged` field is an unrelated ingestion split marker). Columns added by migration `2026-07-17_document_flag_columns.sql`.

**Response:** `{ "invoice": {...}, "auditId": "<audit-event-id>" }`. The returned `invoice` exposes `flaggedAt`, `flaggedBy`, and `flagReason`. Audit event: `invoice.flagged` (undoable, with `before_state`/`after_state`).

### POST /api/invoices/:id/unflag

Remove a document's review flag. Gated by `accounting.invoices.view_details`. No body.

**Authorization is enforced at the service layer before the no-op check:** only the original flagger (`flagged_by` = acting user) or a holder of `accounting.invoices.manage_rules` may unflag. Any other caller receives `403 { code: "FLAG_UNFLAG_FORBIDDEN" }` and the row is unchanged, including when the document is already unflagged. An already-unflagged document is a no-op success only for an authorized original flagger or `manage_rules` holder.

Clears `flagged_at`, `flagged_by`, and `flag_reason`.

**Response:** `{ "invoice": {...} }`. Audit event: `invoice.unflagged` (undoable, with `before_state`/`after_state`).

---

### POST /api/invoices/:id/file

File a document (moves to the Documents Shelf). Body is optional; all fields
are filing metadata added 2026-07-01 (migration `2026-07-01_document_filing_metadata.sql`):

```json
{
  "destination": "04 Closeout / Warranties",
  "destinationAbsolute": "26-000/26-409 - Ferrotek Int. - Riverton/04 Closeout / Warranties",
  "filename": "LW Tidewater 06-24-26.pdf",
  "note": "Optional filing note",
  "holdReason": "Lien-waiver hold justification",
  "uploadToSharePoint": true
}
```

- `destination` (string, ≤500): SharePoint subfolder path relative to the job folder, persisted to `filed_destination`
- `destinationAbsolute` (string, ≤500): drive-relative folder path for direct uploads that bypass job folder resolution; sanitized to remove empty, `.`, and `..` path segments. An explicit empty string (`""`) selects the Projects drive root, even without a matched job, and takes precedence over `destination` or a previously stored folder. Omitted/null values leave the existing matched-job routing in place. Successful explicit-root filing persists `filed_destination = ""`, exposes `invoice.filedDestination = ""`, and records that exact value in the filing undo snapshot; only null means no stored destination.
- `filename` (string, ≤128): optional user filename override for the SharePoint copy. The server sanitizes it, preserves the source extension, and resolves collisions at upload time; it never renames the original local `file_name`. It is forwarded through both direct-destination and job-folder upload paths and recorded in the filing audit event.
- `note` (string, ≤2000): persisted to `filing_note`
- `holdReason` (string, ≤2000): persisted to `hold_reason` (lien waivers)
- `uploadToSharePoint` (bool): when `true`, upload the local file using the matched job and `destination`, or the explicit `destinationAbsolute` path without requiring a job. Upload failure (including missing source/job prerequisites) **does not file or modify the document**. The HTTP 200 response contains the unchanged canonical `invoice` plus `sharePoint: { uploaded: false, error }`, with no `action`, `invoice.filed` event, or legacy `filed` audit. An unfiled record remains unfiled across reload/remount and can retry; a record already shelved before this attempt retains that prior state and metadata. No client override is required. Statement documents ignore this flag and keep the reconcile/shelf-only behavior. Omitting or disabling the flag keeps local-only shelving unchanged.

Filing holds one document lock through the optional upload, recheck, and local update. A concurrent filing request waits for that transaction; if the first request files the document, the waiting request returns `409 { code: "ALREADY_FILED" }` and never uploads a second copy. If a guarded recheck follows a newly-created SharePoint item, the backend best-effort deletes only that item. A cleanup failure still returns the guarded `409`, with `{ uploaded: true, itemId, warning }` under `details.sharePoint` so an operator can remove the orphan; it never changes local state.

Every invoice response includes the canonical, pre-collision filing preview as `filing.fileName = { value, provenance: "computed", permittedActions: ["edit"], blockers: [] }`. Invoice candidates retain their established abbreviation; non-invoice candidates use a full human-readable classification label and are capped at 128 characters including extension. Successful SharePoint uploads persist `sp_file_url`, `sharepoint_item_id`, and the actual uploaded `sharepoint_filename` (including any collision suffix), and expose them on the returned `invoice` as `spFileUrl`, `sharePointItemId`, and `sharePointFilename`. Historical `sharepoint_filename` values are never regenerated or rewritten.

Post-upload metadata stamping is best-effort and keyed by Graph drive item id. The backend attempts to stamp `DocType`, `JobNumber`, `Vendor`, `DocDate`, `Amount`, `SourceEmail`, and `ToolboxId`. Metadata failure does **not** block local filing or the upload; it is returned as `sharePoint.warning`.

**Response:** `{ "invoice": {...}, "sharePoint": { "uploaded": true, "webUrl": "...", "itemId": "...", "filename": "INV Vendor 06-15-26.pdf" } }`
(`sharePoint.error` is set instead of `webUrl` when the upload fails; this response returns the unchanged invoice and no undo action. `sharePoint.warning` may be present when metadata stamping fails after a successful upload, which still completes filing.)

Footer/unified undo endpoint: the returned audit action points at `POST /api/invoices/:id/actions/:actionId/undo`. For `invoice.filed`, that endpoint is server-limited to 300 seconds from the audit event timestamp. Existing `/file` remains gated by `accounting.invoices.approve`; the legacy explicit `/unfile` endpoint is not routed publicly.

### POST /api/invoices/:id/actions/:actionId/undo

Unified footer undo for undoable actions. For `invoice.filed` actions only, the server enforces a 300-second window.

Expired file undo:

```json
{
  "error": "File undo window expired. Footer undo is available for five minutes after filing.",
  "code": "UNDO_WINDOW_EXPIRED",
  "details": {
    "actionId": "audit-event-id",
    "undoWindowSeconds": 300,
    "expiresAt": "2026-07-02T12:05:00.000Z"
  }
}
```

Status: `410 Gone`.

Other undo failure responses:

```json
{ "error": "Undo action not found", "code": "ACTION_NOT_FOUND" }
```

```json
{ "error": "Action already undone", "code": "ALREADY_UNDONE", "details": { "actionId": "audit-event-id" } }
```

```json
{ "error": "Action is not undoable", "code": "ACTION_NOT_UNDOABLE", "details": { "actionId": "audit-event-id" } }
```

```json
{
  "error": "Document was modified since your action. Undo is no longer safe.",
  "code": "STATE_CHANGED_SINCE_ACTION",
  "details": {
    "actionId": "audit-event-id",
    "staleFields": ["status"]
  }
}
```

Missing invoice returns `404` with `{ "error": "Invoice not found" }`. Missing action returns `404 ACTION_NOT_FOUND`; already-undone, non-undoable, and stale-state failures return `409`; expired file undo returns `410 UNDO_WINDOW_EXPIRED`.

In-window file undo reverts local filing metadata and attempts to delete the persisted SharePoint copy by `sharepoint_item_id`. Delete failure does not block the local rollback:

```json
{
  "invoice": {...},
  "undoneActionId": "audit-event-id",
  "sharePoint": {
    "deleted": false,
    "itemId": "01ABC...",
    "driveId": "b!EXAMPLE-DRIVE-ID",
    "warning": "Graph error message"
  }
}
```

The audit event for footer file undo is `invoice.file_undo` and carries `changes.mode = "footer_undo"`.

### POST /api/invoices/:id/reconcile

Mark a document reconciled (`reconciled = true`, `reconciled_at = NOW()`). No body. Requires `accounting.invoices.approve`. Idempotent. Statements require at least one line and require every line to be matched/in Toolbox or explicitly resolved; otherwise the endpoint returns `409` with `code: "STATEMENT_LINES_UNRESOLVED"` and `unresolvedLineIds`.

Statement documents also shelf locally on reconcile by setting `filed = true` and `filed_at = NOW()`. This is a local state transition only: statement reconcile does not call SharePoint filing, rename, metadata stamping, upload, or delete code paths.

**Response:** `{ "invoice": {...}, "action"?: {...} }`. Both a successful mutation and an idempotent no-op use the same canonical invoice envelope; a mutation includes the undoable audit action pointing at `/unreconcile`. The canonical statement `invoice` includes `statementLines[].clear` and `reconcile` as documented on the detail endpoint.

---

### POST /api/invoices/:id/unreconcile

Undo reconciliation. Requires `accounting.invoices.approve`. Uses undo-safety state checks (409 with `state_changed` if the row changed since the reconcile). For statement documents, unreconcile restores the `filed`/`filed_at` shelf fields captured before reconcile. Its successful mutation and idempotent no-op response use the same canonical `{ invoice, action? }` envelope as reconcile, including `invoice.reconcile` for statements.

---

### POST /api/invoices/:id/statement-lines

Append a manual line to a statement document. Requires `accounting.invoices.approve`. Request bodies are strict and require `invoiceNumber`, `date`, and `amount`; `date` may be `null` or a valid `YYYY-MM-DD` calendar date. Every successful statement-line mutation keeps its established `{ invoice, statementLines, ... }` siblings, with the canonical `invoice` carrying the same `statementLines[].clear` and caller-aware `reconcile` state as detail.

```json
{
  "invoiceNumber": "7552",
  "date": "2026-05-06",
  "amount": 32590.00
}
```

### POST /api/invoices/:id/statement-lines/:lineId/resolve

Persist a user's resolution of a statement discrepancy. Requires `accounting.invoices.approve`. Strict body: `{ "resolutionType": "accept_line" | "use_ap_amount" }`. The status determines the valid resolution: `not_received` uses `accept_line`; `amount_differs` uses `use_ap_amount`.

Returns `{ invoice, statementLines, updatedLine }` with `resolvedAt`, `resolutionType`, and `resolvedBy` persisted in JSONB. Emits `document.statement_line_resolved`.

### PATCH /api/invoices/:id/phase-allocations

Set or clear multi-phase allocations. Requires `accounting.invoices.view_details`. Body `{ allocations: [{ phase_code, amount, description? }] | null }` (`null` or `[]` clears). This is the server-authoritative chokepoint — the only writer of `phase_allocations` — and validates on a `FOR UPDATE` locked read inside a transaction: the row is unchanged unless the set is valid.

Validation (canonical): each line's `phase_code` must be a real phase on the matched subcontract and its `amount` a positive number; a phase may appear once; the allocation sum must equal the invoice total to the cent (mirrors the frontend's balanced rule — the backend value is canonical). An invalid set is rejected `422`:

```json
{
  "error": "Invalid phase allocation",
  "code": "INVALID_PHASE_ALLOCATION",
  "details": {
    "lines": [ { "line": 1, "phase_code": "01-100", "error": "Amount must be a positive number, got -100" } ],
    "total": "Sum of allocations ($800.00) must equal invoice total ($1000.00). Difference: $-200.00"
  }
}
```

`details.lines` lists every problematic line (empty when only the total is off); `details.total` is `null` when the sum is balanced. On success returns `{ id, subcontractNumber, invoiceTotal, allocationTotal, phaseAllocations, message }` and emits the `phase-allocations-set` / `phase-allocations-cleared` audit.

### POST /api/invoices/:id/statement-lines/:lineId/unresolve

Clear persisted resolution metadata. Requires `accounting.invoices.approve`; no body. Returns `{ invoice, statementLines, updatedLine }` and emits `document.statement_line_unresolved`.

The backend appends one `source: "manual"` line with a non-colliding `id`, runs the shared `matchStatementLine()` helper against Toolbox invoice data and any available Spectrum lookup, persists the full `statement_lines` array, and emits `document.statement_line_added` plus the legacy `statement-line-added` audit log entry.

**Response:**

```json
{
  "invoice": {...},
  "statementLines": [...],
  "addedLine": {
    "id": "7552-2",
    "invoiceNumber": "7552",
    "date": "2026-05-06",
    "amount": 32590.00,
    "status": "matched",
    "source": "manual"
  }
}
```

---

### POST /api/invoices/:id/reclassify

```json
{"classification": "statement"}
```

A linked document must be unlinked first; otherwise this endpoint returns
`409 { code: "WAIVER_LINKED_CLASSIFICATION_PROTECTED" }` without a write.

---

### POST /api/invoices/:id/retry

Retry an errored document (classification must be `error`).

---

### POST /api/invoices/:id/reprocess

Reprocess any document that has a stored local file, except documents in `submitted`, `submitting`, or `split-processing` status. The request does not change the document status. It records both legacy `reprocess_requested` and structured `document.reprocess_requested` events with the requesting user as actor, then starts the stored-file classifier/extractor/matcher worker. Worker completion remains the legacy `reprocessed` audit event attributed to `pipeline`.

Requires `accounting.invoices.view_details`. Missing stored files and protected statuses return `400` without audit or worker side effects. Child stdout and stderr append to `logs/pipeline.log`.

---

### POST /api/invoices/:id/link

Link or unlink a document to a parent.

```json
{"targetId": "doc-parent-id"}  // omit targetId to unlink
```

---

### POST /api/invoices/:id/link-waiver

Link a lien waiver to this invoice.

```json
{"waiverId": "doc-waiver-id"}
```

The server records links created through this endpoint with `source: "manual"`.
The invoice and waiver are linked reciprocally in one transaction. The waiver is
also shelved in that transaction (`filed = true`, preserving an existing
`filed_at` timestamp), so it leaves the active queue and appears in the document
shelf as soon as the link succeeds. The document's workflow `status` is not
rewritten by shelving.

Pipeline auto-links apply the same shelf transition. Unlinking clears the
waiver's shelf fields so the now-unpaired waiver returns to the active queue.
If the linked invoice is later submitted to Spectrum, the waiver's discard
transition also clears those shelf fields so it is available through Trash.
Historical already-linked waivers in a protected terminal status retain that
status and their shelf state; new links to those statuses are rejected.

If the invoice is already `approved`, the merged PDF is created immediately.

The target document is locked and must currently be classified as `lien-waiver` and not soft-deleted. A parent invoice already `submitted`, `submitting`, `split-processing`, or `discarded` returns `409 { code: "WAIVER_PARENT_STATUS_PROTECTED" }`; a waiver in one of those statuses returns `409 { code: "WAIVER_STATUS_PROTECTED" }`. A missing or soft-deleted invoice/target returns `404`; an existing target with another classification (or the same document as the invoice) returns `422` and creates no link or audit event.

---

### DELETE /api/invoices/:id/link-waiver

Unlink the lien waiver from this invoice. Deletes the merged PDF if it exists
and clears the waiver's automatic shelf state so it returns to the active queue.

---

### POST /api/invoices/:id/waiver-override

Set the waiver-on-document override for an invoice-like document. Requires `accounting.invoices.approve`.

Use this when the waiver is present on the document itself rather than linked as a separate `lien-waiver` document. The backend sets:

- `waiver_on_document = true`
- `waiver_on_document_at = NOW()`
- `waiver_on_document_by = <request actor email/name>`

When `lien_waiver_required = true`, approval validation treats either `linked_lien_waiver_id` or `waiver_on_document = true` as satisfying the waiver requirement. Reverting the override restores the missing-waiver validation failure.

**Response:**

```json
{
  "invoice": {
    "...": "...",
    "waiverOnDocument": true,
    "waiverOnDocumentAt": "2026-07-02T12:05:00.000Z",
    "waiverOnDocumentBy": "ap@example.com"
  },
  "action": {
    "actionId": "audit-event-id",
    "type": "waiver_override",
    "undoable": true,
    "undoEndpoint": "/api/invoices/doc-id/waiver-override/revert"
  },
  "waiverOverride": {
    "active": true,
    "at": "2026-07-02T12:05:00.000Z",
    "by": "ap@example.com"
  }
}
```

Audit: emits `document.waiver_override_set` with `target.type = "document"`. `emitInvoiceAuditEvent` now accepts `targetType`/`targetId` and defaults to the historical invoice target for existing callers; the waiver override uses the generalized document target because the override is stored on the document row, not a separate invoice aggregate.

---

### POST /api/invoices/:id/waiver-override/revert

Clear the waiver-on-document override. Requires `accounting.invoices.approve`.

Sets `waiver_on_document = false`, `waiver_on_document_at = NULL`, and `waiver_on_document_by = NULL`. Emits `document.waiver_override_reverted`.

---

### POST /api/invoices/:id/waiver-bypass

Record that no lien waiver is required for this invoice. Requires `accounting.invoices.approve`. No request body.

This action sets only `waiver_bypassed = true`, `waiver_bypassed_at`, `waiver_bypassed_by`, and `updated_at`; it never mutates `lien_waiver_required` (which remains a pure detection-trigger output), `lien_waiver_status`, `linked_lien_waiver_id`, or `waiver_on_document`. The bypass persists across detection-trigger recomputes (2026-08-06). It emits `document.waiver_bypass_set` and legacy action `waiver-bypass-set`, with an undoable action pointing to `/api/invoices/:id/waiver-bypass/revert`.

### POST /api/invoices/:id/waiver-bypass/revert

Restore the lien-waiver requirement. Requires `accounting.invoices.approve`. No request body.

This action sets only `waiver_bypassed = false` (clearing `waiver_bypassed_at`/`waiver_bypassed_by`) and `updated_at`. It emits `document.waiver_bypass_reverted` and legacy action `waiver-bypass-reverted`. If the document still detects as required and has no linked waiver, attached pipeline status, or waiver-on-document override, the missing-waiver marker returns automatically.

---

### DELETE /api/invoices/:id

Soft-delete the invoice by setting its deletion metadata. The row and file remain recoverable through the trash/restore workflow. Permanent removal from the database and disk is available only through `DELETE /api/invoices/:id/permanent`.

---

### POST /api/invoices/bulk

Bulk action on multiple documents.

```json
{"ids": ["doc-1", "doc-2"], "action": "approve"}
```

`action`: `approve` | `unapprove` | `discard` | `review` | `file`

**Response:** `{"updated": 2}`

Bulk approval skips ineligible invoices and returns their shared approval-validation details in `skippedInvoices`. Each entry always has `id` and `invoiceNumber` (which may be `null`), plus a skip reason (`error` or `reason`) and optional `code`. Missing-field approval skips add `missing` and `path`; multi-phase skips can add `subcontractNumber`, `nextAction`, and, when PM routing is required, `invoiceAmount`, `subcontractUnbilled`, and `overageAmount`.

For `discard` only, when every requested invoice is protected (`split-processing`, `submitting`, or `submitted`), the endpoint returns **409** with `updated: 0`, `skipped`, and `skippedInvoices`. A mixed selection remains a 200 response and reports its successful updates plus skipped details. Submitted invoices cannot be discarded; use the approved corrective workflow instead.

---

### POST /api/invoices/submit

Submit approved invoices to Spectrum Vendor Invoice Multi-Line API.

**Body:**
```json
{
  "ids": ["doc-1", "doc-2"],
  "overrides": {
    "doc-1": {"approval_status": "U", "routing_code": "CB", "gl_account": "5450", "phase_code": "01", "cost_type": "S"}
  }
}
```

- If `ids` omitted: submits all approved invoices where `submitError` is null
- If `ids` provided: submits those specific IDs (bypasses `submitError` filter — for resubmit)
- `overrides`: per-invoice field overrides (optional)

**Response:**
```json
{
  "success": true,
  "submitted": 2,
  "total": 2,
  "message": "2 invoices submitted to Spectrum",
  "spectrumStatus": 200,
  "results": [
    {"id": "doc-1", "success": true, "invoiceNumber": "305", "linkedDocs": 1, "waiverDiscard": "discarded"},
    {"id": "doc-2", "success": false, "error": "Invoice number exists in posted invoices", "invoiceNumber": "INV-007"}
  ]
}
```

**Notes:**
- `submitError` is set on the document when Spectrum rejects it
- Editing a rejected invoice auto-clears `submitError` to allow resubmit
- Linked docs (lien waivers) are marked `submitted` when their invoice succeeds
- A successful result includes `waiverDiscard`: `discarded`, `already_discarded`, `no_link`, `not_found`, `not_lien_waiver`, `link_changed`, `protected`, or `raced`. It records the local linked-lien-waiver cleanup outcome only; it does not alter Spectrum's result.
- For an ordinary invoice detail line, the Spectrum distribution GL resolves in this order: nonblank request override `gl_account`, nonblank persisted `gl_account`, then the served `approvalRules.json` `costTypeGlMap`. A phase-allocation line instead resolves its distribution GL solely from that allocation's `cost_type` through the served map; document-level override and persisted GL values do not replace allocation-level derivation. Neither path has a last-resort account.
- If any selected invoice or phase-allocation line has no resolvable GL, both single-ID and multi-ID requests reject the whole submission with **422** before the ordinary claim, Spectrum post, local write, or audit:
  ```json
  {
    "error": "Cannot submit: a GL account is required for every Spectrum distribution.",
    "code": "SPECTRUM_GL_ACCOUNT_UNRESOLVED",
    "details": {
      "unresolvedGlAccounts": [
        {
          "id": "doc-1",
          "invoiceNumber": "INV-007",
          "costType": "L",
          "allocationIndex": 0
        }
      ]
    }
  }
  ```
  `costType` may be `null`; `allocationIndex` is a zero-based optional field present only for an unresolved phase-allocation line.
- The same GL guard runs again on the rows returned by the atomic claim. If a concurrent edit makes a GL unresolvable between preflight and claim, the backend restores every claimed row to `approved`, performs no Spectrum post or audit, and returns the same 422. That race path has a transient `approved` → `submitting` → `approved` state change; the ordinary unresolved path performs no write.
- Startup stale-submit recovery only restores interrupted `submitting` rows, and `POST /api/invoices/:id/retry` only reprocesses classification errors. Neither dispatches a Spectrum invoice or bypasses this submit chokepoint; a later manual submission re-enters `POST /api/invoices/submit`.
- Before any invoice is claimed or posted, submission rejects `400` when a selected eligible document shares the same trimmed `vendorCode` and `invoiceNumber` with any other local document that is approved, submitting, or submitted. The response includes `details.duplicates: [{ vendorCode, invoiceNumber, documentIds, reason?, documents? }]`; `reason` is `already_submitted` or `batch_duplicate`, and each additive `documents` entry supplies `{ id, status, jobNumber, amount }`. These are additive to the legacy identity fields; resolve the approved duplicate locally and retry.
- This duplicate check is a preflight guard, not a database uniqueness constraint. A concurrent change between preflight and claim remains `UNVERIFIED` and needs server-side production-equivalent concurrency verification.
- Returned invoice results are matched only by `Vendor_Code` plus `Invoice_Number`, never by response position. Duplicate, unmatched, or malformed response entries are contained locally and are not applied to another invoice. Live confirmation that Spectrum returns this identity pair is `UNVERIFIED`.
- `UNVERIFIED` at G-1: after deploy, the product owner runs the `t23r` and `wuvf` cases without editing production rows, confirms unresolved GL returns this 422 with unchanged durable row state and no Spectrum/audit side effect, and confirms an ordinary resolvable invoice still submits successfully.

---

### POST /api/pipeline/run

Trigger a manual pipeline run. Returns immediately; pipeline runs in background.

**Response:** `{"status": "started"}`

Returns 409 if already running.

---

### POST /api/vendors/refresh

Trigger a Spectrum data refresh (vendors, jobs, subcontracts). Runs in background.

Requires an authenticated caller with `accounting.invoices.manage_settings` (or the admin role).

**Response:** `{"status": "started", "startedAt": "..."}`

---

### POST /api/feedback/vendor

```json
{"email": "admin@vendor.example", "vendorName": "Palmetto Solutions", "vendorCode": "ZPAL91"}
```

---

### POST /api/feedback/subcontract

```json
{"vendorCode": "ZPAL91", "jobNumber": "25-559", "subcontractNumber": "25-559.12"}
```

---

### POST /api/ignore-rules

```json
{"type": "sender", "value": "noreply@hardware-supplier.example", "reason": "Marketing emails"}
```

`type`: `sender` | `domain` | `classification`

---

### DELETE /api/ignore-rules/:id

---

### POST /api/classifications

Add a custom classification type.

```json
{"name": "pay-app", "label": "Pay Application", "action": "extract-match"}
```

`action`: `extract-match` | `view-only`

---

### POST /api/rules

Create an automation rule.

Requires `invoices.manage_rules`.

```json
{
  "name": "Auto-discard Home Depot receipts",
  "isActive": true,
  "stopOnMatch": false,
  "shared": true,
  "criteria": [{"field": "email_from", "operator": "contains", "values": ["hardware-supplier.example"]}],
  "actions": [{"type": "auto_discard"}]
}
```

Rule actions use `{ "type": string, "value"?: string, "clear"?: boolean }`. Existing value-based actions are unchanged. These setter actions may instead send `clear: true` to persist `NULL` in their mapped document field: `set_vendor`, `set_job`, `set_phase_code`, `set_gl_account`, `set_cost_type`, and `set_routing_code`. A clear action must omit `value`; a value-based setter must provide a nonempty value. `set_classification` is value-only and cannot be cleared because every document requires an active classification. Other action types reject `clear: true`.

```json
{"type": "set_phase_code", "clear": true}
```

Rule IDs are serialized as strings in every response (list, create, atomic create+apply). The rule primary key is a database integer; it always leaves the API as a string, and request paths that take a rule ID accept both a string and a number inbound.

**Atomic create-and-apply.** Sending `"apply": true` creates the rule and immediately applies it in ONE database transaction. If application fails after the rule row is inserted, the transaction rolls back and no orphaned rule remains. The scope selectors mirror `POST /api/rules/apply`:

```json
{
  "name": "Auto-code ACME",
  "criteria": [{"field": "vendor_name", "operator": "equals", "values": ["ACME"]}],
  "actions": [{"type": "set_gl_account", "value": "5000"}],
  "apply": true,
  "scope": "pending",
  "documentIds": ["doc-1"],
  "includeScope": true,
  "sourceDocumentId": "doc-1"
}
```

- Without `apply` (or `apply: false`), the response is `201` with the created rule (unchanged behavior).
- With `apply: true`, the response is `201 { "rule": Rule, "applied": { "matchedInvoices": number, "actionsApplied": number }, "sourceOutcome"?: { "id": string, "matched": boolean, "status": string | null } }`. `sourceOutcome` is present only when `sourceDocumentId` is supplied and reports that specific document's post-apply status; it is not inferred from aggregate action counts.
- `scope` (`all` | `pending` | `queue`, default `pending`), `documentIds`, and `includeScope` (default `true`) select the documents exactly as `POST /api/rules/apply` does; `includeScope: false` requires a nonempty `documentIds`.

---

### PATCH /api/rules/:id

Update an existing rule. Send only changed fields.

Requires `invoices.manage_rules`.

---

### DELETE /api/rules/:id

Requires `invoices.manage_rules`.

---

### PUT /api/rules/order

Reorder rules by ID array.

Requires `invoices.manage_rules`.

```json
{"ids": ["rule-1", "rule-3", "rule-2"]}
```

---

### POST /api/rules/apply

Apply rules to the existing broad scope, explicit documents, or their union. Explicit document IDs are intentional targets and are selected even when their status falls outside the broad scope. A document that belongs to both inputs is processed once.

Requires `accounting.invoices.manage_rules`.

```json
{
  "ruleIds": ["rule-1"],
  "scope": "pending",
  "documentIds": ["doc-current"],
  "includeScope": true
}
```

- `ruleIds` is optional; omitting it applies all active rules.
- `scope` is `all`, `pending`, or `queue` and defaults to `pending`. `queue` retains the same pending-document behavior as before.
- `documentIds` is optional and explicitly targets those documents regardless of status.
- `includeScope` defaults to `true`. When `true`, documents are the deduplicated union of `scope` and `documentIds`. When `false`, only `documentIds` are selected, and at least one ID is required.

**Response:**
```json
{"matchedInvoices": 5, "actionsApplied": 8, "errors": 0, "durationMs": 120}
```

---

### POST /api/pipeline/errors/:id/resolve

Mark a pipeline error as resolved.

---

### POST /api/pipeline/errors/:id/retry

Reset retry count for a pipeline error.

Requires an authenticated caller with `accounting.invoices.manage_settings` (or the admin role).

---

---

## Retention Settings

Manage document retention policies — how long documents are kept before PDFs and Box copies are purged.

---

### GET /api/retention

Returns all retention rules.

**Response:**
```json
[{
  "id": 1,
  "classification": "*",
  "status": "submitted",
  "retention_days": 30,
  "delete_pdf": true,
  "delete_box": true,
  "updated_at": "2026-03-23T20:24:10Z",
  "updated_by": "system",
  "appliesTo": "All classifications — status: submitted — after 30 days: PDFs deleted, Box copies removed"
}]
```

**Field notes:**
- `classification: "*"` = wildcard — applies to all document types. Specific rules override wildcards.
- `appliesTo` is a human-readable summary generated server-side.

---

### PUT /api/retention/:id

Update an existing retention rule.

Requires an authenticated caller with `accounting.invoices.manage_settings` (or the admin role).

**Body:**
```json
{"retention_days": 60, "delete_pdf": true, "delete_box": false}
```

**Validation:** `retention_days` must be >= 1.

**Response:** Updated rule object.

---

### POST /api/retention

Create a new retention rule.

Requires an authenticated caller with `accounting.invoices.manage_settings` (or the admin role).

**Body:**
```json
{"classification": "invoice", "status": "submitted", "retention_days": 45, "delete_pdf": true, "delete_box": true}
```

**Validation:** Rejects duplicates (same `classification` + `status` combination already exists).

**Response:** Created rule object.

---

### DELETE /api/retention/:id

Delete a retention rule.

Requires an authenticated caller with `accounting.invoices.manage_settings` (or the admin role).

**Restriction:** Wildcard (`*`) default rules cannot be deleted — returns `403`.

---

### GET /api/document-destinations

Serve the SharePoint destination catalog: the folder tree and the per-document-type default destination paths (previously hardcoded in the frontend). Requires `accounting.invoices.view_details`.

**Response:**
```json
{
  "rootLabel": "(Job root)",
  "tree": [
    { "id": "contracts", "name": "01 Contracts", "children": [
      { "id": "subcontracts", "name": "Subcontracts", "children": [] },
      { "id": "executed-agreements", "name": "Executed Agreements", "children": [] }
    ] }
  ],
  "defaults": {
    "subcontract": "01 Contracts / Subcontracts",
    "warranty": "04 Closeout / Warranties",
    "lien-waiver": "02 Financials / Lien Waivers",
    "other": "(Job root)"
  }
}
```

- `rootLabel` (string): the label representing the job root ("(Job root)").
- `tree` (array of `{ id, name, children[] }`): the 4-level folder tree; leaf nodes carry `children: []`. Order is meaningful (rendered top-to-bottom).
- `defaults` (object): the default destination path per document type — `subcontract`, `warranty`, `lien-waiver`, `other`. Path strings are `" / "`-joined folder names.

Returns `404 { code: "DESTINATIONS_NOT_CONFIGURED" }` if the catalog row is absent (before the seed migration is applied).

### PUT /api/document-destinations

Append a destination configuration version. Requires `accounting.invoices.manage_settings`. Body is the full config object above plus optional `effectiveFrom` (canonical ISO timestamp). Unknown keys or malformed nodes are rejected with `400 { error: "Validation failed", details }`; an invalid timestamp returns `422 { error, code: "INVALID_DOCUMENT_DESTINATIONS_CONFIG", details }` and appends no version. Writes allocate an immutable physical `id` and monotonically assigned `version`, and emit the `settings.document_destinations.updated` audit event in the same transaction with `before_state`/`after_state`. A write without `effectiveFrom` (or one effective at the server time) retains the legacy bare config response; a future-effective write returns `{ version, config }`, where `config` remains the currently effective destination catalog.

Destination configuration history is persisted append-only in
`document_destination_versions`. The migration backfills the legacy singleton
as physical version `v1`; effective selection is server-time based and ordered
by `effective_from DESC, created_at DESC, id DESC`. The legacy
`document_destinations` row remains available for compatibility while the
version-history route is introduced.

```ts
interface DocumentDestinationVersion {
  id: string;                 // immutable physical version id
  config: DocumentDestinationsConfig;
  effectiveFrom: string;     // ISO timestamp
  author: string;
  createdAt: string;         // ISO timestamp
}
```

### GET /api/document-destinations/versions

List immutable destination configuration history. Requires
`accounting.invoices.manage_settings`. Optional `limit` (1–200) and
nonnegative `offset` are clamped to safe bounds. Results are ordered by
`effectiveFrom DESC, createdAt DESC, id DESC`.

**Response:** `{ versions: DocumentDestinationVersion[], total, limit, offset }`

### GET /api/document-destinations/versions/:id

Return one immutable destination version by its physical `id`. Requires
`accounting.invoices.manage_settings`. Missing ids return
`404 { code: "DOCUMENT_DESTINATION_VERSION_NOT_FOUND" }`.

---

### GET /api/coi-config

Serve the NCG COI compliance configuration (certificate-holder identity + aliases, cancellation-notice minimum, coverage requirements, coverage-type aliases), previously hardcoded in the frontend. Requires `accounting.invoices.view_details`. The compliance engine remains client-side; only its config source is served here.

**Response:**
```json
{
  "certificateHolder": {
    "name": "Northwind Contracting Group Inc.",
    "nameAliases": ["northwind contracting group", "ncg"],
    "address": "500 Example Gateway, Suite 180, Springfield, GA 30000"
  },
  "cancellationNoticeMinimumDays": 30,
  "warnWindowDays": 30,
  "coverageRequirements": [
    { "type": "general-liability", "label": "Commercial General Liability", "required": true,
      "limits": [ { "key": "eachOccurrence", "label": "Each Occurrence", "minimum": 1000000 } ] }
  ],
  "coverageTypeAliases": { "cgl": "general-liability", "auto": "automobile" }
}
```

- `certificateHolder` (`{ name, nameAliases[], address }`), `cancellationNoticeMinimumDays` (integer days).
- `coverageRequirements` (array of `{ type, label, required, limits: [{ key, label, minimum }] }`); `minimum` is an integer dollar amount.
- `coverageTypeAliases` (`Record<string,string>`): normalized coverage-type key per raw alias.

Returns `404 { code: "COI_CONFIG_NOT_CONFIGURED" }` before the seed migration is applied.

### PUT /api/coi-config

Replace the COI compliance config. Requires `accounting.invoices.manage_settings`. Body is the full config object above plus optional ISO `effectiveFrom`; `warnWindowDays` defaults to 30. A malformed config is rejected with `422 { error, code: "INVALID_COI_CONFIG", details }` and appends no history row. An immediate write returns the bare persisted config; a future-effective write returns `{ version, config }`, where `config` remains the currently effective configuration. Both emit `settings.coi_config.updated`.

### GET /api/coi-config/versions

Requires `accounting.invoices.manage_settings`. Optional `limit` (1–200) and nonnegative `offset` return `{ versions, total, limit, offset }`. Versions are ordered by `effectiveFrom DESC, createdAt DESC, id DESC`; each entry is `{ id, config, effectiveFrom, author, createdAt }`.

### GET /api/coi-config/versions/:id

Requires `accounting.invoices.manage_settings`. Returns the same version entry or `404 { code: "COI_CONFIG_VERSION_NOT_FOUND" }`.

---

### GET /api/rule-options

Composite catalog for the automation-rule builder. Requires `accounting.invoices.view_details`. The `actions`, `fields`, and `operators` sets are the SAME backend definitions rule validation uses (`lib/ruleCatalog.js`), so serving and validation cannot drift.

**Response:**
```json
{
  "actions":   [ { "value": "auto_approve", "label": "Auto-approve" } ],
  "fields":    [ { "value": "vendor_name", "label": "Vendor Name" } ],
  "operators": [ { "value": "contains", "label": "Contains" } ],
  "statuses":  [ { "value": "pending", "label": "Pending" } ]
}
```

Each array is a list of `{ value, label }` option pairs. `actions` (14), `fields` (10), and `operators` (13) mirror `ruleActionSchema`/`ruleCriterionSchema`; `statuses` (8) are the status values the builder offers for the `status` criterion field. (The legacy `greater_than`/`less_than` operators — never implemented by the rules engine — are not part of the catalog.)

### GET /api/cost-types

Spectrum cost-type reference catalog (code/label option list), served alongside the GL-accounts family. Requires `accounting.invoices.view_details`. Option list only — cost-type default derivation is owned elsewhere.

**Response:** `{ "costTypes": [ { "value": "S", "label": "S - Subcontract" }, ... ] }` (6 entries: S, M, L, O, E, B).

---

### GET /api/validate-approval/:id

The complete server-authoritative approval/coding verdict for a document, composed entirely from the single-source backend services — the client needs no derivation of its own. Requires `accounting.invoices.view_details`. Returns `404` if the document is not found.

Successful `PATCH /api/invoices/:id` responses add this same object as `approvalVerdict` beside their existing `invoice` and `action` fields. The PATCH verdict is composed from the post-commit saved row through `buildApprovalState(row, { invoiceId, log })`.

**Response:**
```json
{
  "path": "1",
  "requiredFields": ["invoice_number", "vendor_code", "invoice_date", "gl_date", "amount", "job_match_number", "phase_code", "cost_type", "gl_account"],
  "blockers": [],
  "unbilledBalance": 1000,
  "asOf": "2026-07-18T00:00:00.000Z",
  "codingDefaults": { "glAccount": "5450", "costType": "S", "phaseCode": "01-100", "routingCode": "D", "glDate": "2026-07-02" },
  "suggestedRoutingCode": null,
  "suggestedRoutingPm": null
}
```

Per-field provenance (all backend single-source; nothing re-derived in the route):
- `path` (`"1"|"2"|"3"`) and `requiredFields` — `approvalValidator.validateApproval` (path 1 = job+subcontract within budget; path 2 = job-only or over-budget; path 3 = no job). `requiredFields` is `approvalRules.json` `paths[path].required`; when `multi_phase_candidate === true` AND `phase_allocations` is set, the `multiPhaseOverrides.skipFields` (`phase_code`, `cost_type`) are removed — i.e. `required.filter(f => !skipFields.includes(f))` — because each allocation row carries its own phase/cost type. A multi-phase candidate with `phase_allocations` still `null` keeps requiring those fields and surfaces the `MULTI_PHASE_ALLOCATION_REQUIRED` blocker.
- `blockers` — human-readable list from `approvalValidator.validateApprovalEligibility`, the SAME gate `POST /api/invoices/:id/approve` and bulk approve reject with. Empty means the mutations would allow approval. Never invented, never omitted.
- `unbilledBalance` (`number | null`) — the matched subcontract's unbilled balance from the subcontract sidecar; `null` when there is no subcontract.
- `asOf` — server timestamp of computation.
- `codingDefaults` — `{ glAccount, costType, phaseCode, routingCode, glDate }`, the single frontend-visible coding-default source. Advisory pre-fill hints (NOT persisted state); policy values come from `approvalRules.json` `codingDefaults` (no code literals), served additively by `GET /api/approval-schema`. Precedence is always the row/trigger value first, then the configured default. `costType` — row value, else subcontract → `"S"` (consistent with the unchanged `trg_default_cost_type` trigger), else the non-subcontract default `"M"`. `glAccount` — row value, else subcontract → `"5450"`, else `"5300"`. `routingCode` falls back to the path's auto-routing default (`"D"` for paths 1/3). `glDate` defaults to `invoice_date`.
- `suggestedRoutingCode` / `suggestedRoutingPm` — from `phaseOptionsService` (PM→routing sidecar); non-null only when the invoice exceeds the subcontract unbilled and a job PM is resolved.

---

### Business Logic

- **Pending invoices never auto-purge.** There is intentionally no rule for `invoice` + `pending`. The purge script enforces this as a hard safety rule regardless of database state.
- Specific rules (e.g., `coi` + `pending`) override wildcard rules (e.g., `*` + `pending`).
- The purge script runs on a scheduled cron — it evaluates all rules and deletes matching documents that have exceeded their `retention_days`.

**Default retention policies:**

| Classification | Status | Days | Delete PDF | Delete Box |
|---|---|---|---|---|
| `*` (all) | `submitted` | 30 | ✅ | ✅ |
| `*` (all) | `discarded` | 7 | ✅ | ✅ |
| `*` (all) | `rejected` | 14 | ✅ | ✅ |
| `coi` | `pending` | 30 | ✅ | ✅ |
| `w9` | `pending` | 30 | ✅ | ✅ |
| `receipt` | `pending` | 30 | ✅ | ✅ |
| `statement` | `pending` | 30 | ✅ | ✅ |
| `other` | `pending` | 30 | ✅ | ✅ |

---

## Splits API (Multi-Page PDF Review)

See `docs/specs/2026-04-08-multi-page-split-review.md` for full spec.

Multi-page PDFs with multiple distinct invoice numbers are flagged with
`status = 'needs-split'` and held for user review via the frontend.

| Method | Path | Purpose |
|---|---|---|
| GET    | `/api/splits/queue` | List needs-split docs (paginated) |
| GET    | `/api/splits/:id` | Get a single needs-split doc with Haiku suggestion |
| GET    | `/api/splits/:id/pdf` | Stream the original multi-page PDF |
| GET    | `/api/splits/:id/page/:n/preview?width=300` | PNG thumbnail of a specific page |
| POST   | `/api/splits/:id/confirm` | Create child docs from user-confirmed groups → `202 Accepted` |
| POST   | `/api/splits/:id/cancel` | Revert to single-doc processing (status → pending) |
| POST   | `/api/splits/:id/reject` | Discard entire PDF (status → discarded) |
| GET    | `/api/splits/child/:id/status` | Poll a child doc's async processing state |

`POST /api/splits/:id/confirm` requires `accounting.invoices.manage_splits`. Each group `docType` is optional; when provided, it must be an active classification name from the same merged built-in/custom classification list returned by `/api/classifications`. Child documents keep the existing reprocess queue behavior: rows are inserted with `queued_at = NOW()`, `updated_at = NOW()`, and `created_at = NOW()`, then the split worker is spawned to classify/extract the children. The endpoint emits `document.split_confirmed` on the parent document.

`GET /api/splits/queue` defaults to `sort=received`, `sortDir=desc`, `limit=50`, and `offset=0`; it rejects unknown or invalid query values. Every queue sort appends `id` in the selected direction so tied rows do not drift between offset pages.

**New document statuses:**
- `needs-split` — multi-page PDF waiting for user to confirm split layout
- `split-processing` — child doc created but not yet classified/extracted (transient)
- `split` — parent doc after successful split (terminal; children reference via `splitFrom`)

**New column:** `documents.split_suggestion` (JSONB) — Haiku's per-page analysis and
suggested groups, used to pre-populate the review UI.

---

## Notes

COI detail and override responses include a server-owned, version-stamped compliance result. It resolves manual values before extracted values, reports unknown without fabricating values, applies configured coverage/holder requirements, uses server time with `warnWindowDays` (default 30), and marks stale persisted overrides `OVERRIDE_STALE`.

- Port: `INVOICE_SERVER_PORT` env var (default: `3456`)
- Spectrum data (vendors, jobs, subcontracts) cached as JSON in `data/`, refreshed by cron
- GL account lookups hit Spectrum SQL directly — require active connection
- All writes logged to `audit_log` table in Supabase
- `submitError` field on documents: set when Spectrum rejects; cleared on edit or successful resubmit

### Document collaboration: comments and activity

The collaboration handlers are shared across the two route families required by
the callers: `/api/invoices/:id/{comments,activity,...}` for the invoice
workflow surface and `/api/documents/:id/{comments,activity,...}` for the eight
non-invoice surfaces (receipt, statement, COI, W-9, lien waiver, subcontract,
warranty, and other). `opensAs: "invoice"` selects the invoice family; every
other supported or custom `opensAs` value selects the document family. Both
families return the same envelopes and use the same service and permission
boundaries.
The three collaboration paths are therefore available as `POST
/api/invoices/:id/comments` and `/api/documents/:id/comments`, `GET
/api/invoices/:id/activity` and `/api/documents/:id/activity`, and `POST
/api/invoices/:id/activity/view` and `/api/documents/:id/activity/view`.

`POST /api/invoices/:id/comments` requires `accounting.invoices.view_details`.
Strict body `{ "body": "plain text" }` is trimmed and must contain 1–2000
characters. Actor fields and unknown keys are rejected (400); identity comes
only from the authenticated request. Returns **201**:

```json
{"comment":{"kind":"comment","id":"uuid","documentId":"doc-id","body":"plain text","timestamp":"2026-09-15T12:00:00.000Z","actor":{"userId":"user-id","name":"Display Name","role":"ap","azureId":"azure-id","avatarUrl":"https://..."}}}
```

The immutable comment and body-free `invoice.commented` provenance commit in
one transaction. No legacy `audit_log` comment is written. The response actor is
resolved from `toolbox_users` by stored platform ID, with legacy email used only
as a lookup fallback; it returns the canonical platform ID, name, role, Azure ID,
and stored avatar URL. `actor.azureId` and `actor.avatarUrl` are nullable for
unresolved or external actors. An unresolved internal actor is named exactly
`Former user` and has `userId`, `azureId`, and `avatarUrl` set to `null`; existing
rows are untouched.
Comments remain available on locked/discarded viewable documents. Missing
resource: 404; missing permission: 403. Unexpected persistence failures: 500
with generic error and no comment content in logs. No edit/delete API exists;
permanent document deletion cascades comments through their foreign key.

`GET /api/invoices/:id/activity` uses the same permission, validated resource
ID and strict `limit` (1–200, default 50) / `offset` (default 0) query. Returns
`{ entries, pagination: { limit, offset, total, hasMore } }`. Each entry is
`{ kind: "comment", ...comment }` above or `{ kind: "event", ...AuditEvent }`.
Event entries additionally include the optional request-scoped
`documentClassification: string | null`, sourced once from the requested document;
comment and email entries never include it. All entries include additive
`actor: { userId, name, role, azureId, avatarUrl }` and event entries retain original
`changes`. Comments, audit events, and confirmed outbound email actors resolve
to the current canonical `toolbox_users` identity by platform ID, Azure AD ID, then
normalized email fallback. Matched actors receive the canonical display name and
`avatarUrl: "/api/users/<azure_id>/photo"` using the Azure AD ID (not the platform
UUID). Unresolvable internal actors retain their stored name and fields. Vendor
inbound mail, NDR facts, and System provenance remain external actors with null
platform identity and photo fields. The nullable `actor.azureId` and `actor.avatarUrl`
fields are present as `null` when unresolved or external; clients must not derive
either from an email address.
One SQL snapshot merges sources before pagination, ordered by timestamp DESC,
id DESC, kind DESC (collision tie-breaker). Totals remain truthful even past
the last page; `invoice.commented` is excluded to avoid a second visible row.
After deserialization, one batched directory lookup per page resolves non-system,
non-external actor identifiers by platform ID, then Azure AD ID, then normalized
email. A match replaces the stored display name with `toolbox_users.name` and
adds `avatarUrl: "/api/users/<azure_id>/photo"`; the proxy path always uses the
Azure AD ID, never the platform UUID. Unmatched, system, and external actors
retain their stored fields and receive no platform avatar fields. This read-time
projection is shared by both invoice and document activity routes and never
performs per-entry directory queries.
The feed also includes inbound email metadata and confirmed outbound email metadata
from document_email_messages. Email entries never expose full message bodies; inbound
entries may include server-sanitized allowlisted `sanitizedBodyHtml`. Their display
timestamp is received_at/sent_at while unread classification uses server created_at.
Missing documents return 404. `GET /api/invoices/:id/audit` remains unchanged.
Activity GET is read-only and does not advance the shared unread cutoff.

Inbound mailbox replies are diverted before attachment download and normal
pipeline ingestion. A confirmed outbound `internet_message_id` in
`References`/`In-Reply-To` is an exact tier-zero match; a conversation match is
used only when it resolves to one document (or one split-parent root).
Ambiguous matches are held as review rows with explicit correlation state and
reason; they never fall through to attachment download or normal ingestion.
Unverified matches never guess between documents. Matched inbound messages are retained as metadata with a <=200-character preview and
server-sanitized allowlisted HTML; attachments are flagged for review and are
never auto-ingested. Automatic replies are dropped, while NDRs are retained as
`ndr` facts. Replays are deduplicated by inbound internet message identity.
The historical email-table migration remains unchanged after acceptance;
`2026-09-17_document_email_correlation.sql` adds correlation state and the
idempotent inbound replay index for deployments that already applied it.

### Inbound attachment review and promotion

The authenticated attachment-review routes use `accounting.invoices.view_details`
and require the attachment to belong to an inbound message already correlated to
the requested document. `GET /api/documents/:id/inbound-attachments` returns file
attachment identity and safe metadata only; item attachments are excluded.
`GET /api/documents/:id/inbound-attachments/:attachmentId/preview` streams the
source content inline, while the corresponding `/download` route streams it as a
download. Missing or deleted mailbox content returns `410` with code
`INBOUND_SOURCE_UNAVAILABLE`; an attachment ID from another message is never
accepted.

`POST /api/documents/:id/inbound-attachments/:attachmentId/promote` accepts an
empty body and returns `201` with `{ promoted, duplicate, documentId,
sourceDocumentId, sourceEmailMessageId }`. It runs the normal classifier,
extraction, matching, and document insert path against a temporary copy of the
mailbox bytes. The source document/file and inbound message body are never
modified; the resulting document stores source document, inbound message-row,
and attachment identity provenance. A unique promotion guard makes retries and
concurrent requests return the same resulting document, while a failed
classification/insert rolls back the reservation and remains retryable.
Ambiguous, unmatched, and NDR messages are held or rejected and cannot be
promoted; automatic replies remain dropped by the inbound diversion path. A
successful promotion marks the inbound attachment reviewed and emits additive
`invoice.inbound_attachment_promoted` plus legacy `audit_log` provenance with the
authenticated actor identity. Migration `2026-09-18_document_inbound_promotions.sql`
adds the provenance columns and guard table; its rollback removes only those
additive objects.

POST /api/invoices/:id/activity/view requires the same permission and an empty body.
It returns documentId, priorActivityViewedAt (the cutoff before this view),
activityViewedAt (the new server clock cutoff), unreadReplies, and unreadComments.
The server locks the document row, advances the cutoff atomically, and bulk-sets
read_at only for inbound email rows committed at or before the new cutoff. A later
comment or inbound message remains unread even if its display/received timestamp is
older. The endpoint never accepts a client timestamp; GET and prefetch requests do
not mutate read state.

Invoice list and detail responses add unreadReplies and unreadComments. These counts
are comment and inbound-kind email arrivals newer than activityViewedAt, or all such
server arrivals before the first view. Confirmed outbound email appears in Activity
but never contributes to unread counts. List counts use scalar projections, so each
document remains one row and existing pagination/order are preserved.

New intake emits `invoice.intake` with `{ from, subject, receivedAt }` email
metadata and System/pipeline actor in the ingestion transaction; no backfill.
Reclassification adds `invoice.reclassified` with a classification pair and
request actor inside its state transaction. Existing legacy audit writes remain.
Invoice audit wrapper writes now resolve display names; platform audit writes
and direct pipeline/system events retain their existing identity behavior.

Migration `2026-09-16_document_comments.sql` adds the table, index and RLS;
its CHECK constraint intentionally routes it to manual-review/mark-applied in
the existing migration runner. It has not been applied. Rollback is documented
in the SQL and requires owner approval because dropping the table loses comments.

Migration `2026-09-16_document_read_state.sql` adds the shared cutoff, server-arrival
defaults and inbound unread index. It is classified manual-review/mark-applied and
has not been applied; rollback requires owner approval.

## Document collaboration email (Stage 2)

All three routes are authenticated and require `accounting.invoices.request_waiver`.
Each route is available under both `/api/invoices/:id/...` and
`/api/documents/:id/...`; the aliases call the same email service and preserve
the same success and canonical error envelopes.
The server resolves actor identity and directory recipients; client actor fields and `attachPdf` are rejected.

| Route | Request | Success |
|---|---|---|
| POST `/api/documents/:id/reply` | `{body: string(1..5000), recipient?: email}`; UUID `X-Send-Token` header | 200 `{ok:true,sentTo:string}` |
| GET `/api/documents/:id/reply-recipient` | no query fields | 200 `{recipientType,directEmail,candidates,directoryContacts,reason}` |
| POST `/api/documents/:id/forward` | `{recipients: UUID[1..10],body:string(0..5000)}`; same header | 200 `{ok:true,sentTo:string[]}` |
| GET `/api/documents/:id/forward-defaults` | no query fields | 200 `{defaultRecipients:[{userId,name,email}]}` |

Reply requires the original thread (409 `EMAIL_NO_THREAD`) and validates the original sender
(422 `EMAIL_INVALID_SENDER`). A verified vendor sender is prefilled directly. A blocked or
unrecognized sender returns a recipient picker; the reply must name one of its candidates
(422 `EMAIL_RECIPIENT_SELECTION_REQUIRED`). The picker ranks confirmed thread-history addresses
before body-parsed, cached vendor, and directory contacts. Replies never fall back to a fresh message.
Forward recipient IDs identify active internal Azure directory employees; invalid/empty/external
recipients return400. Defaults select exactly one directory display-name match to the job's PM;
missing job/PM or collisions produce an empty array. Existing routing fallback is not used.
Both send from the AP mailbox and set replyTo there. Notes and Line Items remain untouched.

A readable document file is checked before draft creation (422 `EMAIL_FILE_UNAVAILABLE`).
Files <=3*1024*1024 bytes attach automatically. Larger files omit the attachment and add an
omission note; Forward also includes `${APP_BASE_URL}/accounting/documents/:id`, Reply has no
inaccessible vendor deep link. All user/context text is HTML escaped; the original reply quote survives.

Persistent per-actor reservations serialize token checks, 10/minute and configurable100/day caps
(429 `EMAIL_SEND_LIMIT`). Daily boundaries use configurable `EMAIL_CAP_TIME_ZONE`, default
America/New_York. Same UUID within60s returns409 `EMAIL_SEND_DUPLICATE`; pending/ambiguous
attempts retain that token block beyond60s. A deliberately new token permits legitimate later mail;
clients must never automatically mint one to retry an uncertain attempt.

`EMAIL_SEND_DISABLED=true` returns503 `{error:"email_sends_disabled"}`. Config declarations:
`INVOICE_MAILBOX`, `APP_BASE_URL`, `EMAIL_INTERNAL_DOMAINS` (default northwindcg.example),
`EMAIL_DAILY_CAP` (100), `EMAIL_CAP_TIME_ZONE` (America/New_York). No deployment settings changed.

Graph calls have30s deadlines, attachments60s, with no automatic retry. Definite failures return502
`EMAIL_SEND_FAILED` with `details.attemptId` and best-effort draft cleanup. Unknown outcomes,
including accepted send whose exact Sent copy is not yet visible, return502 `EMAIL_SEND_AMBIGUOUS`
with `details.attemptId`; the possibly-sent draft is preserved. Confirmed means the exact immutable-ID
Sent copy exists, not vendor delivery. NDR handling/reconciliation are Stage4. No subject/time guesses.
The outbox is inserted pending before Graph and persists immutable identity before send. Audit
`invoice.email_replied`/`invoice.email_forwarded` is emitted only after confirmation with server actor,
recipient/subject/attachment metadata and <=200-character preview. Confirmation/audit persistence
failure after observed success is logged without exposing message content and still returns200.
Legacy audit_log behavior is unchanged; no full outbound/raw inbound bodies are stored.

Offline proof: `tests/invoices/email-{service,routes,hardening}.test.js`; R1–R11 and R19,
master §3/§5/§11 and email appendix Stage1/1B. Migration application, live delivery and SSO remain UNVERIFIED.

Permanent document deletion sets the email row's document_id to NULL, retaining attempt identity,
quota accounting and unresolved-token protection. Orphan attempts are not thread destinations;
Stage4 matching must ignore them. This preserves existing deletion behavior without resetting sends.

## Email outbox reconciliation (Stage 4)

Authenticated `accounting.invoices.view_details` protects the bounded attempt
status and reconciliation endpoints. `GET /api/documents/email-attempts/:attemptId`
returns only server-owned attempt metadata and delivery status; it never returns a
message body. `POST /api/documents/email-attempts/:attemptId/reconcile` performs one
bounded reconciliation read and returns `{ attempt, transitioned }`. The service
export `reconcileEmailSweep(limit)` is reserved for a future worker and is not
scheduled by API startup.

Reconciliation reads the persisted Graph immutable message ID with
`Prefer: IdType="ImmutableId"`. It confirms only an exact ID response with
`isDraft: false`, a non-empty `internetMessageId`, and `sentDateTime`; subject and
time are never identity proof. Missing, partial, mismatched, or timed-out evidence
keeps the attempt `ambiguous`. A failed transition requires explicit positive
failure evidence from the injected mailbox boundary. Row locking makes overlapping
or replayed sweeps idempotent: terminal attempts are not regressed or re-audited,
and reconciliation never calls the send operation.

New configuration declarations are `EMAIL_RECONCILIATION_BATCH_SIZE` (default 20)
and `EMAIL_RECONCILIATION_TIMEOUT_MS` (default 30000); no scheduler or deployment
setting is activated. Offline proof is included in the existing email service test
command and covers exact correlation, false matches, absent evidence, failure
evidence, replay/concurrency, actor preservation, audit-once behavior, and no-send
calls. Live Graph/mailbox state, scheduler activation, delivery, deployment, and
SSO remain UNVERIFIED.
