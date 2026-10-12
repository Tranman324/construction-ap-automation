'use strict';

const { getVendorBypassCounts, getWaiverActionSerializationOptions, pool, rowToDoc } = require('./supabase');
const { checkPermission } = require('../../../middleware/permissions');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { getPagination } = require('../../../lib/pagination');
const { evaluateCoiCompliance } = require('./coiComplianceService');
const { getUnreadAggregates } = require('./activityService');
const spectrum = require('./spectrum');

// List endpoints intentionally exclude `email_body` (raw email HTML — ~350KB
// across 50 rows, never rendered in the table). The detail endpoint
// (GET /api/invoices/:id) still returns the full document including the body.
const LIST_COLUMNS = `
  id, classification, status, confidence, file_name, file_path, file_size_bytes,
  display_name, email_message_id, email_from, email_subject, email_received_at,
  email_body_preview, email_body_content_type, vendor_name, vendor_address,
  invoice_number, invoice_date, due_date, amount, job_number, project_name,
  project_address, description, line_items, vendor_code, vendor_match_confidence,
  vendor_match_method, matched_vendor_name, job_match_number, job_match_confidence,
  job_match_method, subcontract_number, subcontract_match_confidence,
  subcontract_match_method, overall_confidence, needs_review, lien_waiver_status,
  statement_lines, split_from, duplicate_of, linked_to, rejection_reason, reviewed_at, assigned_to,
  filed, flagged, flagged_at, flagged_by, flag_reason, hidden, notes, queued_at, updated_at, was_modified, routing_code,
  phase_code, cost_type, gl_account, gl_date, linked_lien_waiver_id,
  lien_waiver_required, waiver_bypassed, waiver_bypassed_at, waiver_bypassed_by,
  duplicate_bypassed, duplicate_bypassed_at, duplicate_bypassed_by,
  merged_file_path, submit_error, split_suggestion,
  suggested_split, phase_allocations, multi_phase_candidate, deleted_at, deleted_by,
  deletion_reason, restored_at, restored_by, filed_at, approved_at, approved_by,
  discarded_at, discarded_by, discard_source, reconciled, reconciled_at, waiver_released,
  waiver_released_at, filed_destination, filing_note, hold_reason, sp_file_url,
  sharepoint_item_id, sharepoint_filename, waiver_on_document,
  waiver_on_document_at, waiver_on_document_by, spectrum_upload_status,
  spectrum_upload_queued_at, spectrum_upload_started_at,
  spectrum_upload_completed_at, spectrum_upload_error,
  spectrum_upload_trans_id, spectrum_upload_tracking_code,
  spectrum_upload_vendor_code, spectrum_upload_attempts,
  waiver_type, waiver_requested_at, waiver_requested_by, waiver_link_source,
  waiver_request_conversation_id, waiver_auto_link_skip_reason, warranty_manual_values
`;

const LIST_UNREAD_COLUMNS = `
  (SELECT COUNT(*)::int FROM document_email_messages m
   WHERE m.document_id = documents.id AND m.direction = 'in' AND m.kind = 'inbound'
     AND (documents.activity_viewed_at IS NULL OR m.created_at > documents.activity_viewed_at)) AS unread_replies,
  (SELECT COUNT(*)::int FROM document_comments c
   WHERE c.document_id = documents.id
     AND (documents.activity_viewed_at IS NULL OR c.created_at > documents.activity_viewed_at)) AS unread_comments
`;

const ACTIVE_DASHBOARD_STATUSES = ['pending', 'modified', 'approved', 'submitted'];
const PENDING_DASHBOARD_STATUSES = ['pending', 'modified'];
const ACTIVE_DASHBOARD_STATUS_SQL = ACTIVE_DASHBOARD_STATUSES.map((status) => `'${status}'`).join(', ');
const PENDING_DASHBOARD_STATUS_SQL = PENDING_DASHBOARD_STATUSES.map((status) => `'${status}'`).join(', ');
const QUEUE_SCOPE_SQL = 'COALESCE(filed, false) = false';
const PANEL_GROUPS = ['invoice', 'receipt', 'statement', 'coi', 'w9', 'lien-waiver', 'other'];
const PANEL_GROUP_SQL = PANEL_GROUPS.map((panel) => `'${panel}'`).join(', ');
const TRASH_MEMBERSHIP_SQL = `deleted_at IS NOT NULL OR (deleted_at IS NULL AND ${QUEUE_SCOPE_SQL} AND status NOT IN (${ACTIVE_DASHBOARD_STATUS_SQL}, 'linked'))`;

