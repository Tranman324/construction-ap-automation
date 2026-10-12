'use strict';

const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ENSURE_SCHEMA_MIGRATIONS_SQL,
  MIGRATION_FILENAME_RE,
  applyPendingMigrations,
  assertConfirmedForLiveMutation,
  classifyMigrationSql,
  getTargetInfo,
  listMigrationFiles,
  planMigrations,
} = require('../../lib/migrations');
const { parseArgs } = require('../../scripts/migrate');

const root = path.resolve(__dirname, '..', '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

test('migration files are named correctly and sorted lexically', () => {
  const migrations = listMigrationFiles(path.join(root, 'migrations'));
  const filenames = migrations.map((migration) => migration.filename);

  assert.deepEqual(filenames, [...filenames].sort());
  for (const filename of filenames) {
    assert.match(filename, MIGRATION_FILENAME_RE);
  }
});

test('inbound correlation follow-up migration is additive and preserves applied history', async () => {
  const historicalFilename = '2026-09-16_document_email_messages.sql';
  const followUpFilename = '2026-09-17_document_email_correlation.sql';
  const historical = fs.readFileSync(path.join(root, 'migrations', historicalFilename), 'utf8');
  const followUp = fs.readFileSync(path.join(root, 'migrations', followUpFilename), 'utf8');
  // Applied migrations are immutable: pin the exact bytes that shipped (sha256 of the file as applied).
  const HISTORICAL_SHA256 = 'a8743af03079550a8f900a5fff789c1386dccfbd429db5b03bac50191aad5106';
  assert.equal(require('node:crypto').createHash('sha256').update(historical).digest('hex'), HISTORICAL_SHA256);
  assert.doesNotMatch(historical, /correlation_state|correlation_reason/);
  assert.doesNotMatch(historical, /in_reply_to TEXT|document_email_inbound_internet_uidx/);
  assert.match(followUp, /^[\s\S]*BEGIN;[\s\S]*COMMIT;\s*$/i);
  assert.match(followUp, /ADD COLUMN IF NOT EXISTS in_reply_to TEXT/i);
  assert.match(followUp, /ADD COLUMN IF NOT EXISTS correlation_state TEXT NOT NULL DEFAULT 'matched'/i);
  assert.match(followUp, /ADD COLUMN IF NOT EXISTS correlation_reason TEXT/i);
  assert.match(followUp, /CREATE UNIQUE INDEX IF NOT EXISTS document_email_inbound_internet_uidx/i);
  assert.equal(classifyMigrationSql(followUp).classification, 'safe-rerun');

  async function applyFor(appliedFilenames, migrations) {
    const applied = new Set(appliedFilenames);
    const statements = [];
    const pool = { async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql === ENSURE_SCHEMA_MIGRATIONS_SQL) return { rows: [] };
      if (sql.includes("SELECT to_regclass('public.schema_migrations')")) return { rows: [{ table_name: 'schema_migrations' }] };
      if (sql === 'SELECT filename FROM public.schema_migrations ORDER BY filename') {
        return { rows: [...applied].map((filename) => ({ filename })) };
      }
      return { rows: [] };
    } };
    const plan = await applyPendingMigrations(pool, migrations, () => {});
    return { plan, statements };
  }

  const followUpMigration = { filename: followUpFilename, sql: followUp, safety: classifyMigrationSql(followUp) };
  const fresh = await applyFor([], [followUpMigration]);
  assert.deepEqual(fresh.plan.applicable.map((migration) => migration.filename), [followUpFilename]);
  assert.equal(fresh.statements.some(({ sql }) => sql === followUp), true);

  const migrations = [
    { filename: historicalFilename, sql: historical, safety: classifyMigrationSql(historical) },
    followUpMigration,
  ];
  const alreadyApplied = await applyFor([historicalFilename], migrations);
  assert.deepEqual(alreadyApplied.plan.skipped.map((migration) => migration.filename), [historicalFilename]);
  assert.deepEqual(alreadyApplied.plan.applicable.map((migration) => migration.filename), [followUpFilename]);
  assert.equal(alreadyApplied.statements.some(({ sql }) => sql === historical), false);
  assert.equal(alreadyApplied.statements.some(({ sql }) => sql === followUp), true);
});

