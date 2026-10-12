'use strict';

const { JOBS_PATH, ROUTING_CODES_PATH } = require('../../../config');
const { readJSON } = require('./utils');
const logger = require('../../../lib/logger');

function loadJobPmMap() {
  const routingCodesData = readJSON(ROUTING_CODES_PATH) || {};
  const pmToRouting = routingCodesData.pm_to_routing || {};
  const routingCodes = Array.isArray(routingCodesData.routing_codes)
    ? new Set(routingCodesData.routing_codes.map((entry) => String(entry?.code ?? '').trim().toUpperCase()).filter(Boolean))
    : new Set();
  const jobsData = readJSON(JOBS_PATH) || [];
  const jobsArray = Array.isArray(jobsData) ? jobsData : (jobsData.Jobs || []);
  const jobPmMap = {};

  for (const job of jobsArray) {
    if (job.Job_Number) {
      jobPmMap[job.Job_Number] = job.Project_Manager || null;
    }
  }

  routingCodes.add('D');
  return { pmToRouting, routingCodes, jobPmMap };
}

/**
 * Derive the routing code for a job at match time (owner ruling 2026-07-23):
 * the PM who owns the job in Spectrum via pm_to_routing. A job without an
 * active PM code falls back to Josh ('JF') when present in the current catalog,
 * then the AP default ('D'). No-job documents use the AP default directly.
 * Never used to overwrite an existing routing_code — callers must check the
 * row first.
 */
function deriveRoutingCode(jobNumber) {
  const job = jobNumber == null ? '' : String(jobNumber).trim();
  if (!job) return 'D';
  const { pmToRouting, routingCodes, jobPmMap } = loadJobPmMap();
  const pm = ((jobPmMap[job] != null ? jobPmMap[job] : jobPmMap[jobNumber]) || '').trim();
  const mappedCode = pm && pmToRouting[pm] ? String(pmToRouting[pm]).trim().toUpperCase() : '';
  if (mappedCode && routingCodes.has(mappedCode)) return mappedCode;
  const fallbackCode = routingCodes.has('JF') ? 'JF' : 'D';
  if (mappedCode) {
    logger.warn(
      { jobNumber: job, projectManager: pm, staleRoutingCode: mappedCode, fallbackCode },
      'Routing code mapping is absent from the current routing catalog; using routing fallback',
    );
  }
  return fallbackCode;
}

module.exports = {
  loadJobPmMap,
  deriveRoutingCode,
};
