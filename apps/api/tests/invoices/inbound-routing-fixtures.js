'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function withPipelinePool(pool, fn) {
  const dbPath = require.resolve('../../lib/db');
  const pipelinePath = require.resolve('../../modules/invoices/services/pipeline');
  const junkFilterPath = require.resolve('../../modules/invoices/services/junkFilterService');
  const beforeDb = require.cache[dbPath], beforePipeline = require.cache[pipelinePath];
  const beforeJunkFilter = require.cache[junkFilterPath];
  delete require.cache[pipelinePath]; delete require.cache[junkFilterPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
  try { return await fn(require('../../modules/invoices/services/pipeline')); }
  finally {
    if (beforeDb) require.cache[dbPath] = beforeDb; else delete require.cache[dbPath];
    if (beforePipeline) require.cache[pipelinePath] = beforePipeline;
    if (beforeJunkFilter) require.cache[junkFilterPath] = beforeJunkFilter; else delete require.cache[junkFilterPath];
  }
}

function pipelinePool({ referenceRows = [], conversationRows = [], subjectRows = [], duplicateRows = [], failAudit = false,
  failAuditType = null, failDocumentInsert = false, exhaustedError = null } = {}) {
  const state = { tx: null, inbound: [], inboundRows: [], documents: [], promotions: new Map(), processed: new Set(),
    internetIds: new Map(), audits: 0, errors: 0, commits: 0, rollbacks: 0, calls: [] };
  const snapshot = source => ({ inbound: source.inbound.map(row => ({ ...row })), inboundRows: source.inboundRows.map(row => ({ ...row })),
    documents: source.documents.map(row => ({ ...row })), promotions: new Map([...source.promotions].map(([key, row]) => [key, { ...row }])),
    processed: new Set(source.processed), internetIds: new Map(source.internetIds), audits: source.audits, errors: source.errors });
  const active = () => state.tx || state;
  async function query(sql, params = []) {
    state.calls.push({ sql, params });
    if (sql === 'BEGIN') { assert.equal(state.tx, null); state.tx = snapshot(state); return { rows: [] }; }
    if (sql === 'COMMIT') { Object.assign(state, snapshot(state.tx)); state.tx = null; state.commits++; return { rows: [] }; }
    if (sql === 'ROLLBACK') { state.tx = null; state.rollbacks++; return { rows: [] }; }
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/SELECT email_id, internet_message_id FROM processed_emails/.test(sql)) return { rows: [...active().processed].map(email_id => ({ email_id, internet_message_id: active().internetIds.get(email_id) || null })) };
    if (/SELECT 1 FROM processed_emails/.test(sql)) return { rows: active().processed.has(params[0]) ? [{ '?column?': 1 }] : [] };
    if (/SELECT retry_count, max_retries, error_stage, error_message FROM pipeline_errors/.test(sql)) {
      return { rows: exhaustedError ? [exhaustedError] : [] };
    }
    if (/internet_message_id = ANY/.test(sql)) return { rows: referenceRows };
    if (/m\.conversation_id=\$1/.test(sql)) return { rows: conversationRows };
    if (/m\.sent_at >= now\(\) - interval '14 days'/.test(sql)) return { rows: subjectRows };
    if (/SELECT d\.id AS source_document_id/.test(sql)) {
      const row = active().inboundRows.find(item => item.documentId === params[0] && item.state === 'matched');
      return { rows: row ? [{ source_document_id: row.documentId, source_email_message_id: row.id, graph_message_id: row.graphMessageId,
        internet_message_id: row.internetMessageId, conversation_id: row.conversationId, kind: row.kind, direction: 'in',
        correlation_state: row.state, correlation_reason: row.reason, from_address: row.fromAddress, subject: row.subject,
        body_preview: row.bodyPreview, sanitized_body_html: row.sanitizedBodyHtml, received_at: row.receivedAt,
        has_attachments: row.hasAttachments, attachment_reviewed: row.attachmentReviewed }] : [] };
    }
    if (/SELECT id, status FROM documents/.test(sql)) return { rows: duplicateRows };
    if (/SELECT id FROM document_email_messages/.test(sql)) {
      const row = active().inboundRows.find(item => item.id === params[0] || (params[1] && item.internetMessageId === params[1]));
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (/SELECT id FROM documents WHERE email_from/.test(sql)) {
      const row = active().documents.find(item => item.email_from === params[0] && item.email_received_at === params[1] && (item.email_subject || '') === params[2]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (/SELECT COUNT\(\*\) AS cnt FROM documents/.test(sql)) return { rows: [{ cnt: '0' }] };
    if (/INSERT INTO document_email_messages/.test(sql)) {
      const columns = sql.match(/INSERT INTO document_email_messages\s*\(([^)]*)\)/)[1].split(',').map(value => value.trim());
      const values = sql.match(/VALUES\s*\(([^)]*)\)/)[1].split(',').map(value => value.trim());
      const get = column => { const value = values[columns.indexOf(column)]; const p = value?.match(/^\$(\d+)$/);
        if (p) return params[Number(p[1]) - 1]; if (value === 'true') return true; if (value === 'false') return false; return null; };
      const row = { id: get('id'), documentId: get('document_id'), kind: get('kind'), internetMessageId: get('internet_message_id'),
        graphMessageId: get('graph_message_id'), conversationId: get('conversation_id'), fromAddress: get('from_address'),
        subject: get('subject'), bodyPreview: get('body_preview'), sanitizedBodyHtml: get('sanitized_body_html'),
        hasAttachments: get('has_attachments'), attachmentReviewed: get('attachment_reviewed'),
        state: get('correlation_state'), reason: get('correlation_reason'), receivedAt: get('received_at') };
      active().inboundRows.push(row); active().inbound.push({ documentId: row.documentId, state: row.state, reason: row.reason });
      return { rows: [{ id: row.id }] };
    }
    if (/INSERT INTO documents/.test(sql)) {
      if (state.failDocumentInsert) { state.failDocumentInsert = false; throw new Error('synthetic document insert failure'); }
      if (/\([\s\S]*\)\s*VALUES/.test(sql)) {
        const columns = sql.match(/INSERT INTO documents \(([^)]*)\)/)[1].split(',').map(value => value.trim());
        active().documents.push(Object.fromEntries(columns.map((column, index) => [column, params[index]])));
      } else active().documents.push({ id: params[0] });
      return { rows: [] };
    }
    if (/INSERT INTO document_inbound_promotions/.test(sql)) {
      const key = `${params[2]}:${params[3]}`; if (active().promotions.has(key)) return { rows: [] };
      const completed = /'completed'/.test(sql);
      active().promotions.set(key, { id: params[0], sourceDocumentId: params[1], sourceEmailMessageId: params[2],
        sourceAttachmentId: params[3], status: completed ? 'completed' : 'reserved', actorUserId: completed ? 'pipeline' : params[4],
        resultingDocumentId: completed ? params[4] : null });
      return { rows: [{ id: params[0] }] };
    }
    if (/SELECT status, resulting_document_id/.test(sql)) {
      const row = active().promotions.get(`${params[0]}:${params[1]}`);
      return { rows: row ? [{ status: row.status, resulting_document_id: row.resultingDocumentId }] : [] };
    }
    if (/UPDATE document_inbound_promotions/.test(sql)) {
      const row = [...active().promotions.values()].find(item => item.id === params[0]);
      if (row) { row.status = 'completed'; row.resultingDocumentId = params[1]; } return { rows: [] };
    }
    if (/UPDATE documents SET source_document_id/.test(sql)) {
      const row = active().documents.find(item => item.id === params[3]);
      if (row) Object.assign(row, { source_document_id: params[0], source_email_message_id: params[1], source_attachment_id: params[2] });
      return { rows: [] };
    }
    if (/UPDATE document_email_messages SET attachment_reviewed=true/.test(sql)) {
      const row = active().inboundRows.find(item => item.id === params[0]); if (row) row.attachmentReviewed = true; return { rows: [] };
    }
    if (/UPDATE junk_attachments|INSERT INTO junk_attachments|INSERT INTO audit_log|DELETE FROM attachment_skip_log|INSERT INTO attachment_skip_log/.test(sql)) return { rows: [] };
    if (/SELECT 1 FROM documents WHERE sha256 = \$1 AND status = 'discarded'/.test(sql)) return { rows: [] };
    if (/INSERT INTO audit_events/.test(sql)) {
      if (state.failAudit || (state.failAuditType && params[1] === state.failAuditType)) {
        state.failAudit = false; state.failAuditType = null; throw new Error('inbound audit insert failed');
      }
      active().audits++; return { rows: [{}] };
    }
    if (/INSERT INTO processed_emails/.test(sql)) { active().processed.add(params[0]); if (params[2]) active().internetIds.set(params[0], params[2]); return { rows: [] }; }
    if (/SELECT id, retry_count, max_retries FROM pipeline_errors/.test(sql)) return { rows: [] };
    if (/INSERT INTO pipeline_errors/.test(sql)) { state.errors++; return { rows: [] }; }
    if (/UPDATE pipeline_errors/.test(sql)) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  }
  Object.assign(state, { failAudit, failAuditType, failDocumentInsert });
  return { state, query, async connect() { return { query, release() {} }; } };
}