test('document statement and waiver migration is additive and transaction-wrapped', () => {
  const sql = fs.readFileSync(
    path.join(root, 'migrations', '2026-07-02_document_statement_waiver_columns.sql'),
    'utf8',
  );

  assert.match(sql, /^\s*BEGIN;\s/i);
  assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);

  for (const columnDefinition of [
    'sharepoint_item_id TEXT',
    'sharepoint_filename TEXT',
    'statement_lines JSONB',
    'waiver_on_document BOOLEAN NOT NULL DEFAULT false',
    'waiver_on_document_at TIMESTAMPTZ',
    'waiver_on_document_by TEXT',
  ]) {
    assert.match(
      sql,
      new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${columnDefinition}`, 'i'),
    );
  }
});

test('waiver request conversation migration is additive and transaction-wrapped', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations', '2026-08-03_waiver_request_conversation.sql'), 'utf8');
  assert.match(sql, /^\s*BEGIN;\s/i);
  assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+waiver_request_conversation_id\s+TEXT/i);
});

test('document flag columns migration is additive and transaction-wrapped', () => {
  const sql = fs.readFileSync(
    path.join(root, 'migrations', '2026-07-17_document_flag_columns.sql'),
    'utf8',
  );

  assert.match(sql, /^\s*BEGIN;\s/i);
  assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);

  for (const columnDefinition of [
    'flagged_at TIMESTAMPTZ',
    'flagged_by TEXT',
    'flag_reason TEXT',
  ]) {
    assert.match(
      sql,
      new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${columnDefinition}`, 'i'),
    );
  }
});

test('document destinations migration is additive, transaction-wrapped, and idempotently seeded', () => {
  const sql = fs.readFileSync(
    path.join(root, 'migrations', '2026-07-18_document_destinations.sql'),
    'utf8',
  );

  assert.match(sql, /^\s*BEGIN;\s/i);
  assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS document_destinations/i);
  assert.match(sql, /config JSONB NOT NULL/i);
  // Re-runnable seed: the singleton insert must not duplicate on re-apply.
  assert.match(sql, /INSERT INTO document_destinations[\s\S]*ON CONFLICT \(id\) DO NOTHING/i);
});

test('coi compliance config migration is additive, transaction-wrapped, and idempotently seeded', () => {
  const sql = fs.readFileSync(
    path.join(root, 'migrations', '2026-07-18_coi_compliance_config.sql'),
    'utf8',
  );

  assert.match(sql, /^\s*BEGIN;\s/i);
  assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS coi_compliance_config/i);
  assert.match(sql, /config JSONB NOT NULL/i);
  assert.match(sql, /INSERT INTO coi_compliance_config[\s\S]*ON CONFLICT \(id\) DO NOTHING/i);
});