function effectivePanelGroupSql() {
  return `COALESCE(
    (
      SELECT CASE
        WHEN custom_classifications.opens_as IN (${PANEL_GROUP_SQL}) THEN custom_classifications.opens_as
        WHEN custom_classifications.opens_as IS NULL THEN NULL
        ELSE 'other'
      END
      FROM custom_classifications
      WHERE custom_classifications.name = documents.classification
      LIMIT 1
    ),
    CASE
      WHEN documents.classification IN ('invoice', 'pay-application', 'purchase-order', 'credit-memo') THEN 'invoice'
      WHEN documents.classification IN ('receipt', 'statement', 'coi', 'w9', 'lien-waiver') THEN documents.classification
      ELSE 'other'
    END
  )`;
}

// "If it already exists in Spectrum, it's a duplicate" (the product owner, 2026-10-06).
// duplicate_of only links Toolbox copies; invoices entered/paid directly in
// Spectrum never get one, so the list glyph missed them. One batched,
// time-boxed Spectrum lookup per list page attaches `spectrumDuplicate` to
// reviewable rows. Same matcher as the detail card (findSpectrumInvoice), and
// fail-open: Spectrum down/slow -> no glyph, the list still renders.
const SPECTRUM_DUPLICATE_STATUSES = new Set(PENDING_DASHBOARD_STATUSES);

async function attachSpectrumDuplicates(rows, { lookup = (pairs) => spectrum.findSpectrumInvoicesBatch(pairs) } = {}) {
  const candidates = rows.filter((r) => SPECTRUM_DUPLICATE_STATUSES.has(r.status)
    && r.duplicate_bypassed !== true
    && spectrum.spectrumInvoiceKey(r.vendor_code, r.invoice_number));
  if (candidates.length === 0) return new Map();
  let hits;
  try {
    hits = await lookup(candidates.map((r) => ({ vendorCode: r.vendor_code, invoiceNumber: r.invoice_number })));
  } catch {
    return new Map(); // fail open: never block the list on Spectrum
  }
  if (!(hits instanceof Map)) return new Map();
  const byId = new Map();
  for (const r of candidates) {
    const hit = hits.get(spectrum.spectrumInvoiceKey(r.vendor_code, r.invoice_number));
    if (hit) byId.set(r.id, { source: hit.source, amount: hit.amount });
  }
  return byId;
}

function buildInvoiceListFilter(query) {
  const { status = 'all', search = '', splitFrom, classification, filed, panel, flagged, scope } = query;
  if (scope === 'global') {
    const globalSearch = `(
      vendor_name ILIKE $1 OR
      vendor_code ILIKE $1 OR
      matched_vendor_name ILIKE $1 OR
      invoice_number ILIKE $1 OR
      job_number ILIKE $1 OR
      job_match_number ILIKE $1 OR
      email_from ILIKE $1 OR
      email_subject ILIKE $1 OR
      description ILIKE $1
    )`;
    return { where: `WHERE ${globalSearch}`, params: [`%${search}%`], paramIdx: 2 };
  }
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  let paramIdx = 1;

  if (filed === 'true') {
    conditions.push('filed = true');
  } else if (filed === 'false') {
    conditions.push(QUEUE_SCOPE_SQL);
  }

  // Attention-flag filter (M-092): flag state is `flagged_at IS NOT NULL`,
  // distinct from the legacy `flagged` split-marker boolean. Composes with the
  // status/panel/filed/search conditions via AND; no existing filter changes.
  if (flagged === 'true') {
    conditions.push('flagged_at IS NOT NULL');
  } else if (flagged === 'false') {
    conditions.push('flagged_at IS NULL');
  }

  if (status === 'all') {
    conditions.push(splitFrom
      ? `status NOT IN ('discarded', 'duplicate', 'split')`
      : `status IN (${ACTIVE_DASHBOARD_STATUS_SQL})`);
  } else if (status === 'pending') {
    conditions.push(`status IN (${PENDING_DASHBOARD_STATUS_SQL})`);
  } else {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }

  if (splitFrom) {
    conditions.push(`split_from = $${paramIdx++}`);
    params.push(splitFrom);
  }
  if (classification) {
    conditions.push(`classification = $${paramIdx++}`);
    params.push(classification);
  }
  if (panel) {
    conditions.push(`${effectivePanelGroupSql()} = $${paramIdx++}`);
    params.push(panel);
  }
  if (search) {
    conditions.push(`(
      vendor_name ILIKE $${paramIdx} OR
      vendor_code ILIKE $${paramIdx} OR
      invoice_number ILIKE $${paramIdx} OR
      job_match_number ILIKE $${paramIdx} OR
      description ILIKE $${paramIdx} OR
      email_subject ILIKE $${paramIdx}
    )`);
    params.push(`%${search}%`);
    paramIdx++;
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params, paramIdx };
}