function syntheticPdf(name = 'reply.pdf') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-routing-'));
  const filePath = path.join(directory, name); fs.writeFileSync(filePath, Buffer.from('%PDF-1.4\nsynthetic attachment content\n%%EOF'));
  return { directory, filePath };
}

function syntheticTinyImage() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-filter-'));
  const filePath = path.join(directory, 'signature.png'); fs.writeFileSync(filePath, Buffer.alloc(120, 1));
  return { directory, filePath };
}

function targetPool(targets, { conversations = targets, referenceRows = targets } = {}) { const base = pipelinePool({ referenceRows, conversationRows: conversations });
  base.state.documents.push(...targets.map(row => ({ ...row })));
  const active = () => base.state.tx || base.state, byId = id => active().documents.filter(row => row.id === id);
  const bySuffix = suffix => {
    const code = String(suffix).replace(/^%-?/, '').toLowerCase();
    return active().documents.filter(row => row.id.toLowerCase().endsWith(`-${code}`));
  };
  async function query(sql, params = []) {
    if (/FROM documents[\s\S]*?WHERE id (?:I)?LIKE \$1/i.test(sql)) {
      let rows = bySuffix(params[0]);
      if (/classification IN/.test(sql)) rows = rows.filter(row => ['pending', 'modified', 'approved', 'reviewed'].includes(row.status)
        && ['invoice', 'pay-application'].includes(row.classification) && row.lien_waiver_required === true
        && row.waiver_requested_at && !row.linked_lien_waiver_id && !row.deleted_at);
      return { rows: rows.map(row => ({ ...row })) };
    }
    if (/FROM documents[\s\S]*?WHERE id = \$1/.test(sql)) {
      const row = byId(params[0])[0];
      const eligible = row && ['invoice', 'pay-application'].includes(row.classification)
        && ['pending', 'modified', 'approved', 'reviewed'].includes(row.status) && row.lien_waiver_required === true
        && row.waiver_requested_at && !row.linked_lien_waiver_id && !row.deleted_at;
      return { rows: row && (!/classification IN/.test(sql) || eligible) ? [{ ...row }] : [] };
    }
    if (/SELECT id, linked_lien_waiver_id, classification, email_subject, vendor_code/.test(sql)) return { rows: byId(params[0]).map(row => ({ ...row })) };
    if (/SELECT to_json FROM document_email_messages/.test(sql)) {
      const request = byId(params[0])[0];
      return { rows: request?.waiver_request_recipient && /Lien Waiver Request/i.test(request.waiver_request_subject || '')
        ? [{ to_json: [request.waiver_request_recipient] }] : [] };
    }
    if (/UPDATE documents SET waiver_auto_link_skip_reason/.test(sql)) {
      const parameterized = /waiver_auto_link_skip_reason = \$1/.test(sql);
      const row = active().documents.find(item => item.id === (parameterized ? params[1] : params[0]));
      if (row) row.waiver_auto_link_skip_reason = sql.match(/'([^']+)'/)?.[1] || (parameterized ? params[0] : params[1]);
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (/UPDATE documents\s+SET linked_lien_waiver_id = \$1, waiver_link_source/.test(sql)) {
      const row = active().documents.find(item => item.id === params[3]);
      if (row) Object.assign(row, { linked_lien_waiver_id: params[0], waiver_link_source: params[1] });
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (/UPDATE documents\s+SET linked_lien_waiver_id = \$1,\s+filed = true/.test(sql)) {
      const row = active().documents.find(item => item.id === params[2]);
      if (row) Object.assign(row, { linked_lien_waiver_id: params[0], filed: true });
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    return base.query(sql, params);
  }
  return { state: base.state, query, connect: async () => ({ query, release() {} }) };
}

async function withAutoLink(pool, fn) {
  const servicePath = require.resolve('../../modules/invoices/services/waiverAutoLinkService');
  const supabasePath = require.resolve('../../modules/invoices/services/supabase');
  const auditPath = require.resolve('../../lib/auditEvents');
  const prior = [servicePath, supabasePath, auditPath].map(file => require.cache[file]);
  delete require.cache[servicePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { pool } };
  require.cache[auditPath] = { id: auditPath, filename: auditPath, loaded: true, exports: { emitLegacyInvoiceAuditEvent: async () => {}, insertAuditEvent: async () => {} } };
  try { return await fn(require('../../modules/invoices/services/waiverAutoLinkService').autoLinkWaiver); }
  finally { [servicePath, supabasePath, auditPath].forEach((file, i) => { if (prior[i]) require.cache[file] = prior[i]; else delete require.cache[file]; }); }
}

module.exports = { pipelinePool, syntheticPdf, syntheticTinyImage, targetPool, withAutoLink, withPipelinePool };