test('COI decision and access migration is additive, classified safe, and grants only approved roles', () => {
  const filename = '2026-07-30_coi_decision_access.sql';
  const sql = fs.readFileSync(path.join(root, 'migrations', filename), 'utf8');

  assert.match(sql, /^\s*BEGIN;\s/i);
  assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS coi_overrides/i);
  assert.match(sql, /document_id TEXT NOT NULL REFERENCES documents\(id\) ON DELETE CASCADE/i);
  for (const columnDefinition of [
    'id TEXT PRIMARY KEY',
    'check_id TEXT NOT NULL',
    'original_status TEXT NOT NULL',
    'config_version_id TEXT NOT NULL',
    'approved_by TEXT NOT NULL',
    'approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    'revoked_by TEXT',
    'revoked_at TIMESTAMPTZ',
  ]) {
    assert.match(sql, new RegExp(columnDefinition.replace(/[()]/g, '\\$&'), 'i'));
  }
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS coi_overrides_one_active_check[\s\S]*ON coi_overrides \(document_id, check_id\)[\s\S]*WHERE revoked_at IS NULL/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS coi_manual_values JSONB/i);
  assert.match(sql, /'accounting\.invoices\.coi_override', 'accounting'/i);
  assert.match(sql, /'accounting\.invoices\.manage_settings', 'accounting'/i);
  assert.match(sql, /6ae067e6-6b6c-44f1-8765-9b745e21e7e5/);
  assert.match(sql, /0782c7ec-4f29-4f0b-8a19-277ab6aa4b86/);
  assert.doesNotMatch(sql, /['"]leadership['"]/i);
  assert.doesNotMatch(sql, /manage_settings', TRUE/i);
  assert.doesNotMatch(sql, /request_waiver/i);
  assert.match(sql, /UPDATE toolbox_users[\s\S]*SET role_version = role_version \+ 1[\s\S]*WHERE role_id IN/i);
  assert.equal(classifyMigrationSql(sql).classification, 'safe-rerun');
});

test('COI config versions migration is additive, safely backfills singleton version one, and orders deterministically', () => {
  const filename = '2026-07-30_coi_config_versions.sql';
  const sql = fs.readFileSync(path.join(root, 'migrations', filename), 'utf8');
  assert.match(sql, /^\s*BEGIN;\s/i); assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS coi_config_versions/i);
  assert.match(sql, /effective_from TIMESTAMPTZ NOT NULL/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS coi_config_versions_effective_order[\s\S]*effective_from DESC, created_at DESC, id DESC/i);
  assert.match(sql, /author TEXT NOT NULL/i);
  assert.match(sql, /INSERT INTO coi_config_versions[\s\S]*'v1'[\s\S]*COALESCE\(updated_at, NOW\(\)\)[\s\S]*COALESCE\(updated_by, 'seed'\)[\s\S]*FROM coi_compliance_config[\s\S]*ON CONFLICT \(id\) DO NOTHING/i);
  assert.equal(classifyMigrationSql(sql).classification, 'safe-rerun');
  assert.equal(classifyMigrationSql('INSERT INTO coi_config_versions (id) VALUES (\'x\')').classification, 'mark-applied');
  assert.equal(classifyMigrationSql('CREATE INDEX bad ON coi_config_versions (author)').classification, 'mark-applied');
});

test('Exhibit E migration inserts one literal v2 config with the approved runner signature', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations', '2026-08-18_coi_exhibit_e_config.sql'), 'utf8');
  assert.match(sql, /^\s*BEGIN;\s/i); assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|JSONB_SET|FROM\s+coi_config_versions)\b/i);
  assert.match(sql, /INSERT INTO coi_config_versions \(id, version, effective_from, config, created_at, author\)\s+SELECT 'v2-exhibit-e', 2, NOW\(\),/i);
  assert.match(sql, /"warnWindowDays":30/);
  assert.match(sql, /"carrierRating":\{"minRating":"A-","minFsc":"VII"\}/);
  assert.match(sql, /"tier":"exception"/);
  assert.match(sql, /"type":"pollution"/);
  assert.match(sql, /"umbrella[\s\S]*?"minimum":2000000/);
  assert.match(sql, /"workers-comp"[\s\S]*?"minimum":500000/);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/i);
  assert.equal(classifyMigrationSql(sql).classification, 'safe-rerun');
});

