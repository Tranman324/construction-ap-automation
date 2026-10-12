'use strict';
const { createEmailService } = require('../../modules/invoices/services/email');
const actor = { userId: 'actor-1', email: 'actor@northwindcg.example', role: 'employee' };
const token = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';
function fixture(options = {}) {
  const rows = []; const events = []; const calls = []; const logs = []; const sqls = [];
  const doc = { id: 'doc-1', email_message_id: 'source', email_from: 'vendor@example.com',
    email_subject: 'RE: Original', vendor_name: 'Vendor', invoice_number: 'INV-1', job_match_number: 'J1',
    vendor_code: 'VEND', file_path: '/synthetic/doc.pdf', file_name: 'doc.pdf', ...options.doc };
  let chain = Promise.resolve(); let clock = Date.now(); let countDaily = options.daily || 0;
  async function query(sql, values = []) {
    sqls.push([sql, values]);
    if (sql.includes('FROM documents')) return { rows: [doc] };
    if (sql.includes('FROM vendor_mappings')) return { rows: options.vendorMappings || [{ domain: 'example.com', vendor_email: null }] };
    if (sql.includes('FROM vendor_contacts')) return { rows: options.vendorContacts || [] };
    if (sql.includes('FROM toolbox_users')) return { rows: [{ name: 'Actual Actor' }] };
    if (sql.includes('SELECT id FROM document_email_messages')) return { rows: rows.filter(r =>
      r.token === values[1] && (r.at > clock - 60000 || ['pending', 'ambiguous'].includes(r.status))) };
    if (sql.includes('count(*)')) return { rows: [{ daily: countDaily, minute: rows.filter(r => r.at > clock - 60000).length }] };
    if (sql.startsWith('INSERT INTO document_email')) {
      const [id, documentId, kind, actorId, sendToken] = values;
      rows.push({ id, doc: documentId, kind, actorId, token: sendToken, status: 'pending', at: clock }); countDaily++;
      events.push('reserved');
    }
    if (sql.includes('graph_message_id=$2')) { rows.find(r => r.id === values[0]).graph = values[1]; events.push('draft-recorded'); }
    if (sql.includes('send_started_at=now()')) events.push('send-started');
    if (sql.includes('SET status=$2') && values[1] === 'confirmed' && options.confirmationFailure) {
      events.push('confirmation-persist-failed'); throw Error('synthetic confirmation write failure');
    }
    if (sql.includes('SET status=$2')) { rows.find(r => r.id === values[0]).status = values[1]; events.push(values[1]); }
    if (sql.includes('FROM document_email_messages')) return { rows: options.threadRows || [] };
    return { rows: [] };
  }
  const pool = { query, async connect() {
    let releaseLock;
    return { async query(sql, values) {
      if (sql.includes('pg_advisory_xact_lock')) {
        const prev = chain; chain = new Promise(resolve => { releaseLock = resolve; }); await prev;
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') releaseLock?.();
      return query(sql, values);
    }, release() {} };
  } };
  async function graph(url, opts = {}) {
    calls.push({ url, ...opts });
    if (options.graph) { const value = await options.graph(url, opts); if (value !== undefined) return value; }
    if (url.startsWith('/users?')) return { value: options.users || [{ id: recipient, displayName: 'PM One', mail: 'pm@northwindcg.example' }] };
    if (opts.method === 'POST' && (url.endsWith('/createReply') || url.endsWith('/messages'))) {
      events.push('draft'); return { id: 'immutable', conversationId: 'conversation', body: { contentType: 'HTML', content: '<blockquote>original</blockquote>' } };
    }
    if (url.endsWith('/send')) { events.push('send'); return null; }
    if (url.includes('$select=id,isDraft')) return { id: 'immutable', isDraft: false, internetMessageId: '<sent@example.com>', sentDateTime: '2026-09-15T12:00:00Z' };
    return null;
  }
  const config = { mailbox: 'invoices@northwindcg.example', appBaseUrl: 'https://toolbox.example',
    internalDomains: ['northwindcg.example'], timeZone: 'America/New_York', dailyCap: 100, disabled: () => options.disabled || false };
  const service = createEmailService({ pool, graph, config,
    fs: { stat: async () => { if (options.fileMissing) throw Error('missing'); return { isFile: () => true, size: options.size || 3 }; },
      readFile: async () => Buffer.alloc(options.size || 3) },
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    loadJobPmMap: () => ({ jobPmMap: { J1: 'PM One' } }),
    touchVendorContact: async () => { events.push('contact-touched'); },
    insertAuditEvent: async e => { if (options.auditFailure) throw Error('audit'); events.push(e); },
  });
  return { service, rows, calls, events, logs, sqls, advance: ms => { clock += ms; } };
}
module.exports = { fixture, actor, token, recipient };
