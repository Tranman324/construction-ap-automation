'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('audit_events migration creates frontend-compatible table and indexes idempotently', () => {
  const migration = read('migrations/2026-06-22_audit_events.sql');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS audit_events/);
  for (const column of [
    'id TEXT PRIMARY KEY',
    'type TEXT NOT NULL',
    'timestamp TIMESTAMPTZ NOT NULL',
    'actor_user_id TEXT',
    'actor_name TEXT',
    'actor_role TEXT',
    'target_type TEXT NOT NULL',
    'target_id TEXT NOT NULL',
    'target_label TEXT',
    'changes JSONB',
    'summary TEXT NOT NULL',
    'module TEXT NOT NULL',
    'severity TEXT NOT NULL',
  ]) {
    assert.match(migration, new RegExp(column.replace(/[()]/g, '\\$&')));
  }

  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_audit_events_type/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_audit_events_target/);
  assert.match(migration, /ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY service_role_full_access ON audit_events/);
});

test('audit events route validates payloads, derives POST actors from req.user, protects reads, and handles duplicate ids', () => {
  const route = read('routes/audit-events.js');
  const server = read('server.js');
  const schemas = read('lib/schemas.js');
  const postRoute = route.slice(
    route.indexOf("router.post('/events'"),
    route.indexOf('\n});', route.indexOf("router.post('/events'")) + 4
  );

  assert.match(schemas, /const auditEventCreateSchema = z\.object/);
  assert.match(schemas, /const auditEventsQuerySchema = z\.object/);
  assert.match(schemas, /'document'[\s\S]*'invoice'[\s\S]*'project'[\s\S]*'user'[\s\S]*'role'[\s\S]*'title_rule'[\s\S]*'feature_request'[\s\S]*'system'/);
  assert.match(schemas, /z\.enum\(\['info', 'warning', 'critical'\]\)/);
  assert.match(postRoute, /router\.post\('\/events', validate\(auditEventCreateSchema\), async/);
  assert.match(postRoute, /Deliberately no requirePermission here/);
  assert.match(postRoute, /actor:\s*\{\s*userId: req\.user\.userId \|\| null,\s*name: req\.user\.email,\s*role: req\.user\.role \|\| null,\s*\}/s);
  assert.doesNotMatch(postRoute, /requirePermission\(/);
  assert.match(route, /requirePermission\(AUDIT_EVENTS_READ_PERMISSION\)/);
  assert.match(route, /platform\.manage_permissions/);
  assert.match(route, /validate\(auditEventsQuerySchema, 'query'\)/);
  assert.match(route, /fail\(res, 409, 'Conflict', 'Audit event id already exists'\)/);
  assert.match(server, /app\.use\('\/api\/audit',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/routes\/audit-events'\)\)/);
});

test('invoice covered mutations emit audit_events while preserving legacy audit_log calls', () => {
  const source = [
    'modules/invoices/routes/invoices.js',
    'modules/invoices/services/invoiceApprovalService.js',
    'modules/invoices/services/bulkActionService.js',
    'modules/invoices/services/invoiceDeletionService.js',
    'modules/invoices/services/documentDiscardService.js',
    'modules/invoices/services/invoiceStatusService.js',
    'modules/invoices/services/submitResult.js',
  ].map(read).join('\n');

  for (const eventType of [
    'invoice.approved',
    'invoice.unapproved',
    'invoice.rejected',
    'invoice.submitted_spectrum',
    'invoice.discarded',
    'invoice.deleted',
    'invoice.permanently_deleted',
    'invoice.restored',
  ]) {
    assert.match(source, new RegExp(`type: '${eventType.replace('.', '\\.')}'`));
  }

  for (const legacyAction of [
    'approved',
    'unapproved',
    'rejected',
    'submitted',
    'discarded',
    'soft-deleted',
    'restored',
  ]) {
    if (legacyAction === 'discarded') {
      assert.match(source, /await emitLegacyInvoiceAuditEvent\(id, 'discarded'/);
    } else {
      assert.match(source, new RegExp(`await audit\\([^\\n]+, '${legacyAction}'`));
    }
  }
});

test('bulk invoice mutations emit audit_events for each supported action', () => {
  const source = read('modules/invoices/services/bulkActionService.js');

  assert.match(source, /emitInvoiceAuditEvent/);
  assert.match(source, /emitBulkInvoiceAuditEvent/);
  for (const eventType of [
    'invoice.approved',
    'invoice.unapproved',
    'invoice.discarded',
    'invoice.reviewed',
    'invoice.filed',
  ]) {
    assert.match(source, new RegExp(`type: '${eventType.replace('.', '\\.')}'`));
  }
  // Bulk reject remains unsupported; bulk approve shares the single-path gate.
  assert.doesNotMatch(source, /type: 'invoice\.rejected'/);

  assert.match(source, /await audit\(id, action, legacyChanges\)/);
  assert.match(source, /await audit\(id, 'filed', legacyChanges\)/);
});

test('backend docs call out browser emitter deduplication companion work', () => {
  const docs = read('docs/audit-events.md');

  assert.match(docs, /Server-side emission is the source of truth/);
  assert.match(docs, /disable browser-side `auditEmitter\.ts` calls/);
  assert.match(docs, /avoid duplicate rows/);
});