test('document destination versions migration is additive, safely backfills singleton version one, and orders deterministically', () => {
  const filename = '2026-07-31_document_destination_versions.sql';
  const sql = fs.readFileSync(path.join(root, 'migrations', filename), 'utf8');
  assert.match(sql, /^\s*BEGIN;\s/i); assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS document_destination_versions/i);
  assert.match(sql, /effective_from TIMESTAMPTZ NOT NULL/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS document_destination_versions_effective_order[\s\S]*effective_from DESC, created_at DESC, id DESC/i);
  assert.match(sql, /author TEXT NOT NULL/i);
  assert.match(sql, /INSERT INTO document_destination_versions[\s\S]*'v1'[\s\S]*COALESCE\(updated_at, NOW\(\)\)[\s\S]*COALESCE\(updated_by, 'seed'\)[\s\S]*FROM document_destinations[\s\S]*ON CONFLICT \(id\) DO NOTHING/i);
  assert.equal(classifyMigrationSql(sql).classification, 'safe-rerun');
  assert.equal(classifyMigrationSql('INSERT INTO document_destination_versions (id) VALUES (\'x\')').classification, 'mark-applied');
  assert.equal(classifyMigrationSql('CREATE INDEX bad ON document_destination_versions (author)').classification, 'mark-applied');
});

test('job feedback mappings migration creates both caches additively in one transaction', () => {
  const sql = fs.readFileSync(
    path.join(root, 'migrations', '2026-07-09_job_feedback_mappings.sql'),
    'utf8',
  );

  assert.match(sql, /^\s*BEGIN;\s/i);
  assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  const subjectTable = sql.match(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+subject_job_mappings\s*\(([\s\S]*?)\);/i,
  );
  const senderTable = sql.match(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+sender_job_mappings\s*\(([\s\S]*?)\);/i,
  );
  assert.ok(subjectTable);
  assert.ok(senderTable);

  for (const columnDefinition of [
    'vendor_code TEXT NOT NULL',
    'subject_hash TEXT NOT NULL',
    'job_number TEXT NOT NULL',
    'subject_raw TEXT',
    'created_at TIMESTAMPTZ DEFAULT now()',
    'updated_at TIMESTAMPTZ DEFAULT now()',
  ]) {
    assert.match(subjectTable[1], new RegExp(columnDefinition.replace(/[()]/g, '\\$&'), 'i'));
  }
  assert.match(subjectTable[1], /PRIMARY\s+KEY\s*\(vendor_code,\s*subject_hash\)/i);

  for (const columnDefinition of [
    'vendor_code TEXT NOT NULL',
    'sender_domain TEXT NOT NULL',
    'job_number TEXT NOT NULL',
    'hit_count INTEGER DEFAULT 1',
    'created_at TIMESTAMPTZ DEFAULT now()',
    'updated_at TIMESTAMPTZ DEFAULT now()',
  ]) {
    assert.match(senderTable[1], new RegExp(columnDefinition.replace(/[()]/g, '\\$&'), 'i'));
  }
  assert.match(senderTable[1], /PRIMARY\s+KEY\s*\(vendor_code,\s*sender_domain\)/i);
});

test('historical migration safety classifications are explicit', () => {
  const classifications = Object.fromEntries(
    listMigrationFiles(path.join(root, 'migrations')).map((migration) => [
      migration.filename,
      migration.safety.classification,
    ]),
  );

  assert.equal(classifications['2026-04-11_rls_hardening.sql'], 'mark-applied');
  assert.equal(classifications['2026-04-11_soft_delete.sql'], 'safe-rerun');
  assert.equal(classifications['2026-04-13_job_feedback_cache.sql'], 'mark-applied');
  assert.equal(classifications['2026-04-29_feature_requests_rls.sql'], 'mark-applied');
  assert.equal(classifications['2026-05-07_add_phone_to_toolbox_users.sql'], 'safe-rerun');
  assert.equal(classifications['2026-06-22_permission_lien_waiver_gates.sql'], 'safe-rerun');
  assert.equal(classifications['2026-06-22_audit_events.sql'], 'safe-rerun');
  assert.equal(classifications['2026-06-30_document_type_mapping.sql'], 'mark-applied');
  assert.equal(classifications['2026-07-14_waiver_requirement_detection.sql'], 'mark-applied');
  assert.equal(classifications['2026-07-15_default_cost_type_from_subcontract.sql'], 'mark-applied');
  assert.equal(classifications['2026-07-31_warranty_manual_values.sql'], 'safe-rerun');
});

