# Invoice Module — Architecture

> Single source of truth for how the NCG Invoice Pipeline is structured.
> Updated: 2026-04-13

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BROWSER (Dana)                                │
│  toolbox.northwindcg.example (Vercel, Next.js 16)                          │
│  └─ /api/backend/* → Edge Middleware (session check + header injection)│
└───────────────────────────────────────┬─────────────────────────────────┘
                                        │ x-internal-secret + x-user-email
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     BACKEND API (Hetzner VPS)                           │
│  Express.js on port 3456 (systemd: invoice-api)                        │
│  Caddy reverse proxy: api.toolbox.northwindcg.example → localhost:3456     │
│                                                                         │
│  ┌─── middleware/auth.js ──┐                                           │
│  │ requireAuth on all      │                                           │
│  │ routes except /health   │                                           │
│  └─────────────┬───────────┘                                           │
│                │                                                        │
│  ┌─── routes/ ─┴──────────────────────────────────────────┐            │
│  │ invoices.js  vendors.js  jobs.js  subcontracts.js      │            │
│  │ splits.js    rules.js    settings.js  pipeline.js      │            │
│  │ feedback.js  health.js   ignore-rules.js  users.js     │            │
│  │ lien-waivers.js                                        │            │
│  └────────────────────────────────────────────────────────┘            │
│                │                                                        │
│  ┌─── services/ ──────────────────────────────────────────┐            │
│  │ supabase.js         spectrum.js       matching.js      │            │
│  │ pdf.js              pdf-split.js      ocr.js           │            │
│  │ vision.js           sanitize.js       discord.js       │            │
│  │ file-types.js       utils.js                           │            │
│  │ approvalValidator.js  approvalRules.json               │            │
│  │ spectrumValidation.js                                  │            │
│  └────────────────────────────────────────────────────────┘            │
│                │                                                        │
│  ┌─── data/ (Spectrum JSON caches, refreshed nightly) ────┐           │
│  │ spectrum_vendors.json    spectrum_jobs_rest.json        │           │
│  │ spectrum_subcontracts.json  spectrum_gl_accounts.json   │           │
│  │ spectrum_phase_codes.json  spectrum_routing_codes.json  │           │
│  └────────────────────────────────────────────────────────┘            │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
      ┌──────────┐  ┌──────────┐    ┌─────────────┐
      │ Supabase │  │ Spectrum │    │ Graph API   │
      │ Postgres │  │ REST/SQL │    │ (email)     │
      └──────────┘  └──────────┘    └─────────────┘
```

---

## Authentication Flow

```
Browser → Vercel Edge Middleware:
  1. getToken() decodes NextAuth session cookie (~2ms)
  2. If no session → 401 JSON (for API) or redirect to /login (for pages)
  3. If valid → NextResponse.rewrite() to backend with:
     - x-internal-secret: <INTERNAL_API_SECRET>
     - x-user-email: <session.user.email>

Backend middleware/auth.js:
  1. Check x-internal-secret (constant-time comparison)
  2. OR check Authorization: Bearer <jwt> (signed with NEXTAUTH_SECRET)
  3. If neither → 401
  4. Sets req.user.email + res.locals.userEmail for downstream routes
```

---

## Data Flow — Invoice Lifecycle

```
Email (invoices@northwindcg.example)
  → pipeline.js (cron, Mon-Fri 4AM-10PM ET every 2hrs)
    → Graph API: download attachments
    → sanitize.js: clean filenames (shell injection protection)
    → file-types.js: detect PDF/image
    → ImageMagick: convert PDF pages to PNG
    → ocr.js: extract text (pdftotext, fallback tesseract)
    → vision.js: Haiku classification + extraction
    → matching.js: vendor/job/subcontract fuzzy match
    → supabase.js: INSERT into documents table
    → box-archive.js: archive to Box.com
    → discord.js: post summary to #accounting

Dashboard (Dana reviews)
  → GET /api/invoices: list with filters
  → PATCH /api/invoices/:id: edit fields (triggers feedback cache)
  → POST /api/invoices/:id/approve: validates via approvalValidator.js
  → POST /api/invoices/submit: validates via spectrumValidation.js → POST to Spectrum

Lifecycle: pending → approved → submitted → (retention purge after 30 days)
                  → discarded → (retention purge after 7 days)
                  → rejected → (retention purge after 14 days)

Soft delete: DELETE /api/invoices/:id → sets deleted_at (recoverable)
Hard delete: DELETE /api/invoices/:id/permanent → admin only, removes row + file
Retention:   scripts/purge.js (cron, daily 2AM ET) → hard delete based on retention_settings
```

---

## Database (Supabase PostgreSQL)

**25 tables** across Invoice + email-bot pipelines (shared project).

Key invoice tables:
| Table | Purpose |
|---|---|
| `documents` | All queued items (invoices, waivers, COIs, etc.) |
| `audit_log` | Every action with actor + changes (ON DELETE CASCADE) |
| `pipeline_errors` | Failed email processing with retry tracking |
| `retention_settings` | Per-classification retention rules |
| `rules` | Automation rules engine |
| `ignore_rules` | Email/sender ignore patterns |
| `vendor_mappings` | Feedback cache: email domain → vendor code |
| `subcontract_mappings` | Feedback cache: vendor+job → subcontract |
| `processed_emails` | Dedup gate for pipeline |

**RLS:** Enabled on all 25 tables with explicit `service_role_full_access` policies for `postgres` + `service_role`. All other roles denied by default.

**Soft delete columns on `documents`:**
- `deleted_at`, `deleted_by`, `deletion_reason` (tombstone)
- `restored_at`, `restored_by` (recovery audit)
- Partial indexes: `idx_documents_active` (WHERE deleted_at IS NULL), `idx_documents_deleted`

---

## Validation Architecture

**Shared contract pattern** — single source of truth in `services/approvalRules.json`:

```
approvalRules.json  ← defines paths, required fields, auto-routing
       │
       ├── services/approvalValidator.js (backend, authoritative)
       │     └── Used by: POST /approve, POST /bulk, GET /validate-approval/:id
       │
       └── GET /api/approval-schema (API endpoint)
             └── Frontend fetches once → client-side validation as UX preview
```

**Spectrum submission validation** — `services/spectrumValidation.js`:
- Structural checks (required fields, types, date format)
- Reference integrity (vendor/job/GL/phase/routing against cached Spectrum data)
- Math consistency (detail amounts sum to header)
- Image field name check (the `Image_File` vs `Image` bug that cost weeks)

---

## Security Layers

| Layer | Implementation |
|---|---|
| **Edge auth** | Vercel middleware: `getToken()` session check |
| **Transport auth** | `x-internal-secret` header (shared between Vercel + backend) |
| **Backend auth** | `middleware/auth.js`: constant-time secret validation, fail-closed |
| **CORS** | Locked to `https://toolbox.northwindcg.example` + `localhost:3000` |
| **Shell injection** | `services/sanitize.js`: filename stripping + path escaping on all `execSync` calls |
| **Soft delete** | User DELETE is recoverable; only retention purge + admin permanent delete are destructive |
| **Admin gate** | `DELETE /:id/permanent` requires email in `ADMIN_EMAILS` (env-configurable) |
| **Demo bypass** | Gated behind `DEMO_BYPASS_ENABLED=true` env var (not set in production) |
| **RLS** | Explicit policies on all 25 Supabase tables |

---

## File Structure

```
scripts/invoices/
├── ARCHITECTURE.md          ← This file
├── SETUP.md                 ← Setup/rebuild guide
├── API.md                   ← Full API endpoint reference
├── FRONTEND-SPEC.md         ← Frontend component spec
├── config.js                ← Centralized paths + env vars
├── .env                     ← Secrets (chmod 600, not in git)
├── .env.example             ← Template for all env vars
├── schema.sql               ← Supabase schema definition
├── package.json
│
├── modules/
│   └── invoices/
│       └── services/
│           ├── pipeline.js  ← Main pipeline orchestrator
│           ├── matcher.js   ← Vendor/job/subcontract matching
│           └── rematch.js   ← Pending-invoice rematch and sweep CLI
│
├── scripts/
│   ├── server.js            ← Express entry point (port 3456)
│   ├── extractor.js         ← PDF → image → Haiku → JSON
│   ├── purge.js             ← Retention cleanup (daily cron)
│   ├── split-worker.js      ← Async child-doc processor for PDF splits
│   ├── healthcheck.js       ← Monitoring script (used by heartbeat)
│   ├── db.js                ← PostgreSQL pool (direct connection)
│   ├── box-archive.js       ← Box.com upload + archival
│   │
│   ├── middleware/
│   │   └── auth.js          ← requireAuth + optionalAuth
│   │
│   ├── routes/
│   │   ├── invoices.js      ← Main CRUD + approve + submit (1979 LOC — refactor candidate)
│   │   ├── splits.js        ← PDF split review flow
│   │   ├── settings.js      ← Classifications, routing/phase/GL, retention, approval schema
│   │   ├── vendors.js       ← Vendor search
│   │   ├── jobs.js          ← Job search
│   │   ├── subcontracts.js  ← Subcontract lookup
│   │   ├── rules.js         ← Automation rules CRUD
│   │   ├── pipeline.js      ← Pipeline run/status
│   │   ├── feedback.js      ← Vendor/subcontract correction feedback
│   │   ├── health.js        ← Health check endpoint
│   │   ├── ignore-rules.js  ← Email ignore rules CRUD
│   │   ├── users.js         ← User info
│   │   └── lien-waivers.js  ← Waiver orphans + reverse lookup
│   │
│   └── services/
│       ├── supabase.js      ← Pool, audit(), rowToDoc()
│       ├── spectrum.js      ← Spectrum REST/SOAP/SQL + postToSpectrum()
│       ├── matching.js      ← Subcontract cache, waiver scoring
│       ├── pdf.js           ← ensurePdf(), mergePdfs()
│       ├── pdf-split.js     ← qpdf split, pdftoppm render, layout validation
│       ├── ocr.js           ← tesseract + pdftotext
│       ├── vision.js        ← Anthropic Haiku API (direct, not via gateway)
│       ├── sanitize.js      ← sanitizeFilename(), sanitizePathForShell()
│       ├── approvalValidator.js  ← Shared approval validation (reads approvalRules.json)
│       ├── approvalRules.json    ← Approval path definitions (single source of truth)
│       ├── spectrumValidation.js ← Pre-flight Spectrum payload validation
│       ├── file-types.js    ← MIME detection, stored filename generation
│       ├── discord.js       ← Discord webhook posting
│       └── utils.js         ← readJSON(), formatDate(), etc.
│
├── migrations/
│   ├── 2026-04-11_rls_hardening.sql   ← RLS policies for all 25 tables
│   └── 2026-04-11_soft_delete.sql     ← Soft delete columns + partial indexes
│
├── data/                    ← Spectrum JSON caches (refreshed nightly)
├── docs/specs/              ← Feature specs for frontend (Copilot consumes)
└── tests/                   ← Test samples + runner
```

---

## Complexity Guardrails

**The pipeline is a 70% machine, not a 100% machine.** Dana's review is the last mile — that's by design, not a bug. Not every edge case warrants code.

**Before adding a new matching rule, parser, or special-case handler:**
1. How many invoices per month does this affect? If < 10, flag for manual handling instead of automating.
2. Is this a learning system (gets smarter with use) or a static rule (breaks when the input changes)? Prefer learning systems.
3. Does this add a code path a future developer has to understand? If yes, is the ROI worth the maintenance burden?
4. Can the existing feedback caches (vendor, subcontract, job) solve this through corrections instead of new code?

**Examples of good complexity:** Job feedback cache (learns from corrections, 30 lines, same pattern as existing caches).
**Examples of bad complexity:** QuickBooks email template parser (static rules for 6 invoices/month, breaks when Intuit changes their HTML).

---

## Known Technical Debt

| Item | Severity | Notes |
|---|---|---|
| `routes/invoices.js` (1979 LOC) | 🟠 Major | Should be split into services. Refactor candidate. |
| `pipeline.js` (1774 LOC) | 🟠 Major | Same. |
| Zero backend unit tests for security modules | 🟠 Major | auth, sanitize, approvalValidator, spectrumValidation need test suites |
| 224 unstructured `console.log` calls | 🟡 Minor | Should migrate to JSON structured logging |
| No rate limiting | 🟡 Minor | Auth mitigates most risk, but public /health has no limit |
| Frontend `approvalValidation.ts` hardcoded | 🟡 Minor | Should fetch from `/api/approval-schema` instead |
| Multi-phase subcontract edge cases untested | 🟡 Minor | Needs test fixtures with 3+ phase subcontracts |
| Waiver scoring weights not tuned | 🟡 Minor | Needs 50-100+ feedback data points |

---

## Cron Jobs

| Job | Schedule | Runner | Purpose |
|---|---|---|---|
| Invoice pipeline | Mon-Fri 4AM-10PM ET, every 2hrs | cron-runner | Process new emails |
| Spectrum refresh | Daily 2AM ET | cron-runner | Refresh vendor/job/subcontract/phase/GL caches |
| Retention purge | Daily 2AM ET | cron-runner | Hard-delete aged-out documents |

---

## Environment Variables

See `.env.example` for the complete list with descriptions.
