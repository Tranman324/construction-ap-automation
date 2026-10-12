'use strict';
/**
 * /api/jobs routes
 */

const express = require('express');
const router = express.Router();
const { readJSON } = require('../services/utils');
const { JOBS_PATH } = require('../../../config');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { requirePermission } = require('../../../middleware/permissions');
const { validate } = require('../../../middleware/validate');
const {
  jobNumberParamsSchema,
  jobsQuerySchema,
  sharePointFolderQuerySchema,
} = require('../../../lib/schemas');
const { getPagination } = require('../../../lib/pagination');

router.get('/', requirePermission('accounting.invoices.view_details'), validate(jobsQuerySchema, 'query'), (req, res) => {
  try {
    const { search, status: statusFilter } = req.query;
    const { limit, offset } = getPagination(req.query);
    const jobs = readJSON(JOBS_PATH, []);

    const decodeHTML = s => s
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#039;/g, "'");

    const parseJobNum = (n) => {
      const parts = n.split('-');
      const year = parseInt(parts[0], 10) || 0;
      const rest = parts.slice(1).join('-');
      const seq = parseInt(rest.replace(/^SVC/i, ''), 10) || 0;
      const isSvc = /^SVC/i.test(rest) ? 1 : 0;
      return [year, isSvc, seq];
    };

    const q = search.toLowerCase();
    const results = jobs
      .filter(j => {
        const jNum = (j.Job_Number || j.number || '').toString().trim();
        const jDesc = (j.Job_Description || j.description || '').trim();
        const [, seq] = jNum.split('-');
        if (jNum.startsWith('99-') || (seq && seq.startsWith('9')) || /^test$/i.test(jDesc)) return false;
        if (statusFilter && (j.Status_Code || j.Status || j.status || '').trim() !== statusFilter) return false;
        if (!q) return true;
        const desc = (j.Job_Description || j.description || '').toLowerCase();
        const num = (j.Job_Number || j.number || '').toString().toLowerCase();
        const addr = (j.Address_1 || j.address || '').toLowerCase();
        const addr2 = (j.Address_2 || '').toLowerCase();
        return desc.includes(q) || num.includes(q) || addr.includes(q) || addr2.includes(q);
      })
      .map(j => ({
        number:      (j.Job_Number || j.number || '').toString().trim(),
        description: decodeHTML((j.Job_Description || j.description || '').trim()),
        address:     [j.Address_1, j.Address_2, j.City, j.State, j.Zip].filter(Boolean).join(', ').trim(),
        status:      (j.Status_Code || j.Status || j.status || '').trim(),
        pm:          (j.Project_Manager || j.pm || '').trim(),
      }))
      .sort((a, b) => {
        const [ay, aIsSvc, aSeq] = parseJobNum(a.number);
        const [by, bIsSvc, bSeq] = parseJobNum(b.number);
        if (by !== ay) return by - ay;
        if (aIsSvc !== bIsSvc) return aIsSvc - bIsSvc;
        if (bSeq !== aSeq) return bSeq - aSeq;
        return a.number.localeCompare(b.number);
      })
      .slice(offset, offset + limit);

    res.json(results);
  } catch (err) {
    return safeError(res, err, 'GET /api/jobs');
  }
});

// GET /api/jobs/sharepoint/folders — lazy-browse any drive-relative folder.
// Registered BEFORE /:jobNumber routes so "sharepoint" isn't captured as a param.
router.get('/sharepoint/folders', requirePermission('accounting.invoices.view_details'), validate(sharePointFolderQuerySchema, 'query'), async (req, res) => {
  try {
    const { listFolderContents } = require('../services/sharepointFilingService');
    const { path: pathParam } = req.query;
    const contents = await listFolderContents(pathParam);
    res.json({ path: pathParam, folders: contents.folders, files: contents.files });
  } catch (err) {
    // If Graph returns 404-ish (itemNotFound), surface as 404
    if (err.message && (err.message.includes('404') || err.message.includes('itemNotFound'))) {
      return fail(res, 404, `Path not found in drive: ${req.query.path || '(root)'}`);
    }
    return safeError(res, err, 'GET /api/jobs/sharepoint/folders');
  }
});

// GET /api/jobs/:jobNumber/folders — live SharePoint folder tree for the job.
// Powers the DestinationPicker in the doc panels (replaces the FE's
// hardcoded SHAREPOINT_DESTINATION_TREE). Two levels deep, folders only.
router.get('/:jobNumber/folders', requirePermission('accounting.invoices.view_details'), validate(jobNumberParamsSchema, 'params'), async (req, res) => {
  try {
    const { getJobFolderTree } = require('../services/sharepointFilingService');
    const tree = await getJobFolderTree(req.params.jobNumber);
    if (!tree) {
      return fail(res, 404, `No SharePoint folder found for job ${req.params.jobNumber}`);
    }
    res.json(tree);
  } catch (err) {
    return safeError(res, err, 'GET /api/jobs/:jobNumber/folders');
  }
});

module.exports = router;