test('the derived allowlist preserves the exact 38 safe migrations and 14 manual-review migrations', () => {
  const migrations = listMigrationFiles(path.join(root, 'migrations'));
  const classified = new Map(migrations.map((migration) => [
    migration.filename,
    migration.safety,
  ]));
  const safeRerun = [
    '2026-04-11_soft_delete.sql',
    '2026-05-07_add_phone_to_toolbox_users.sql',
    '2026-06-22_audit_events.sql',
    '2026-06-22_permission_lien_waiver_gates.sql',
    '2026-06-23_permission_rules_gates.sql',
    '2026-06-25_permission_accounting_namespace.sql',
    '2026-06-30_pipeline_no_attachment_fixes.sql',
    '2026-06-30_undo_system.sql',
    '2026-07-01_document_filing_metadata.sql',
    '2026-07-01_permission_manage_classifications.sql',
    '2026-07-02_document_statement_waiver_columns.sql',
    '2026-07-04_spectrum_coi_upload.sql',
    '2026-07-06_page_classifications_column.sql',
    '2026-07-07_coi_compliance_data.sql',
    '2026-07-09_job_feedback_mappings.sql',
    '2026-07-14_grandfather_pre_gate_approvals.sql',
    '2026-07-14_permission_request_waiver.sql',
    '2026-07-14_waiver_link_source.sql',
    '2026-07-14_waiver_request_tracking.sql',
    '2026-07-14_waiver_type_column.sql',
    '2026-07-16_purge_audit_and_subject_feedback.sql',
    '2026-07-17_document_flag_columns.sql',
    '2026-07-30_coi_decision_access.sql',
    '2026-07-30_coi_config_versions.sql',
    '2026-07-31_document_destination_versions.sql',
    '2026-07-31_statement_attributes.sql',
    '2026-07-31_warranty_manual_values.sql',
    '2026-08-03_waiver_request_conversation.sql',
    '2026-08-05_document_discard_source.sql',
    '2026-08-05_document_doc_title.sql',
    '2026-08-18_coi_exhibit_e_config.sql',
    '2026-08-26_vendor_contacts.sql',
    '2026-08-26_vendor_contacts_rls.sql',
    '2026-08-26_waiver_bundle_skip_reason.sql',
    '2026-09-04_retire_needs_review_status.sql',
    '2026-09-07_add_field_origins.sql',
    '2026-09-10_duplicate_bypass.sql',
    '2026-09-17_document_email_correlation.sql',
  ];
  const markApplied = [
    '2026-04-11_rls_hardening.sql',
    '2026-04-13_job_feedback_cache.sql',
    '2026-04-29_feature_requests_rls.sql',
    '2026-06-30_document_type_mapping.sql',
    '2026-07-14_waiver_requirement_detection.sql',
    '2026-07-15_default_cost_type_from_subcontract.sql',
    '2026-07-18_coi_compliance_config.sql',
    '2026-07-18_document_destinations.sql',
    // BIGSERIAL is outside the approved safe-rerun column grammar; applied
    // manually and marked (same route as the 2026-07-18 files).
    '2026-08-05_attachment_junk_filter.sql',
    // Backfill UPDATE with a FROM subquery (DISTINCT ON over audit_log) is
    // outside the approved safe-rerun grammar; applied manually and marked.
    '2026-08-06_waiver_bypass_persistent.sql',
    // CHECK constraint intentionally requires manual review; do not widen runner grammar.
    '2026-09-16_document_comments.sql',

    // New constrained outbox schema requires operator review; never widen the classifier.
    '2026-09-16_document_email_messages.sql',
    // Read cutoff/defaults/index require owner review; never widen the classifier.
    '2026-09-16_document_read_state.sql',
    // Provenance foreign keys and the promotion guard require owner review.
    '2026-09-18_document_inbound_promotions.sql',
  ];

  assert.equal(safeRerun.length, 38);
  assert.equal(markApplied.length, 14);
  assert.deepEqual([...classified.keys()], [...safeRerun, ...markApplied].sort());
  for (const filename of safeRerun) {
    assert.equal(classified.get(filename).classification, 'safe-rerun', filename);
    assert.equal(classified.get(filename).safeToApplyPending, true, filename);
  }
  for (const filename of markApplied) {
    assert.equal(classified.get(filename).classification, 'mark-applied', filename);
    assert.equal(classified.get(filename).safeToApplyPending, false, filename);
  }
});

