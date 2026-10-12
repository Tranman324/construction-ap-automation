'use strict';

const { SUBMIT_STALE_RECOVERY_MINUTES } = require('../../../config');
const logger = require('../../../lib/logger');
const { pool } = require('./supabase');

const STALE_SUBMIT_MESSAGE = 'Submit interrupted - verify in Spectrum before retrying';
const DEFAULT_STALE_RECOVERY_MINUTES = 10;

function getStaleSubmitMinutes(value = SUBMIT_STALE_RECOVERY_MINUTES) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_STALE_RECOVERY_MINUTES;
}

async function recoverStaleSubmittingInvoices(options = {}) {
  const staleMinutes = getStaleSubmitMinutes(options.staleMinutes);
  const log = options.log || logger;

  const result = await pool.query(
    `UPDATE documents
     SET status = 'approved',
         submit_error = $1,
         updated_at = NOW()
     WHERE status = 'submitting'
       AND updated_at < NOW() - ($2::int * INTERVAL '1 minute')
     RETURNING id`,
    [STALE_SUBMIT_MESSAGE, staleMinutes]
  );

  const recoveredCount = result.rowCount || 0;
  log.info({
    operation: 'invoice.submit.recover_stale',
    context: { staleMinutes, recoveredCount },
  }, 'Recovered stale submitting invoices');

  return { recoveredCount, staleMinutes };
}

module.exports = {
  STALE_SUBMIT_MESSAGE,
  getStaleSubmitMinutes,
  recoverStaleSubmittingInvoices,
};
