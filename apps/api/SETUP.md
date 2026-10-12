# Invoice Pipeline — Setup Guide

## 🔐 Secrets & Credentials Required

| Secret | Where to Get It | Stored As |
|---|---|---|
| Microsoft Graph OAuth (Client ID/Secret/Tenant) | Azure AD App Registration (same as Tier 1 Graph) | `.env` → `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` |
| Supabase URL | Supabase project dashboard | `.env` → `SUPABASE_URL` |
| Supabase Service Key | Supabase project → Settings → API | `.env` → `SUPABASE_SERVICE_KEY` |
| Viewpoint SQL credentials | Same as Tier 1 Viewpoint | `.env` → `SQL_SERVER`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DATABASE` |
| Mailbox email address | The monitored inbox (e.g., invoices@northwindcg.example) | `.env` → `INVOICE_MAILBOX` |

> ⚠️ **Depends on Tier 1:** Microsoft Graph (email access) + Viewpoint Spectrum (subcontract matching). Must set those up first. Also requires a Supabase project for the classification/tracking database.

---

**What this powers:** Automated construction invoice processing for NCG. Polls an email inbox via Microsoft Graph, downloads PDF/image attachments, extracts invoice data using AI (Haiku 4.5), classifies vendor/job/subcontract via Spectrum data matching, queues for review/approval, and delivers status to Discord `#accounting`.

---

## Files Included

```
07 - Invoice Pipeline/
├── SETUP.md                          ← This file
├── DASHBOARD-CONTEXT.md              ← Dashboard implementation notes
├── .env.template                     ← Environment variables (COPY → .env)
├── .gitignore                        ← Git ignore rules
├── package.json                      ← npm dependencies
├── package-lock.json                 ← Locked dependency tree
├── schema.sql                        ← Supabase database schema
├── server.js.old                     ← Legacy dashboard server
├── modules/
│   └── invoices/
│       └── services/
│           ├── pipeline.js           ← Main pipeline orchestrator
│           ├── matcher.js            ← Vendor/subcontract matching (Spectrum)
│           └── rematch.js            ← Pending-invoice rematch and sweep CLI
├── scripts/
│   ├── poller.js                     ← Email inbox poller (Graph API)
│   ├── extractor.js                  ← AI-powered PDF data extraction (Haiku 4.5)
│   ├── rules-engine.js               ← Invoice classification rules
│   ├── db.js                         ← Database operations (Supabase + local JSON)
│   ├── server.js                     ← Dashboard API server
│   ├── process-latest.js             ← Process most recent invoices
│   ├── box-archive.js                ← Archive processed invoices to Box.com
│   ├── nightly-maintenance.sh        ← Nightly cleanup + cache refresh
│   ├── refresh-spectrum.sh           ← Refresh all Spectrum caches
│   ├── refresh-subcontracts.js       ← Refresh subcontract cache
│   ├── refresh-gl-accounts.js        ← Refresh GL account cache
│   ├── refresh-phase-codes.js        ← Refresh phase code cache
│   ├── refresh-routing-codes.js      ← Refresh routing code cache
│   ├── backfill-bodies.js            ← Backfill email body text
│   ├── backfill-pdfs.js              ← Backfill PDF downloads
│   ├── backfill-pdfs-local.js        ← Backfill from local files
│   ├── re-extract.js                 ← Re-extract failed invoices
│   ├── reprocess-errors.js           ← Reprocess errored entries
│   ├── migrate-to-postgres.js        ← Migration utility
│   └── test-supabase.js              ← Supabase connection test
├── docs/
│   ├── SUPABASE-MIGRATION.md         ← Database migration guide
│   └── specs/
│       ├── 2026-03-04-pipeline-improvements.md
│       ├── 2026-03-13-archive-retention.md
│       └── 2026-03-17-submit-error-handling.md
├── data/                             ← State files (JSON)
│   ├── queue.json                    ← Processing queue
│   ├── processed.json                ← Processed invoice records
│   ├── processed-ids.json            ← Processed ID index
│   ├── pipeline-status.json          ← Pipeline health status
│   ├── classifications.json          ← Vendor classification rules
│   ├── classification-cache.json     ← Classification lookup cache
│   ├── vendor-cache.json             ← Vendor name → ID mapping
│   ├── subcontract-cache.json        ← Subcontract data cache
│   ├── spectrum-refresh-status.json  ← Last Spectrum refresh timestamp
│   ├── extracted/
│   │   └── invoice_305.json          ← Sample extracted invoice data
│   └── dry-run-run-*.json            ← 9 dry-run result snapshots
├── data-files.tar.gz                 ← 348 processed PDFs (162 MB compressed)
├── data-incoming.tar.gz              ← 402 raw email attachments (150 MB compressed)
├── tests/
│   ├── run-tests.js                  ← Test runner
│   ├── expected.json                 ← Expected test output
│   └── samples/                      ← 13 test invoice PDFs
│       ├── amazon-credit-note.pdf
│       ├── red-maple-marketing-invoice.pdf
│       ├── allied-specialties-multi-invoice.pdf
│       ├── palmetto-multi-job.pdf
│       ├── cardinal-materials-invoice.pdf
│       ├── certificate-of-occupancy.pdf
│       ├── glass-mirrors-invoice.pdf
│       ├── glass-mirrors-waiver-only.pdf
│       ├── johnson-controls-invoice.pdf
│       ├── moreno-lien-waiver-plus-invoice.pdf
│       ├── pay-application.pdf
│       ├── tt-casework-invoice.pdf
│       └── delta-cfp-invoice.pdf
└── test-samples/                     ← 6 additional test PDFs
    ├── bcd-svc-job-invoice.pdf
    ├── cardinal-materials-statement.pdf
    ├── equipment-rental-statement.pdf
    ├── kxm-designs-statement.pdf
    ├── toi-toi-multi-invoice.pdf
    └── toi-toi-statement.pdf
```