test('planning skips already-applied migrations and blocks unsafe pending files', () => {
  const migrations = listMigrationFiles(path.join(root, 'migrations'));
  const unsafeHistorical = new Set([
    '2026-04-11_rls_hardening.sql',
    '2026-04-13_job_feedback_cache.sql',
    '2026-04-29_feature_requests_rls.sql',
    '2026-06-30_document_type_mapping.sql',
    '2026-07-14_waiver_requirement_detection.sql',
    '2026-07-15_default_cost_type_from_subcontract.sql',
    '2026-07-18_coi_compliance_config.sql',
    '2026-07-18_document_destinations.sql',
    '2026-08-05_attachment_junk_filter.sql',
    '2026-08-06_waiver_bypass_persistent.sql',
    // CHECK constraint intentionally requires manual review; do not widen runner grammar.
    '2026-09-16_document_comments.sql',

    // New constrained outbox schema requires operator review; never widen the classifier.
    '2026-09-16_document_email_messages.sql',
    // Read cutoff/defaults/index require owner review; never widen the classifier.
    '2026-09-16_document_read_state.sql',
    '2026-09-18_document_inbound_promotions.sql',
  ]);

  const unbootstrapped = planMigrations(migrations, new Set());
  assert.deepEqual(
    unbootstrapped.blocked.map((migration) => migration.filename),
    [...unsafeHistorical],
  );

  const bootstrapped = planMigrations(migrations, unsafeHistorical);
  assert.equal(bootstrapped.blocked.length, 0);
  assert.deepEqual(
    bootstrapped.skipped.map((migration) => migration.filename),
    [...unsafeHistorical],
  );
});

test('schema_migrations bootstrap SQL creates tracking with RLS and public access revoked', () => {
  assert.match(ENSURE_SCHEMA_MIGRATIONS_SQL, /CREATE TABLE IF NOT EXISTS public\.schema_migrations/);
  assert.match(ENSURE_SCHEMA_MIGRATIONS_SQL, /filename TEXT PRIMARY KEY/);
  assert.match(ENSURE_SCHEMA_MIGRATIONS_SQL, /applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(ENSURE_SCHEMA_MIGRATIONS_SQL, /ALTER TABLE public\.schema_migrations ENABLE ROW LEVEL SECURITY/);
  assert.match(ENSURE_SCHEMA_MIGRATIONS_SQL, /DROP POLICY IF EXISTS service_role_full_access/);
  assert.match(ENSURE_SCHEMA_MIGRATIONS_SQL, /REVOKE ALL ON TABLE public\.schema_migrations FROM anon/);
  assert.match(ENSURE_SCHEMA_MIGRATIONS_SQL, /REVOKE ALL ON TABLE public\.schema_migrations FROM authenticated/);
});

test('bootstrap SQL bypasses the migration classifier while pending migrations remain gated', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql === ENSURE_SCHEMA_MIGRATIONS_SQL) return { rows: [] };
      if (sql.includes("SELECT to_regclass('public.schema_migrations')")) {
        return { rows: [{ table_name: 'schema_migrations' }] };
      }
      if (sql === 'SELECT filename FROM public.schema_migrations ORDER BY filename') return { rows: [] };
      return { rows: [] };
    },
  };
  const safeSql = 'CREATE TABLE IF NOT EXISTS classifier_bootstrap_probe (id TEXT PRIMARY KEY);';
  const safeMigration = {
    filename: '2026-07-16_classifier_bootstrap_probe.sql',
    sql: safeSql,
    safety: classifyMigrationSql(safeSql),
  };

  assert.equal(classifyMigrationSql(ENSURE_SCHEMA_MIGRATIONS_SQL).classification, 'mark-applied');
  const plan = await applyPendingMigrations(pool, [safeMigration], () => {});

  assert.deepEqual(plan.applicable, [safeMigration]);
  assert.equal(queries[0].sql, ENSURE_SCHEMA_MIGRATIONS_SQL);
  assert.equal(queries.some((query) => query.sql === safeSql), true);
});