function getInvoiceOrder(sort, sortDir) {
  const dir = sortDir === 'desc' ? 'DESC' : 'ASC';
  const nulls = dir === 'ASC' ? 'NULLS LAST' : 'NULLS FIRST';

  switch (sort) {
    case 'vendor': return `vendor_name ${dir} ${nulls}, id ${dir}`;
    case 'amount': return `amount ${dir} ${nulls}, id ${dir}`;
    case 'invoice': return `invoice_number ${dir} ${nulls}, id ${dir}`;
    case 'job': return `job_match_number ${dir} ${nulls}, id ${dir}`;
    case 'received': return `queued_at ${dir}, id ${dir}`;
    case 'date':
    default: return `queued_at ${dir}, id ${dir}`;
  }
}

async function listInvoices(req, res) {
  try {
    const { page = '1', sort = 'date', sortDir = 'asc' } = req.query;
    const { where, params, paramIdx } = buildInvoiceListFilter(req.query);
    const { limit: limitNum, offset: requestedOffset } = getPagination(req.query);
    const useOffset = req.query.offset !== undefined;
    const requestedPage = Number.parseInt(page, 10);
    const pageNum = useOffset
      ? Math.floor(requestedOffset / limitNum) + 1
      : (Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1);
    const offset = useOffset ? requestedOffset : (pageNum - 1) * limitNum;
    const orderBy = getInvoiceOrder(sort, sortDir);

    // Count + data in parallel — each round-trip to Supabase costs ~100ms.
    const selectColumns = req.query.scope === 'global'
      ? `${LIST_COLUMNS}, (${TRASH_MEMBERSHIP_SQL}) AS is_trash`
      : LIST_COLUMNS;
    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM documents ${where}`, params),
      pool.query(
        `SELECT ${selectColumns}, ${LIST_UNREAD_COLUMNS} FROM documents ${where} ORDER BY ${orderBy} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limitNum, offset]
      ),
    ]);
    const total = parseInt(countResult.rows[0].count, 10);
    const pages = Math.ceil(total / limitNum);

    const spectrumDuplicates = await attachSpectrumDuplicates(dataResult.rows);
    const invoices = dataResult.rows.map((row) => {
      const doc = rowToDoc(row);
      doc.spectrumDuplicate = spectrumDuplicates.get(row.id) || null;
      return doc;
    });

    res.json({ invoices, total, page: pageNum, limit: limitNum, pages });
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices');
  }
}

// The sortable column behind each `sort` value — the SAME columns
// getInvoiceOrder sorts by, so the keyset anchor key matches the list ordering.
const NEIGHBOR_SORT_COLUMN = {
  vendor: 'vendor_name',
  amount: 'amount',
  invoice: 'invoice_number',
  job: 'job_match_number',
  received: 'queued_at',
  date: 'queued_at',
};

function invoiceSortColumn(sort) {
  return NEIGHBOR_SORT_COLUMN[sort] || 'queued_at';
}

// Keyset predicate: rows strictly AFTER the anchor in ORDER BY (`col` dir, `id` dir)
// with PostgreSQL's DEFAULT null positioning (ASC → NULLS LAST, DESC → NULLS FIRST) —
// exactly what getInvoiceOrder emits. Because the anchor's key value is known here
// (fetched by id), the null branch is decided in JS. Params are appended starting at
// `startIdx`. `next` uses this with the list direction; `prev` uses it with the
// reversed direction over the reversed ORDER BY, so its first row is the closest
// predecessor. The anchor need NOT match the filter — the predicate is a pure
// position boundary, which is what makes post-action auto-advance resolve.
function keysetAfter(col, sortDir, anchorKey, anchorId, startIdx) {
  const asc = sortDir !== 'desc';
  const params = [];
  let idx = startIdx;
  const bind = (v) => { params.push(v); return `$${idx++}`; };

  if (asc) { // NULLS LAST
    if (anchorKey === null || anchorKey === undefined) {
      // Anchor sits in the trailing NULL block — only later NULLs (by id) follow.
      return { sql: `(${col} IS NULL AND id > ${bind(anchorId)})`, params };
    }
    // Larger key, or equal key with a larger id, or any NULL (nulls come last).
    return {
      sql: `(${col} > ${bind(anchorKey)} OR (${col} = ${bind(anchorKey)} AND id > ${bind(anchorId)}) OR ${col} IS NULL)`,
      params,
    };
  }

  // DESC → NULLS FIRST
  if (anchorKey === null || anchorKey === undefined) {
    // Anchor sits in the leading NULL block — later NULLs (by id desc), then all non-nulls.
    return { sql: `((${col} IS NULL AND id < ${bind(anchorId)}) OR ${col} IS NOT NULL)`, params };
  }
  // Smaller key, or equal key with a smaller id. NULLs came first, so none follow.
  return {
    sql: `(${col} < ${bind(anchorKey)} OR (${col} = ${bind(anchorKey)} AND id < ${bind(anchorId)}))`,
    params,
  };
}

