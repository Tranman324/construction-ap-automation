#!/usr/bin/env node
/**
 * Refresh subcontract data from Spectrum SQL database
 * Replaces the old OpenClient/HAR approach with a direct SQL query
 * 
 * Usage:
 *   node refresh-subcontracts.js [--all]    (default: 2024+ only)
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const { SUBCONTRACTS_PATH } = require('../../../config');

const OUTPUT = SUBCONTRACTS_PATH;
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
  const allYears = process.argv.includes('--all');
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

  let query = `
    SELECT 
      LTRIM(RTRIM(Job_Number)) AS job,
      LTRIM(RTRIM(Vendor)) AS vendor,
      LTRIM(RTRIM(Vendor_Code)) AS vendor_code,
      LTRIM(RTRIM(Subcontract_Number)) AS subcontract_number,
      Revised_Contract AS rev_contract,
      Total_Billed AS total_billed,
      Total_Balance AS unpaid_balance,
      Date_Issued AS issue_date,
      LTRIM(RTRIM(Contract_Type)) AS contract_type,
      LTRIM(RTRIM(Ins_Certificate)) AS ins_cert,
      LTRIM(RTRIM(Phase_CT)) AS phase_ct,
      Retention_Percent AS ret_pct,
      Unit_Price AS unit_price,
      Sent_Date AS date_sent,
      LTRIM(RTRIM(Contact_Person)) AS contact,
      Total_Change_Orders AS cos,
      Perc_Billed AS pct_billed,
      (Revised_Contract - Total_Billed) AS unbilled,
      Total_Paid AS total_paid,
      LTRIM(RTRIM(Notes)) AS comment,
      LTRIM(RTRIM(Status)) AS status
    FROM dbo.JC_SUBCONTRACTS_V_MC
    WHERE Company_Code = 'NCG'
  `;

  if (!allYears) {
    query += `
      AND (Subcontract_Number LIKE '%24-%' 
        OR Subcontract_Number LIKE '%25-%' 
        OR Subcontract_Number LIKE '%26-%')
    `;
  }

  query += ' ORDER BY Subcontract_Number';

  const result = await pool.request().query(query);

  // Format dates
  for (const row of result.recordset) {
    if (row.issue_date) row.issue_date = new Date(row.issue_date).toISOString().slice(0, 10);
    if (row.date_sent) row.date_sent = new Date(row.date_sent).toISOString().slice(0, 10);
  }

  // Pull phase data and attach to each subcontract.
  //
  // Source is VN_SUBCONTRACT_PHASE_QD_MC (row-parallel to VN_SUBCONTRACT_PHASE_MC,
  // verified 2026-09-02: identical row counts and orig/billed sums) because only
  // the QD table carries CO_Amount. Change-order phases have
  // Original_Contract_Amount = 0 with their contract value in CO_Amount, so
  // `original_amount` here is the REVISED per-phase contract (original + CO) —
  // that's what remaining-amount math downstream (matcher.js, allocation panel)
  // needs. Raw CO value is preserved separately as co_amount.
  const phaseQuery = `
    SELECT
      LTRIM(RTRIM(Subcontract_Number)) AS subcontract_number,
      LTRIM(RTRIM(Phase_Code)) AS phase_code,
      LTRIM(RTRIM(Cost_Type)) AS cost_type,
      LTRIM(RTRIM(Bill_Description)) AS description,
      (Original_Contract_Amount + COALESCE(CO_Amount, 0)) AS original_amount,
      COALESCE(CO_Amount, 0) AS co_amount,
      Amount_Billed_To_Date AS amount_billed
    FROM VN_SUBCONTRACT_PHASE_QD_MC
    WHERE Company_Code = 'NCG'
    ORDER BY Subcontract_Number, Phase_Code
  `;

  const phaseResult = await pool.request().query(phaseQuery);
  await pool.close();

  // Build a map of subcontract_number -> phases array
  const phaseMap = {};
  for (const row of phaseResult.recordset) {
    const key = row.subcontract_number;
    if (!phaseMap[key]) phaseMap[key] = [];
    phaseMap[key].push({
      phase_code: row.phase_code,
      cost_type: row.cost_type,
      description: row.description,
      original_amount: row.original_amount,
      co_amount: row.co_amount,
      amount_billed: row.amount_billed,
    });
  }

  // Attach phases to each subcontract record
  for (const row of result.recordset) {
    row.phases = phaseMap[row.subcontract_number] || [];
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(result.recordset, null, 2));

  console.log(`${result.recordset.length} subcontracts saved to ${OUTPUT} (${phaseResult.recordset.length} phase rows attached)`);
}

main().catch(e => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