test('one blocked pending migration prevents every migration SQL body from executing', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql === ENSURE_SCHEMA_MIGRATIONS_SQL) return { rows: [] };
      if (sql.includes("SELECT to_regclass('public.schema_migrations')")) {
        return { rows: [{ table_name: 'schema_migrations' }] };
      }
      if (sql === 'SELECT filename FROM public.schema_migrations ORDER BY filename') return { rows: [] };
      throw new Error(`Unexpected migration body execution: ${sql}`);
    },
  };
  const safeSql = 'CREATE TABLE IF NOT EXISTS classifier_safe_probe (id TEXT PRIMARY KEY);';
  const blockedSql = 'DROP VIEW classifier_unsafe_probe';
  const migrations = [
    { filename: '2026-07-16_classifier_safe_probe.sql', sql: safeSql, safety: classifyMigrationSql(safeSql) },
    { filename: '2026-07-16_classifier_unsafe_probe.sql', sql: blockedSql, safety: classifyMigrationSql(blockedSql) },
  ];

  await assert.rejects(
    () => applyPendingMigrations(pool, migrations, () => {}),
    /Pending migration\(s\) are not safe to auto-apply/,
  );
  assert.equal(queries.some((query) => query.sql === safeSql || query.sql === blockedSql), false);
});

test('live Supabase apply and mark operations require explicit target confirmation', () => {
  const target = getTargetInfo({
    SUPABASE_DB_URL: 'postgresql://postgres.example:placeholder@db.example.supabase.co:5432/postgres',
  });

  assert.throws(
    () => assertConfirmedForLiveMutation('apply', target, { confirmTarget: false }),
    /requires --confirm-target/,
  );
  assert.throws(
    () => assertConfirmedForLiveMutation('mark-applied', target, { confirmTarget: false }),
    /requires --confirm-target/,
  );
  assert.doesNotThrow(() => assertConfirmedForLiveMutation('apply', target, { confirmTarget: true }));
  assert.doesNotThrow(() => assertConfirmedForLiveMutation('list', target, { confirmTarget: false }));
});

test('npm script and CLI argument parser expose safe migration commands', () => {
  const pkg = readJson('package.json');

  assert.equal(pkg.scripts.migrate, 'node scripts/migrate.js');
  assert.match(pkg.scripts.test, /tests\/migrations\/runner\.test\.js/);

  assert.deepEqual(parseArgs([]), {
    command: 'list',
    options: { all: false, confirmTarget: false, filenames: [] },
  });
  assert.deepEqual(parseArgs(['mark-applied', '--all', '--confirm-target']), {
    command: 'mark-applied',
    options: { all: true, confirmTarget: true, filenames: [] },
  });
  assert.deepEqual(parseArgs(['apply', '--confirm-target']), {
    command: 'apply',
    options: { all: false, confirmTarget: true, filenames: [] },
  });
});