// GET /api/invoices/:id/neighbors — server-computed keyset prev/next for the queue
// detail Prev/Next arrows and post-action auto-advance. Same filter/sort vocabulary
// as the list endpoint; the anchor is resolved by id regardless of whether it still
// matches the filter (load-bearing for auto-advance after a doc leaves the filtered set).
async function getInvoiceNeighbors(req, res) {
  try {
    const sort = req.query.sort || 'date';
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc';
    const col = invoiceSortColumn(sort);

    // Anchor row by id, unconditionally (no filter) — may be out of the filtered set.
    // The sort key is fetched as ::text so it round-trips EXACTLY. node-postgres
    // parses timestamptz into a JS Date, which truncates microseconds to
    // milliseconds; binding that truncated value back into the keyset predicate
    // made `col > $key` match the anchor row itself whenever its timestamp had
    // non-zero sub-millisecond digits (next == anchor → the queue "sticks").
    // As text, Postgres re-parses the bound value against the column's own type
    // with full precision.
    const anchorResult = await pool.query(
      `SELECT id, ${col}::text AS sort_key FROM documents WHERE id = $1`,
      [req.params.id]
    );
    if (anchorResult.rows.length === 0) return fail(res, 404, 'Invoice not found');
    const anchor = anchorResult.rows[0];

    // Same filter builder and same ORDER BY definition the list endpoint uses.
    const { where, params, paramIdx } = buildInvoiceListFilter(req.query);
    const reversedDir = sortDir === 'desc' ? 'asc' : 'desc';
    const orderBy = getInvoiceOrder(sort, sortDir);
    const reversedOrderBy = getInvoiceOrder(sort, reversedDir);

    const nextKey = keysetAfter(col, sortDir, anchor.sort_key, anchor.id, paramIdx);
    const prevKey = keysetAfter(col, reversedDir, anchor.sort_key, anchor.id, paramIdx);

    const [nextRes, prevRes, totalRes, beforeRes, inSetRes] = await Promise.all([
      pool.query(
        `SELECT id FROM documents ${where} AND ${nextKey.sql} ORDER BY ${orderBy} LIMIT 1`,
        [...params, ...nextKey.params]
      ),
      pool.query(
        `SELECT id FROM documents ${where} AND ${prevKey.sql} ORDER BY ${reversedOrderBy} LIMIT 1`,
        [...params, ...prevKey.params]
      ),
      // total: rows matching the SAME filter WHERE.
      pool.query(`SELECT COUNT(*) AS count FROM documents ${where}`, params),
      // position rank: rows ordering strictly BEFORE the anchor. Reuses the EXACT
      // keyset SQL the prev seek uses, so `position` can never disagree with
      // prev/next (no new ordering logic). 1-based position = this count + 1.
      pool.query(
        `SELECT COUNT(*) AS count FROM documents ${where} AND ${prevKey.sql}`,
        [...params, ...prevKey.params]
      ),
      // Is the anchor itself in the filtered set? If not, its rank is undefined.
      pool.query(`SELECT 1 FROM documents ${where} AND id = $${paramIdx} LIMIT 1`, [...params, anchor.id]),
    ]);

    const total = parseInt(totalRes.rows[0].count, 10);
    const anchorInSet = inSetRes.rows.length > 0;
    const position = anchorInSet ? parseInt(beforeRes.rows[0].count, 10) + 1 : null;

    res.json({
      prev: prevRes.rows[0] ? prevRes.rows[0].id : null,
      next: nextRes.rows[0] ? nextRes.rows[0].id : null,
      position,
      total,
    });
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/neighbors');
  }
}

