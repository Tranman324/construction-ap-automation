#!/usr/bin/env node
/**
 * Refresh phase code data from Spectrum SQL database
 * Pulls standard phase codes from JC_STD_PHASE_DESCRIPTION_MC (110 rows)
 * and enriches with most-common cost type from JC_PHASE_MASTER_MC.
 *
 * Usage:
 *   node refresh-phase-codes.js
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const { PHASE_CODES_PATH } = require('../../../config');

const OUTPUT = PHASE_CODES_PATH;
const ENV_FILE = '/etc/toolbox/spectrum_db.env';

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

  // 1. Standard phase codes (the clean master list)
  const stdResult = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(Phase_Code))   AS phase_code,
      LTRIM(RTRIM(Description))  AS description
    FROM JC_STD_PHASE_DESCRIPTION_MC
    WHERE Company_Code = 'NCG'
    ORDER BY Phase_Code
  `);

  // 2. Most common cost type per phase code from job-level data
  const costResult = await pool.request().query(`
    SELECT phase_code, cost_type FROM (
      SELECT
        LTRIM(RTRIM(Phase_Code)) AS phase_code,
        LTRIM(RTRIM(Cost_Type))  AS cost_type,
        COUNT(*)                 AS usage_count,
        ROW_NUMBER() OVER (
          PARTITION BY LTRIM(RTRIM(Phase_Code))
          ORDER BY COUNT(*) DESC
        ) AS rn
      FROM JC_PHASE_MASTER_MC
      WHERE Company_Code = 'NCG'
        AND Cost_Type IS NOT NULL
        AND LTRIM(RTRIM(Cost_Type)) != ''
      GROUP BY LTRIM(RTRIM(Phase_Code)), LTRIM(RTRIM(Cost_Type))
    ) ranked
    WHERE rn = 1
  `);

  await pool.close();

  // Build cost type lookup
  const costMap = {};
  for (const row of costResult.recordset) {
    costMap[row.phase_code] = row.cost_type;
  }

  // Build output: phase_code, description, default_cost_type
  const phaseCodes = stdResult.recordset.map(row => ({
    phase_code: row.phase_code,
    description: row.description,
    default_cost_type: costMap[row.phase_code] || 'S',
  }));

  const output = {
    phase_codes: phaseCodes,
    cost_types: ['S', 'M', 'L', 'O', 'E', 'B'],
    refreshed_at: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));

  console.log(`Phase codes: ${phaseCodes.length} codes refreshed`);
}

main().catch(e => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
