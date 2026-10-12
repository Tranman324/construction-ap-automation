/**
 * NCG Invoice Pipeline — Central Configuration
 * Single source of truth for all paths, ports, and constants.
 * Every script imports from here rather than hardcoding paths.
 */

'use strict';

const path = require('path');

// ─── Root directory of the invoice pipeline ──────────────────────────────────
const PIPELINE_ROOT = __dirname;

// ─── Data directories ─────────────────────────────────────────────────────────
// DATA_DIR resolves via INVOICES_DATA_DIR env var → falls back to PIPELINE_ROOT/data
// (which is a symlink to /var/lib/toolbox/invoices/ as of 2026-04-16).
const DATA_DIR       = process.env.INVOICES_DATA_DIR || path.join(PIPELINE_ROOT, 'data');
const INCOMING_DIR   = path.join(DATA_DIR, 'incoming');
const EXTRACTED_DIR  = path.join(DATA_DIR, 'extracted');
const FILES_DIR      = path.join(DATA_DIR, 'files');

// ─── Data files ───────────────────────────────────────────────────────────────
// NOTE: queue.json is a write-behind backup only. All READS must come from Supabase.
const QUEUE_PATH             = path.join(DATA_DIR, 'queue.json');
const PROCESSED_IDS_PATH     = path.join(DATA_DIR, 'processed-ids.json');
const VENDOR_CACHE_PATH      = path.join(DATA_DIR, 'vendor-cache.json');
const SUBCONTRACT_CACHE_PATH = path.join(DATA_DIR, 'subcontract-cache.json');
const PIPELINE_STATUS_PATH   = path.join(DATA_DIR, 'pipeline-status.json');
const SPECTRUM_REFRESH_PATH  = path.join(DATA_DIR, 'spectrum-refresh-status.json');
const CLASSIFICATIONS_PATH   = path.join(DATA_DIR, 'classifications.json');
const CLASS_CACHE_PATH       = path.join(DATA_DIR, 'classification-cache.json');

// ─── Spectrum data cache files (all in DATA_DIR) ──────────────────────────────
const VENDORS_PATH       = path.join(DATA_DIR, 'spectrum_vendors.json');
const JOBS_PATH          = path.join(DATA_DIR, 'spectrum_jobs_rest.json');
const SUBCONTRACTS_PATH  = path.join(DATA_DIR, 'spectrum_subcontracts.json');
const ROUTING_CODES_PATH = path.join(DATA_DIR, 'spectrum_routing_codes.json');
const PHASE_CODES_PATH   = path.join(DATA_DIR, 'spectrum_phase_codes.json');
const GL_ACCOUNTS_PATH   = path.join(DATA_DIR, 'spectrum_gl_accounts.json');

// ─── Spectrum SQL config (separate reference file) ────────────────────────────
const SPECTRUM_SQL_CONFIG_PATH = '/etc/toolbox/spectrum-sql.json';

// ─── Box integration ──────────────────────────────────────────────────────────
const BOX_SCRIPT           = path.join(PIPELINE_ROOT, '..', '..', '..', 'skills', 'box', 'box.js');
const BOX_INVOICES_FOLDER  = '100000000001'; // /Toolbox/invoices/

// ─── Microsoft Graph / Azure AD ──────────────────────────────────────────────
const INVOICE_MAILBOX = process.env.INVOICE_MAILBOX || 'invoices@northwindcg.example';

