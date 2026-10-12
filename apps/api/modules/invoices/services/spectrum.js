'use strict';
/**
 * Spectrum service
 * - SQL pool setup (MSSQL)
 * - Phase code lookup
 * - HTTP submission to Spectrum REST API
 */

const fs = require('fs');
const https = require('https');
const mssql = require('mssql');
const {
  SPECTRUM_REST_PASS,
  SPECTRUM_REST_URL,
  SPECTRUM_REST_USER,
  SPECTRUM_SQL_CONFIG_PATH,
} = require('../../../config');
const logger = require('../../../lib/logger');

// ─── In-memory process state ──────────────────────────────────────────────────
const spectrumState = { running: false, startedAt: null };

// ─── SQL config setup (try/catch for missing password) ───────────────────────
let spectrumConfig = null;
let spectrumSqlPass = null;
try {
  spectrumConfig = JSON.parse(fs.readFileSync(SPECTRUM_SQL_CONFIG_PATH, 'utf8'));
  spectrumSqlPass = fs.readFileSync(spectrumConfig.sql.passwordFile, 'utf8').trim();
} catch (e) {
  logger.warn({ err: e }, 'Spectrum SQL config not available; phase code lookups disabled');
}
let spectrumPool = null;

async function getSpectrumPool() {
  if (!spectrumConfig || !spectrumSqlPass) {
    throw new Error('Spectrum SQL not configured — password file missing');
  }
  if (!spectrumPool) {
    spectrumPool = await mssql.connect({
      server: spectrumConfig.sql.server,
      user: spectrumConfig.sql.user,
      password: spectrumSqlPass,
      database: spectrumConfig.sql.database || 'Spectrum',
      options: spectrumConfig.sql.options,
      connectionTimeout: 15000,
      requestTimeout: 30000,
    });
  }
  return spectrumPool;
}

/**
 * Check if Spectrum SQL is reachable.
 */