async function getInvoiceStats(req, res) {
  try {
    const { filed, panel } = req.query;
    const filedFilter = filed === 'true' ? 'AND filed = true'
      : filed === 'false' ? `AND ${QUEUE_SCOPE_SQL}`
      : '';
    const panelFilter = panel ? `AND ${effectivePanelGroupSql()} = $1` : '';
    const panelParams = panel ? [panel] : [];
    const todayParam = panelParams.length + 1;
    const today = new Date().toISOString().slice(0, 10);

    // Two parallel queries instead of five sequential ones — each round-trip
    // to Supabase costs ~100ms, so this cuts stats latency ~5x.
    // Query 1: per-status counts + amounts in the requested queue/shelf scope.
    // Query 2: scalar aggregates (today's processed, avg confidence, error count).
    // Query 3: dashboard bucket totals across queue, trash, and shelf.
    const [statusResult, scalarResult, dashboardTotalResult] = await Promise.all([
      pool.query(`
        SELECT status,
               COUNT(*) AS count,
               COALESCE(SUM(amount) FILTER (WHERE amount IS NOT NULL), 0) AS total_amount
        FROM documents
        WHERE deleted_at IS NULL ${filedFilter} ${panelFilter}
        GROUP BY status
      `, panelParams),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE queued_at::date = $${todayParam}) AS today_count,
          AVG(confidence) FILTER (
            WHERE confidence IS NOT NULL AND classification IN ('invoice', 'receipt')
          ) AS avg_conf,
          COUNT(*) FILTER (WHERE classification = 'error') AS err_count,
          COUNT(*) FILTER (WHERE flagged_at IS NOT NULL) AS flagged_count
        FROM documents
        WHERE deleted_at IS NULL ${filedFilter} ${panelFilter}
      `, [...panelParams, today]),
      pool.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND ${QUEUE_SCOPE_SQL}
              AND status IN (${ACTIVE_DASHBOARD_STATUS_SQL})
          ) AS active_count,
          COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND ${QUEUE_SCOPE_SQL}
              AND status NOT IN (${ACTIVE_DASHBOARD_STATUS_SQL}, 'linked')
          ) + COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS trash_count,
          COUNT(*) FILTER (
            WHERE deleted_at IS NULL
              AND filed = true
              AND status IN (${ACTIVE_DASHBOARD_STATUS_SQL})
          ) AS shelf_count
        FROM documents
        WHERE TRUE ${panelFilter}
      `, panelParams),
    ]);

    const counts = {};
    const amounts = {};
    let total = 0;
    for (const row of statusResult.rows) {
      const count = parseInt(row.count, 10);
      counts[row.status] = count;
      total += count;
      amounts[row.status] = parseFloat(row.total_amount);
    }
    const scalars = scalarResult.rows[0];
    const dashboardTotals = dashboardTotalResult.rows[0];
    const pending = (counts.pending || 0) + (counts.modified || 0);
    const activeTotal = parseInt(dashboardTotals.active_count, 10);
    const trashTotal = parseInt(dashboardTotals.trash_count, 10);
    const shelfTotal = parseInt(dashboardTotals.shelf_count, 10);
    const discarded = counts.discarded || 0;
    const duplicate = counts.duplicate || 0;

    res.json({
      total: activeTotal + trashTotal + shelfTotal,
      activeTotal,
      trashTotal,
      shelfTotal,
      globalTotal: activeTotal + trashTotal + shelfTotal,
      pending,
      approved: counts.approved || 0,
      rejected: counts.rejected || 0,
      submitted: counts.submitted || 0,
      skipped: counts.skipped || 0,
      discarded,
      duplicate,
      reviewed: counts.reviewed || 0,
      errors: parseInt(scalars.err_count, 10),
      flaggedCount: parseInt(scalars.flagged_count, 10),
      todayProcessed: parseInt(scalars.today_count, 10),
      avgConfidence: scalars.avg_conf ? Math.round(parseFloat(scalars.avg_conf) * 100) / 100 : 0,
      amounts: {
        pending: amounts.pending || 0,
        approved: amounts.approved || 0,
        submitted: amounts.submitted || 0,
        total: Object.values(amounts).reduce((a, b) => a + b, 0),
      },
    });
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/stats');
  }
}

