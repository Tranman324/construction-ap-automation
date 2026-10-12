#!/usr/bin/env node
/**
 * Refresh routing code data from Spectrum SQL database
 * Queries VN_ROUTING_MASTER_HEADER_MC and VN_ROUTING_MASTER_DETAIL_MC
 * and cross-references with JC_JOB_MASTER_MC for PM-to-routing mapping.
 *
 * Usage:
 *   node refresh-routing-codes.js
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const { ROUTING_CODES_PATH } = require('../../../config');

const OUTPUT = ROUTING_CODES_PATH;
const ENV_FILE = '/etc/toolbox/spectrum_db.env';
const EXCLUDED_CODES = new Set(['JT']);

const HEADER_QUERY = `
    SELECT
      LTRIM(RTRIM(Routing_Code)) AS code,
      LTRIM(RTRIM(Routing_Desc)) AS description,
      LTRIM(RTRIM(Confirm))      AS confirm_by
    FROM VN_ROUTING_MASTER_HEADER_MC h
    WHERE h.Company_Code = 'NCG'
      AND EXISTS (
        SELECT 1
        FROM PA_OPERATOR_FILE_MC o
        WHERE o.Company_Code = 'NCG'
          AND LTRIM(RTRIM(o.Operator_Id)) = LTRIM(RTRIM(h.Routing_Code))
      )
    ORDER BY Routing_Code
`;

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function buildRoutingCatalog(headers, details, projectManagers) {
  const approverMap = {};
  for (const row of details) {
    const code = normalizeCode(row.code);
    if (!code || EXCLUDED_CODES.has(code)) continue;
    if (!approverMap[code]) approverMap[code] = [];
    approverMap[code].push({
      sequence: row.sequence,
      operator: row.operator,
      limit: typeof row.limit === 'number' ? row.limit : parseFloat(row.limit) || 0,
    });
  }

  const seenCodes = new Set();
  const routingCodes = headers.reduce((catalog, header) => {
    const code = normalizeCode(header.code);
    if (!code || EXCLUDED_CODES.has(code) || seenCodes.has(code)) return catalog;
    seenCodes.add(code);
    catalog.push({
      code,
      description: header.description,
      confirm_by: header.confirm_by,
      approvers: approverMap[code] || [],
    });
    return catalog;
  }, []);

  // D is a product-owned fallback, not a Spectrum operator record.
  if (!seenCodes.has('D')) {
    routingCodes.push({
      code: 'D',
      description: 'AP Default Routing',
      confirm_by: '',
      approvers: [],
    });
    seenCodes.add('D');
  }

  const pmToRouting = {};
  for (const row of projectManagers) {
    const pmCode = String(row.pm_code ?? '').trim();
    const routingCode = normalizeCode(pmCode);
    if (pmCode && seenCodes.has(routingCode)) pmToRouting[pmCode] = routingCode;
  }

  return { routingCodes, pmToRouting };
}

function loadEnv() {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k && v.length) env[k.trim()] = v.join('=').trim();
  }
  return env;
}

async function main() {
  const env = loadEnv();

  const config = {
    server: env.SPECTRUM_DB_HOST,
    user: env.SPECTRUM_DB_USER,
    password: env.SPECTRUM_DB_PASS,
    database: env.SPECTRUM_DB_NAME,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 60000,
    connectionTimeout: 15000,
  };

  const pool = await sql.connect(config);

  // 1. Fetch routing code headers
  const headersResult = await pool.request().query(HEADER_QUERY);

  // 2. Fetch routing code details (approvers)
  const detailsResult = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(Routing_Code))  AS code,
      LTRIM(RTRIM(Sequence))      AS sequence,
      LTRIM(RTRIM(Routing_ID))    AS operator,
      ISNULL(Approval_Limit, 0)   AS limit
    FROM VN_ROUTING_MASTER_DETAIL_MC
    WHERE Company_Code = 'NCG'
    ORDER BY Routing_Code, Sequence
  `);

  // 3. Fetch distinct PM codes with job counts
  const pmResult = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(Project_Manager)) AS pm_code,
      COUNT(*)                       AS job_count
    FROM JC_JOB_MASTER_MC
    WHERE Company_Code = 'NCG'
      AND Project_Manager IS NOT NULL
      AND LTRIM(RTRIM(Project_Manager)) != ''
    GROUP BY LTRIM(RTRIM(Project_Manager))
    ORDER BY pm_code
  `);

  await pool.close();

  const { routingCodes, pmToRouting } = buildRoutingCatalog(
    headersResult.recordset,
    detailsResult.recordset,
    pmResult.recordset,
  );
  const totalApprovers = routingCodes.reduce((total, code) => total + code.approvers.length, 0);

  const output = {
    routing_codes: routingCodes,
    pm_to_routing: pmToRouting,
    refreshed_at: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));

  console.log(`Routing codes: ${routingCodes.length} codes, ${totalApprovers} approvers refreshed`);
}

if (require.main === module) {
  main().catch(e => {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { EXCLUDED_CODES, HEADER_QUERY, buildRoutingCatalog, normalizeCode };