async function checkSpectrumSql() {
  try {
    if (spectrumPool) {
      await spectrumPool.request().query('SELECT 1 AS ok');
      return true;
    } else if (spectrumConfig && spectrumSqlPass) {
      const testPool = await mssql.connect({
        server: spectrumConfig.sql.server,
        user: spectrumConfig.sql.user,
        password: spectrumSqlPass,
        database: spectrumConfig.sql.database || 'Spectrum',
        options: spectrumConfig.sql.options,
        connectionTimeout: 5000,
        requestTimeout: 5000,
      });
      await testPool.request().query('SELECT 1 AS ok');
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Look up phase code(s) for a subcontract from Spectrum.
 */
async function lookupPhaseCode(subcontractNumber) {
  try {
    const sp = await getSpectrumPool();
    const result = await sp.request()
      .input('sub', mssql.VarChar, subcontractNumber)
      .query(`
        SELECT TOP 1 LTRIM(RTRIM(Phase_Code)) AS Phase_Code
        FROM VN_SUBCONTRACT_PHASE_MC
        WHERE Company_Code = 'NCG' AND Subcontract_Number LIKE '%' + @sub + '%'
        ORDER BY Original_Contract_Amount DESC
      `);
    return result.recordset.length ? result.recordset[0].Phase_Code : null;
  } catch (err) {
    logger.error({ err, subcontractNumber }, 'Spectrum phase lookup failed');
    return null;
  }
}

/**
 * Query GL accounts from Spectrum SQL.
 */
async function getGlAccounts({ type, search, costType, limit = 50, offset = 0 } = {}) {
  const sp = await getSpectrumPool();
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(200, Math.max(1, limit)) : 50;
  const safeOffset = Number.isSafeInteger(offset) ? Math.max(0, offset) : 0;
  const request = sp.request()
    .input('limit', mssql.Int, safeLimit)
    .input('offset', mssql.Int, safeOffset);
  const conditions = ["Company_Code = 'NCG'", "Status = 'A'"];

  if (type) {
    conditions.push('Account_Type_Code = @type');
    request.input('type', mssql.VarChar, type);
  }
  if (costType) {
    conditions.push('Cost_Type = @costType');
    request.input('costType', mssql.VarChar, costType);
  }
  if (search) {
    conditions.push("(LOWER(LTRIM(RTRIM(GL_Account))) LIKE @search OR LOWER(LTRIM(RTRIM(Description))) LIKE @search)");
    request.input('search', mssql.VarChar, `%${String(search).toLowerCase()}%`);
  }

  const result = await request.query(`
    SELECT GL_Account, Description, Account_Type_Code, Cost_Type, Status
    FROM GL_MASTER_MC
    WHERE ${conditions.join(' AND ')}
    ORDER BY GL_Account, Cost_Type, Account_Type_Code, Description
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  return result.recordset.map(row => ({
    code: (row.GL_Account || '').trim(),
    description: (row.Description || '').trim(),
    accountType: (row.Account_Type_Code || '').trim(),
    costType: (row.Cost_Type || '').trim(),
  }));
}

/**
 * Look up an invoice in Spectrum by vendor + invoice number.
 * Scope (per the product owner, 2026-07-07): "did we receive this invoice?" — presence in
 * ANY of the three AP tables counts (open items, in-approval, payment history).
 * Exact trimmed match on vendor_code + invoice_number, same rules as audit-spectrum.
 * Returns { invoiceNumber, vendorCode, amount, source } or null.
 */
async function findSpectrumInvoice({ invoiceNumber, vendorCode }) {
  const inv = String(invoiceNumber || '').trim();
  const vend = String(vendorCode || '').trim();
  if (!inv || !vend) return null;
  try {
    const sp = await getSpectrumPool();
    const result = await sp.request()
      .input('inv', mssql.VarChar, inv)
      .input('vend', mssql.VarChar, vend)
      .query(`
        SELECT TOP 1 source, invoice_number, vendor_code, invoice_amount FROM (
          SELECT 'OPEN_ITEMS' AS source,
                 LTRIM(RTRIM(Invoice_Number)) AS invoice_number,
                 LTRIM(RTRIM(Vendor_Code)) AS vendor_code,
                 Invoice_Amount AS invoice_amount
          FROM VN_OPEN_ITEMS_MC
          WHERE Company_Code = 'NCG'
          UNION ALL
          SELECT 'APPROVAL' AS source,
                 LTRIM(RTRIM(Invoice_Number)),
                 LTRIM(RTRIM(Vendor_Code)),
                 Invoice_Amount
          FROM VN_INVOICE_APPROVAL_HDR_MC
          WHERE Company_Code = 'NCG'
          UNION ALL
          SELECT 'PAYMENT_HIST' AS source,
                 LTRIM(RTRIM(Invoice_Number)),
                 LTRIM(RTRIM(Vendor_Code)),
                 Original_Invoice_Amount
          FROM VN_PAYMENT_HISTORY_MC
          WHERE Company_Code = 'NCG'
        ) ap
        WHERE REPLACE(REPLACE(REPLACE(ap.invoice_number, '-', ''), ' ', ''), '.', '')
            = REPLACE(REPLACE(REPLACE(@inv, '-', ''), ' ', ''), '.', '')
          AND ap.vendor_code = @vend
        ORDER BY CASE ap.source WHEN 'OPEN_ITEMS' THEN 1 WHEN 'APPROVAL' THEN 2 ELSE 3 END
      `);
    const row = result.recordset && result.recordset[0];
    if (!row) return null;
    return {
      invoiceNumber: row.invoice_number,
      vendorCode: row.vendor_code,
      amount: row.invoice_amount == null ? null : Number(row.invoice_amount),
      source: row.source,
    };
  } catch (err) {
    logger.error({ err, invoiceNumber: inv, vendorCode: vend }, 'Spectrum statement-line invoice lookup failed');
    // Fail open as "not found" — worst case a line shows in_toolbox_not_spectrum
    // instead of matched; never block statement processing on Spectrum downtime.
    return null;
  }
}

/** Match normalization used by findSpectrumInvoice's SQL (strip '-', ' ', '.'). */
function spectrumInvoiceKey(vendorCode, invoiceNumber) {
  // Upper-cased: Spectrum's default collation compares case-insensitively.
  const vend = String(vendorCode || '').trim().toUpperCase();
  const inv = String(invoiceNumber || '').trim().replace(/[-. ]/g, '').toUpperCase();
  return vend && inv ? `${vend}\u0000${inv}` : null;
}

/**
 * Batched findSpectrumInvoice for list views: one Spectrum round-trip for up
 * to a page of (vendor, invoice#) pairs. SAME tables, SAME normalization, SAME
 * source precedence (OPEN_ITEMS > APPROVAL > PAYMENT_HIST) as the single
 * lookup — a list glyph and the detail card can never disagree on "is it in
 * Spectrum". Returns Map<spectrumInvoiceKey, {invoiceNumber, vendorCode,
 * amount, source}>. Fails open to an empty Map (never blocks the list).
 */
async function findSpectrumInvoicesBatch(pairs, { timeoutMs = 4000, getPool = getSpectrumPool } = {}) {
  const hits = new Map();
  const wanted = new Map();
  for (const p of pairs || []) {
    const key = spectrumInvoiceKey(p.vendorCode, p.invoiceNumber);
    if (key && !wanted.has(key)) {
      const [vend, inv] = key.split('\u0000');
      wanted.set(key, { vend, inv });
    }
  }
  if (wanted.size === 0) return hits;
  try {
    const sp = await getPool();
    const request = sp.request();
    const vendors = [...new Set([...wanted.values()].map((w) => w.vend))];
    const vendorParams = vendors.map((v, i) => { request.input(`v${i}`, mssql.VarChar, v); return `@v${i}`; });
    const invoices = [...new Set([...wanted.values()].map((w) => w.inv))];
    const invoiceParams = invoices.map((v, i) => { request.input(`i${i}`, mssql.VarChar, v); return `@i${i}`; });
    const NORM = (col) => `REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(${col})), '-', ''), ' ', ''), '.', '')`;
    const scope = `Company_Code = 'NCG' AND LTRIM(RTRIM(Vendor_Code)) IN (${vendorParams.join(', ')}) AND ${NORM('Invoice_Number')} IN (${invoiceParams.join(', ')})`;
    const query = `
        SELECT source, invoice_number, vendor_code, invoice_amount, norm FROM (
          SELECT 'OPEN_ITEMS' AS source,
                 LTRIM(RTRIM(Invoice_Number)) AS invoice_number,
                 LTRIM(RTRIM(Vendor_Code)) AS vendor_code,
                 Invoice_Amount AS invoice_amount,
                 ${NORM('Invoice_Number')} AS norm
          FROM VN_OPEN_ITEMS_MC
          WHERE ${scope}
          UNION ALL
          SELECT 'APPROVAL',
                 LTRIM(RTRIM(Invoice_Number)),
                 LTRIM(RTRIM(Vendor_Code)),
                 Invoice_Amount,
                 ${NORM('Invoice_Number')}
          FROM VN_INVOICE_APPROVAL_HDR_MC
          WHERE ${scope}
          UNION ALL
          SELECT 'PAYMENT_HIST',
                 LTRIM(RTRIM(Invoice_Number)),
                 LTRIM(RTRIM(Vendor_Code)),
                 Original_Invoice_Amount,
                 ${NORM('Invoice_Number')}
          FROM VN_PAYMENT_HISTORY_MC
          WHERE ${scope}
        ) ap`;
    const timeout = new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`Spectrum batch lookup exceeded ${timeoutMs}ms`)), timeoutMs);
      if (t.unref) t.unref();
    });
    const result = await Promise.race([request.query(query), timeout]);
    const rank = { OPEN_ITEMS: 1, APPROVAL: 2, PAYMENT_HIST: 3 };
    for (const row of result.recordset || []) {
      const key = spectrumInvoiceKey(row.vendor_code, row.norm);
      if (!wanted.has(key)) continue;
      const prev = hits.get(key);
      if (prev && rank[prev.source] <= rank[row.source]) continue;
      hits.set(key, {
        invoiceNumber: row.invoice_number,
        vendorCode: row.vendor_code,
        amount: row.invoice_amount == null ? null : Number(row.invoice_amount),
        source: row.source,
      });
    }
    return hits;
  } catch (err) {
    logger.warn({ err, pairs: wanted.size }, 'Spectrum batch duplicate lookup failed; list renders without Spectrum duplicate glyphs');
    return new Map();
  }
}

function getSpectrumRestCredentials() {
  const missing = [];
  if (!String(SPECTRUM_REST_USER || '').trim()) missing.push('SPECTRUM_REST_USER');
  if (!String(SPECTRUM_REST_PASS || '').trim()) missing.push('SPECTRUM_REST_PASS');
  if (missing.length) {
    throw new Error(`Missing required Spectrum REST credential environment variable(s): ${missing.join(', ')}`);
  }
  return { user: SPECTRUM_REST_USER, pass: SPECTRUM_REST_PASS };
}

function getSpectrumInvoiceEndpoint() {
  try {
    return new URL('/vendor/invoice', SPECTRUM_REST_URL);
  } catch (err) {
    throw new Error('Invalid Spectrum REST URL configuration');
  }
}

/**
 * POST a batch of invoices to Spectrum REST API.
 */
function postToSpectrum(payload) {
  return new Promise((resolve, reject) => {
    const { user, pass } = getSpectrumRestCredentials();
    const endpoint = getSpectrumInvoiceEndpoint();
    const body = JSON.stringify(payload);
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    const options = {
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Basic ${auth}`,
      },
      // Spectrum currently presents a self-signed certificate; keep this exception scoped to this request.
      rejectUnauthorized: false,
    };

    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        try {
          resolve({ statusCode: resp.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ statusCode: resp.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('Spectrum request timed out after 30s')); });
    req.write(body);
    req.end();
  });
}

module.exports = {
  spectrumState,
  spectrumConfig,
  getSpectrumPool,
  checkSpectrumSql,
  lookupPhaseCode,
  findSpectrumInvoice,
  findSpectrumInvoicesBatch,
  spectrumInvoiceKey,
  getGlAccounts,
  postToSpectrum,
};