// Inbox subfolders that also receive invoices (id → display name)
// These are polled in addition to the root inbox.
// Folder IDs are Microsoft Graph opaque identifiers — load from env.
// Document collaboration declarations. No secrets; values are supplied by deployment owners.
const DOCUMENT_EMAIL = {
  mailbox: INVOICE_MAILBOX,
  appBaseUrl: process.env.APP_BASE_URL || '',
  internalDomains: (process.env.EMAIL_INTERNAL_DOMAINS || 'northwindcg.example').split(',').map(s => s.trim().toLowerCase()),
  dailyCap: Math.max(1, Number.parseInt(process.env.EMAIL_DAILY_CAP || '100', 10) || 100),
  timeZone: process.env.EMAIL_CAP_TIME_ZONE || 'America/New_York',
  disabled: () => process.env.EMAIL_SEND_DISABLED === 'true',
  reconciliation: {
    // Declaration only: a future worker may call reconcileEmailSweep; startup does not schedule it.
    batchSize: Math.min(100, Math.max(1, Number.parseInt(process.env.EMAIL_RECONCILIATION_BATCH_SIZE || '20', 10) || 20)),
    timeoutMs: Math.min(60000, Math.max(1000, Number.parseInt(process.env.EMAIL_RECONCILIATION_TIMEOUT_MS || '30000', 10) || 30000)),
  },
};
const INVOICE_SUBFOLDERS = {};
if (process.env.INVOICE_SUBFOLDER_IDS) {
  try {
    const pairs = JSON.parse(process.env.INVOICE_SUBFOLDER_IDS);
    Object.assign(INVOICE_SUBFOLDERS, pairs);
  } catch { /* ignore malformed JSON */ }
}

// ─── Spectrum REST API ────────────────────────────────────────────────────────
const SPECTRUM_REST_URL  = process.env.SPECTRUM_REST_URL  || 'https://your-tenant.dexterchaney.example:8482';
const SPECTRUM_REST_USER = process.env.SPECTRUM_REST_USER;
const SPECTRUM_REST_PASS = process.env.SPECTRUM_REST_PASS;

// ─── Discord ─────────────────────────────────────────────────────────────────
const DISCORD_CHANNEL_ACCOUNTING = process.env.DISCORD_CHANNEL || '100000000000000001';

// ─── Server ───────────────────────────────────────────────────────────────────
const API_PORT = parseInt(process.env.INVOICE_SERVER_PORT || '3456', 10);
const SUBMIT_STALE_RECOVERY_MINUTES = parseInt(process.env.SUBMIT_STALE_RECOVERY_MINUTES || '10', 10);

// ─── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

// ─── LLM gateway / vision ───────────────────────────────────────────────
const LLM_GATEWAY_URL = process.env.LLM_GATEWAY_URL || 'http://127.0.0.1:18789/v1/chat/completions';
const LLM_GATEWAY_MODEL = process.env.LLM_GATEWAY_MODEL || 'gateway:main';
const INVOICE_OCR_MIN_CHARS = parseInt(process.env.INVOICE_OCR_MIN_CHARS || '80', 10);

// ─── Lib paths ────────────────────────────────────────────────────────────────
const GRAPH_CLIENT_PATH = path.join(PIPELINE_ROOT, 'lib', 'graph.js');

module.exports = {
  PIPELINE_ROOT,
  DATA_DIR,
  INCOMING_DIR,
  EXTRACTED_DIR,
  FILES_DIR,
  QUEUE_PATH,
  PROCESSED_IDS_PATH,
  VENDOR_CACHE_PATH,
  SUBCONTRACT_CACHE_PATH,
  PIPELINE_STATUS_PATH,
  SPECTRUM_REFRESH_PATH,
  CLASSIFICATIONS_PATH,
  CLASS_CACHE_PATH,
  VENDORS_PATH,
  JOBS_PATH,
  SUBCONTRACTS_PATH,
  ROUTING_CODES_PATH,
  PHASE_CODES_PATH,
  GL_ACCOUNTS_PATH,
  SPECTRUM_SQL_CONFIG_PATH,
  BOX_SCRIPT,
  BOX_INVOICES_FOLDER,
  INVOICE_MAILBOX,
  DOCUMENT_EMAIL,
  INVOICE_SUBFOLDERS,
  SPECTRUM_REST_URL,
  SPECTRUM_REST_USER,
  SPECTRUM_REST_PASS,
  DISCORD_CHANNEL_ACCOUNTING,
  API_PORT,
  SUBMIT_STALE_RECOVERY_MINUTES,
  SUPABASE_DB_URL,
  LLM_GATEWAY_URL,
  LLM_GATEWAY_MODEL,
  INVOICE_OCR_MIN_CHARS,
  GRAPH_CLIENT_PATH,
};