async function listDeletedInvoices(req, res) {
  try {
    const { limit, offset } = getPagination(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    // Trash shows soft-deleted items plus queue docs outside the active dashboard buckets.
    // Discarded items that age past retention (7 days) get permanently purged by purge.js.
    // 'linked' is a parked (non-junk) waiver state — the waiver's linked
    // invoice was approved. Not trash; excluded here and in the stats
    // trash_count below. See waiverLinkedStatusService.
    const trashMembership = TRASH_MEMBERSHIP_SQL;
    const params = [];
    let trashWhere = `(${trashMembership})`;
    if (req.query.panel) {
      trashWhere += ` AND ${effectivePanelGroupSql()} = $${params.length + 1}`;
      params.push(req.query.panel);
    }
    if (search) {
      const searchParam = params.length + 1;
      trashWhere += ` AND (
        vendor_name ILIKE $${searchParam} OR
        vendor_code ILIKE $${searchParam} OR
        matched_vendor_name ILIKE $${searchParam} OR
        invoice_number ILIKE $${searchParam} OR
        job_number ILIKE $${searchParam} OR
        job_match_number ILIKE $${searchParam} OR
        email_from ILIKE $${searchParam} OR
        email_subject ILIKE $${searchParam} OR
        description ILIKE $${searchParam}
      )`;
      params.push(`%${search}%`);
    }
    const paginationParam = params.length + 1;
    const [countResult, dataResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM documents WHERE ${trashWhere}`,
        params
      ),
      pool.query(
        `SELECT ${LIST_COLUMNS}, ${LIST_UNREAD_COLUMNS} FROM documents
         WHERE ${trashWhere}
         ORDER BY COALESCE(deleted_at, discarded_at, updated_at) DESC, id DESC
         LIMIT $${paginationParam} OFFSET $${paginationParam + 1}`,
        [...params, limit, offset]
      ),
    ]);
    res.json({ invoices: dataResult.rows.map(rowToDoc), total: parseInt(countResult.rows[0].count, 10), limit, offset });
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/trash');
  }
}

async function getInvoice(req, res) {
  try {
    const includeDeleted = req.query.includeDeleted === 'true';
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');
    const row = result.rows[0];
    if (row.deleted_at && !includeDeleted) return fail(res, 404, 'Invoice not found');
    if (Object.prototype.hasOwnProperty.call(row, 'activity_viewed_at')) {
      Object.assign(row, await getUnreadAggregates(row.id, row.activity_viewed_at));
    }
    // W4: one grouped bypass-count query for the row's vendor, passed into the
    // synchronous serializer via options (never queried inside it).
    const vendorBypassCounts = await getVendorBypassCounts(row.vendor_code ? [row.vendor_code] : []);
    const invoice = rowToDoc(row, {
      includeStatementReconcile: true,
      canReconcile: checkPermission(req, 'accounting.invoices.approve'),
      ...getWaiverActionSerializationOptions(req),
      vendorBypassCounts,
    });
    if (row.classification === 'coi') {
      const overrides = await pool.query(
        'SELECT * FROM coi_overrides WHERE document_id = $1 AND revoked_at IS NULL ORDER BY approved_at ASC, id ASC',
        [row.id]
      );
      invoice.coiOverrides = overrides.rows.map((override) => ({
        id: override.id,
        documentId: override.document_id,
        checkId: override.check_id,
        originalStatus: override.original_status,
        reason: override.reason || null,
        configVersionId: override.config_version_id,
        approvedBy: override.approved_by,
        approvedAt: override.approved_at instanceof Date ? override.approved_at.toISOString() : override.approved_at,
      }));
      const effectiveResult = await pool.query('SELECT id, config FROM coi_config_versions WHERE effective_from <= $1 ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1', [req.coiNow instanceof Date ? req.coiNow : new Date()]);
      const effective = effectiveResult.rows[0] ? { id: effectiveResult.rows[0].id, config: { ...effectiveResult.rows[0].config, warnWindowDays: effectiveResult.rows[0].config?.warnWindowDays ?? 30 } } : null;
      invoice.compliance = evaluateCoiCompliance(row, { config: effective?.config || {}, configVersionId: effective?.id || 'legacy-singleton:unversioned', now: req.coiNow instanceof Date ? req.coiNow : new Date(), overrides: invoice.coiOverrides });
    } else invoice.coiOverrides = [];
    res.json(invoice);
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id');
  }
}

module.exports = {
  attachSpectrumDuplicates,
  getInvoice,
  getInvoiceNeighbors,
  getInvoiceStats,
  listDeletedInvoices,
  listInvoices,
};
