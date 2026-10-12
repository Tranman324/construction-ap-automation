'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

const { isDirectoryEligible, AUTOMATED_MAILBOX_LOCAL_PARTS } = require(
  path.join(root, 'modules/invoices/services/waiverRecipientParsing.js')
);

test('isDirectoryEligible accepts plain vendor addresses', () => {
  assert.equal(isDirectoryEligible('john.doe@acmesteel.example'), true);
  assert.equal(isDirectoryEligible('  Jane.Doe@Vendor.EXAMPLE '), true);
});

test('isDirectoryEligible rejects blocked domains and bad formats', () => {
  assert.equal(isDirectoryEligible('billing@acmesteel.example'), false, 'automated mailbox');
  assert.equal(isDirectoryEligible('quickbooks@notification.intuit.com'), false, 'billing platform');
  assert.equal(isDirectoryEligible('not-an-email'), false);
  assert.equal(isDirectoryEligible(''), false);
  assert.equal(isDirectoryEligible(null), false);
});

test('isDirectoryEligible rejects every automated and role mailbox local part', () => {
  const automated = [
    'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply',
    'notifications', 'notification', 'mailer-daemon', 'postmaster', 'bounce',
  ];
  const role = ['invoices', 'billing', 'payments', 'accounts', 'accounting'];
  assert.deepEqual([...AUTOMATED_MAILBOX_LOCAL_PARTS].sort(), [...automated].sort());
  for (const localPart of [...automated, ...role]) {
    assert.equal(isDirectoryEligible(`${localPart}@acmesteel.example`), false, localPart);
    assert.equal(isDirectoryEligible(`${localPart.toUpperCase()}@acmesteel.example`), false, localPart);
  }
  // Prefix-only matches stay eligible (real people named e.g. bounce-back handling)
  assert.equal(isDirectoryEligible(`noreply.smith@acmesteel.example`), true);
});

function makeDb() {
  const calls = [];
  return {
    calls,
    db: {
      async query(sql, params = []) {
        calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        return { rows: [], rowCount: 1 };
      },
    },
  };
}

test('upsertVendorContact normalizes email, skips ineligible, and never downgrades source', async () => {
  const { calls, db } = makeDb();
  const { upsertVendorContact } = freshRequire('modules/invoices/services/vendorContactsService.js');

  assert.equal(await upsertVendorContact({ vendorCode: 'ACME01', email: '  Jane@Acme.EXAMPLE ', source: 'confirmed_send', addedBy: 'x' }, db), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO vendor_contacts/);
  assert.match(calls[0].sql, /ON CONFLICT \(vendor_code, email\) DO UPDATE/);
  // Downgrade protection: source only changes when the new rank is higher.
  assert.match(calls[0].sql, /WHEN 'confirmed_send' THEN 3 WHEN 'manual' THEN 2 ELSE 1/);
  assert.equal(calls[0].params[1], 'jane@acme.example');
  assert.equal(calls[0].params[3], 'confirmed_send');

  // Ineligible addresses are silently skipped — no query.
  assert.equal(await upsertVendorContact({ vendorCode: 'ACME01', email: 'noreply@acme.example', source: 'observed' }, db), false);
  assert.equal(await upsertVendorContact({ vendorCode: 'ACME01', email: 'billing@acme.example', source: 'observed' }, db), false);
  assert.equal(await upsertVendorContact({ vendorCode: null, email: 'billing@acme.example', source: 'observed' }, db), false);
  assert.equal(calls.length, 1);

  await assert.rejects(
    () => upsertVendorContact({ vendorCode: 'ACME01', email: 'jane@acme.example', source: 'bogus' }, db),
    /Unknown vendor contact source/
  );
});

test('listVendorContacts orders confirmed sends first then recency and maps fields', async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return {
        rows: [
          { email: 'ap@acme.example', name: 'Acme AP', source: 'confirmed_send', last_seen_at: '2026-08-01T00:00:00Z' },
          { email: 'jane@acme.example', name: null, source: 'observed', last_seen_at: null },
        ],
      };
    },
  };
  const { listVendorContacts } = freshRequire('modules/invoices/services/vendorContactsService.js');
  const contacts = await listVendorContacts('ACME01', db);
  assert.match(calls[0].sql, /ORDER BY \(source = 'confirmed_send'\) DESC, last_seen_at DESC NULLS LAST, email ASC/);
  assert.deepEqual(contacts, [
    { email: 'ap@acme.example', name: 'Acme AP', source: 'confirmed_send', lastSeenAt: '2026-08-01T00:00:00Z' },
    { email: 'jane@acme.example', name: null, source: 'observed', lastSeenAt: null },
  ]);
  assert.deepEqual(await listVendorContacts(null, db), []);
});

test('getWaiverRecipient returns directoryContacts and bumps last_seen for a known sender', async () => {
  const doc = {
    id: 'doc-1', classification: 'invoice', email_from: 'AP@Acme.example',
    email_body: '', vendor_code: 'ACME01',
  };
  const queries = [];
  const contacts = [{ email: 'ap@acme.example', name: null, source: 'confirmed_send', lastSeenAt: null }];
  await withMockedModules({
    './supabase': {
      pool: {
        async query(sql, params = []) {
          queries.push({ sql, params });
          return { rows: [doc] };
        },
      },
    },
    './vendorContactsService': {
      listVendorContacts: async (vendorCode) => {
        assert.equal(vendorCode, 'ACME01');
        return contacts;
      },
      touchVendorContact: async (vendorCode, email) => {
        queries.push({ sql: 'TOUCH', params: [vendorCode, email] });
      },
    },
  }, async () => {
    const { getWaiverRecipient } = freshRequire('modules/invoices/services/waiverRecipientService.js');
    const result = await getWaiverRecipient('doc-1');
    assert.deepEqual(result.directoryContacts, contacts);
    const touch = queries.find((q) => q.sql === 'TOUCH');
    assert.ok(touch, 'known sender should bump last_seen_at');
    assert.deepEqual(touch.params, ['ACME01', 'ap@acme.example']);
  });
});

test('getWaiverRecipient never fails the picker when the directory read throws', async () => {
  const doc = {
    id: 'doc-1', classification: 'invoice', email_from: 'ap@acme.example',
    email_body: '', vendor_code: 'ACME01',
  };
  await withMockedModules({
    './supabase': { pool: { async query() { return { rows: [doc] }; } } },
    './vendorContactsService': {
      listVendorContacts: async () => { throw new Error('relation vendor_contacts does not exist'); },
      touchVendorContact: async () => {},
    },
  }, async () => {
    const { getWaiverRecipient } = freshRequire('modules/invoices/services/waiverRecipientService.js');
    const result = await getWaiverRecipient('doc-1');
    assert.deepEqual(result.directoryContacts, []);
  });
});

test('vendor_contacts migration is allowlist-safe (auto-applies on deploy)', () => {
  const fs = require('node:fs');
  const { classifyMigrationSql } = require(path.join(root, 'lib/migrations.js'));
  const sql = fs.readFileSync(path.join(root, 'migrations/2026-08-26_vendor_contacts.sql'), 'utf8');
  const result = classifyMigrationSql(sql);
  assert.equal(result.classification, 'safe-rerun');
  assert.equal(result.safeToApplyPending, true);
});