---

## Prerequisites

- Node.js v18+ installed
- Tier 1 Microsoft Graph set up (email access to monitored inbox)
- Tier 1 Viewpoint Spectrum set up (subcontract/vendor data)
- A Supabase project (free tier works for dev; paid for production)
- Box.com integration (for archiving processed invoices)

---

## Step-by-Step Setup

### Step 1: Create the Supabase Project

1. Go to [supabase.com](https://supabase.com) → Create new project
2. Note the **Project URL** and **Service Role Key** (Settings → API)
3. Run the schema: Go to SQL Editor → paste contents of `schema.sql` → Run

### Step 2: Configure Environment

```bash
cp .env.template .env
```

Edit `.env`:
```env
# Microsoft Graph (same as Tier 1)
MS_TENANT_ID=your-azure-tenant-id
MS_CLIENT_ID=your-app-client-id
MS_CLIENT_SECRET=your-client-secret-value
INVOICE_MAILBOX=invoices@northwindcg.example

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Viewpoint/Spectrum SQL (same as Tier 1)
SQL_SERVER=your-spectrum-server
SQL_USER=your-sql-user
SQL_PASSWORD=your-sql-password
SQL_DATABASE=your-spectrum-db
```

### Step 3: Install Dependencies

```bash
npm install
```

### Step 4: Extract Data Archives (Optional — for Rebuild)

```bash
mkdir -p data/files data/incoming
cd data && tar xzf ../data-files.tar.gz && tar xzf ../data-incoming.tar.gz && cd ..
```

### Step 5: Refresh Spectrum Caches

```bash
bash scripts/refresh-spectrum.sh
# Populates vendor-cache, subcontract-cache, GL accounts, phase codes, routing codes
```

### Step 6: Test Components

```bash
# Test Supabase connection
node scripts/test-supabase.js

# Test extraction on a sample invoice
node scripts/extractor.js test-samples/cardinal-materials-statement.pdf

# Test vendor matching
node modules/invoices/services/matcher.js --test

# Run the test suite
node tests/run-tests.js
```

### Step 7: Run the Pipeline

```bash
# Process latest emails (dry run)
node scripts/process-latest.js --dry-run

# Full pipeline run
node modules/invoices/services/pipeline.js
```

---

## Pipeline Flow

```
Email Inbox (Graph API)
    │
    ├── poller.js → Download attachments → data/incoming/
    │
    ├── extractor.js → AI extraction (Haiku 4.5) → data/extracted/
    │
    ├── matcher.js → Spectrum vendor/subcontract matching
    │
    ├── rules-engine.js → Classification + routing
    │
    ├── db.js → Store in Supabase + local JSON
    │
    └── box-archive.js → Archive to Box.com
```

---

## Cron Jobs

| Cron | Schedule | What It Does |
|---|---|---|
| Invoice Nightly Maintenance | 2 AM EST weeknights | Refreshes caches, processes queue, cleans up |
| Spectrum Data Refresh | 7 AM EST weekdays | Refreshes subcontract/vendor data from Spectrum |

---

## Delivery Channel

Pipeline status and processed invoice summaries post to Discord `#accounting` channel.

---

## Dependencies (npm)

```json
{
  "@supabase/supabase-js": "^2.x",
  "@azure/msal-node": "^2.x",
  "@microsoft/microsoft-graph-client": "^3.x",
  "mssql": "^10.x",
  "dotenv": "^16.x",
  "pdf-parse": "^1.x"
}
```

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `401` on Graph email poll | Token expired or bad creds | Check `.env` Graph credentials |
| `Empty vendor-cache.json` | Spectrum caches not refreshed | Run `bash scripts/refresh-spectrum.sh` |
| Extractor returns garbage | PDF is image-only (no text) | Expected — Haiku uses OCR fallback |
| `Supabase 403` | Wrong service key or RLS issue | Check `SUPABASE_SERVICE_KEY`, verify RLS policies |
| `ECONNREFUSED` on SQL | VPN/firewall blocking Spectrum | Ensure network access to SQL server |
| Classification miss | New vendor not in cache | Run `node scripts/refresh-subcontracts.js` |

---

## ⚠️ Critical Notes

- **DO NOT activate the pipeline early.** It goes live when a specific employee is let go. See USER.md for timing.
- Uses **Haiku 4.5** for AI extraction — cost-optimized for high-volume PDF processing.
- RLS in Supabase can cause **silent failures** (HTTP 200 with 0 rows). Always cross-reference RLS policies.
- `data/dry-run-run-*.json` files are historical dry-run snapshots — useful for debugging but not required for rebuild.

---

## Security Notes

- `.env` contains SQL passwords, API keys, and Supabase service key — never commit
- `data/incoming/` contains real vendor invoices with financial data — treat as confidential
- `data/files/` contains processed PDFs — same confidentiality level
- Invoice amounts, vendor names, and job numbers are business-sensitive data
