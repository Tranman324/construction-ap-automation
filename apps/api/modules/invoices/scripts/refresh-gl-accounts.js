#!/usr/bin/env node
/**
 * Refresh GL account data from Spectrum SQL database
 * Pulls from GL_ACCOUNT_MC (all active accounts).
 *
 * Usage:
 *   node refresh-gl-accounts.js
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const { GL_ACCOUNTS_PATH } = require('../../../config');

const OUTPUT = GL_ACCOUNTS_PATH;
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

  const result = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(GL_Account))          AS GL_Account,
      LTRIM(RTRIM(Description))         AS Description,
      LTRIM(RTRIM(Short_Description))   AS Short_Description,
      LTRIM(RTRIM(Account_Type_Code))   AS Account_Type,
      LTRIM(RTRIM(Status))              AS Status,
      LTRIM(RTRIM(Cost_Type))           AS Cost_Type,
      LTRIM(RTRIM(Direct_Cost_Flag))    AS Direct_Cost_Flag,
      LTRIM(RTRIM(Post_AP_Detail_Flag)) AS Post_AP_Detail_Flag,
      LTRIM(RTRIM(All_Cost_Centers))    AS All_Cost_Centers
    FROM GL_MASTER_MC
    WHERE Company_Code = 'NCG'
      AND Status = 'A'
    ORDER BY GL_Account
  `);

  await pool.close();

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(result.recordset, null, 2));

  console.log(`${result.recordset.length} accounts saved to ${OUTPUT}`);
}

main().catch(e => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
