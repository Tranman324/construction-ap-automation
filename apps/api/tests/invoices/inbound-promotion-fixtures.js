'use strict';

const Module = require('node:module');

function source(overrides = {}) {
  return {
    source_document_id: 'child-2', source_email_message_id: 'inbound-row-1', graph_message_id: 'graph-msg-1',
    conversation_id: 'conv-1', kind: 'inbound', direction: 'in', correlation_state: 'matched',
    from_address: 'vendor@example.test', subject: 'Re: invoice', body_preview: '<p>safe</p>',
    sanitized_body_html: '<p>safe</p>', file_path: '/safe/source.pdf', file_name: 'source.pdf',
    received_at: '2026-09-16T12:00:00Z', has_attachments: true, attachment_reviewed: false, ...overrides,
  };
}

function database(row) {
  const state = { row, reservations: new Map(), docs: [], updates: [], audits: [], commits: 0, rollbacks: 0, tx: null };
  const active = () => state.tx || state;
  async function query(sql, params = []) {
    if (sql === 'BEGIN') { state.tx = { reservations: new Map(state.reservations), docs: [...state.docs] }; return { rows: [] }; }
    if (sql === 'COMMIT') { state.reservations = state.tx.reservations; state.docs = state.tx.docs; state.tx = null; state.commits++; return { rows: [] }; }
    if (sql === 'ROLLBACK') { state.tx = null; state.rollbacks++; return { rows: [] }; }
    if (sql.startsWith('SELECT d.id AS source_document_id')) return { rows: [row] };
    if (sql.startsWith('INSERT INTO document_inbound_promotions')) {
      const key = `${params[2]}:${params[3]}`;
      if (active().reservations.has(key)) return { rows: [] };
      active().reservations.set(key, { status: 'reserved', resulting_document_id: null });
      return { rows: [{ id: params[0] }] };
    }
    if (sql.startsWith('SELECT status, resulting_document_id')) {
      const prior = active().reservations.get(`${params[0]}:${params[1]}`);
      return { rows: prior ? [prior] : [] };
    }
    if (sql.startsWith('INSERT INTO documents')) { active().docs.push(params[1]); return { rows: [] }; }
    if (sql.startsWith('UPDATE documents SET source_')) { state.updates.push({ sql, params }); return { rows: [] }; }
    if (sql.startsWith('UPDATE document_inbound_promotions')) {
      const prior = [...active().reservations.values()][0];
      if (prior) { prior.status = 'completed'; prior.resulting_document_id = params[1]; }
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE document_email_messages')) return { rows: [] };
    if (sql.startsWith('INSERT INTO audit_log')) { state.audits.push(params); return { rows: [] }; }
    throw new Error(`Unexpected query: ${sql}`);
  }
  return { state, query, async connect() { return { query, release() {} }; } };
}

function pipeline(state, { fail = false } = {}) {
  return {
    async classifyAndExtract(file, context) { state.classify = { file, context }; if (fail) throw new Error('classifier unavailable'); return { classification: 'invoice', confidence: .99, extracted: { invoiceNumber: 'INV 42', vendorName: 'Vendor' } }; },
    async enforceActiveClassification(value) { return value; },
    isInvoiceLikeClassification: () => true,
    normalizeExtractedDates() {},
    parseEmailBodyForJobData: () => ({}),
    matchInvoiceData: async extracted => ({ vendor: { vendorCode: 'VEND' }, overallConfidence: .99, extracted }),
    isExtractionEnabledForClassification: () => true,
    normalizeExtractedFieldsForClassification: value => value,
    matchPerTypeDocumentData: async () => null,
  };
}

function concurrentDatabase(row) {
  const state = { row, reservations: new Map(), docs: [], commits: 0 };
  function client() {
    let tx;
    return { async query(sql, params = []) {
      if (sql === 'BEGIN') { tx = { reservations: new Map(state.reservations), docs: [] }; return { rows: [] }; }
      if (sql === 'COMMIT') { state.reservations = tx.reservations; state.docs.push(...tx.docs); tx = null; state.commits++; return { rows: [] }; }
      if (sql === 'ROLLBACK') { tx = null; return { rows: [] }; }
      if (sql.startsWith('SELECT d.id AS source_document_id')) return { rows: [row] };
      if (sql.startsWith('INSERT INTO document_inbound_promotions')) {
        const key = `${params[2]}:${params[3]}`;
        if (state.reservations.has(key)) return { rows: [] };
        const reservation = { status: 'reserved', resulting_document_id: null };
        state.reservations.set(key, reservation); tx.reservations.set(key, reservation); return { rows: [{ id: params[0] }] };
      }
      if (sql.startsWith('SELECT status, resulting_document_id')) {
        const prior = state.reservations.get(`${params[0]}:${params[1]}`); return { rows: prior ? [prior] : [] };
      }
      if (sql.startsWith('INSERT INTO documents')) { tx.docs.push(params[1]); return { rows: [] }; }
      if (sql.startsWith('UPDATE document_inbound_promotions')) {
        const reservation = [...tx.reservations.values()][0]; reservation.status = 'completed'; reservation.resulting_document_id = params[1]; return { rows: [] };
      }
      return { rows: [] };
    }, release() {} };
  }
  return { state, connect: async () => client(), insertDocument: (entry, db) => db.query('INSERT INTO documents', [entry.id, entry]) };
}

function mailbox({ unavailable = false, downloads = [], attachmentName = 'invoice.pdf', content = Buffer.from('PDF!') } = {}) {
  return {
    async getAttachments() {
      if (unavailable) throw new Error('mailbox source disappeared');
      return [{ id: 'att-1', name: attachmentName, contentType: 'application/pdf', size: content.length, '@odata.type': '#microsoft.graph.fileAttachment' }, { id: 'inline-1', name: 'logo', '@odata.type': '#microsoft.graph.itemAttachment' }];
    },
    async downloadAttachment(_mailbox, _message, id) {
      downloads.push(id);
      return { id, '@odata.type': '#microsoft.graph.fileAttachment', name: attachmentName, contentType: 'application/pdf', contentBytes: content.toString('base64') };
    },
  };
}

async function loadDocumentsRoute(fakeInbound) {
  const target = require.resolve('../../modules/invoices/routes/documents');
  const original = Module._load;
  delete require.cache[target];
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === target && request === '../services/inboundAttachmentPromotionService') return fakeInbound;
    if (parent?.filename === target && request === '../services/spectrumCoiUploadService') return { uploadToSpectrum: async () => undefined };
    return original.call(this, request, parent, isMain);
  };
  try { return require(target); } finally { Module._load = original; delete require.cache[target]; }
}

async function invokePromoteRoute(router, { id, attachmentId, body = {}, user }) {
  const route = router.stack.find(layer => layer.route?.path === '/:id/inbound-attachments/:attachmentId/promote').route;
  const req = { params: { id, attachmentId }, body, query: {}, user, method: 'POST', originalUrl: `/api/documents/${id}/inbound-attachments/${attachmentId}/promote`, log: { warn() {}, error() {}, info() {}, debug() {} } };
  let done;
  const finished = new Promise(resolve => { done = resolve; });
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; done(); return this; } };
  let index = 0;
  const next = async () => { if (route.stack[index]) await route.stack[index++].handle(req, res, next); };
  await next();
  await finished;
  return res;
}

module.exports = { concurrentDatabase, database, invokePromoteRoute, loadDocumentsRoute, mailbox, pipeline, source };
