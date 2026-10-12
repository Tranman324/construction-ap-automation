'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, actor, token } = require('./email-fixtures');

test('blocked platform sender returns a picker instead of a direct reply recipient', async () => {
  const service = fixture({ doc: {
    email_from: 'documents@siteline.com', email_body: 'For questions contact ap@vendor.test', vendor_code: 'VEND',
  } }).service;
  const resolution = await service.getReplyRecipient('doc-1');
  assert.equal(resolution.recipientType, 'parsed');
  assert.equal(resolution.directEmail, null);
  assert.equal(resolution.reason, 'Billing platform (Siteline)');
  assert.deepEqual(resolution.candidates, [{ email: 'ap@vendor.test', source: 'body' }]);
});

test('trusted vendor sender stays prefilled as the direct reply recipient', async () => {
  const f = fixture({ vendorMappings: [{ domain: 'example.com', vendor_email: null }] });
  assert.deepEqual(await f.service.getReplyRecipient('doc-1'), {
    recipientType: 'direct', directEmail: 'vendor@example.com', candidates: [], cachedVendorEmail: null,
    emailFrom: 'vendor@example.com', reason: 'Direct vendor email', directoryContacts: [],
  });
});

test('thread history candidates rank ahead of body-parsed addresses and confirmed reply touches the contact', async () => {
  const f = fixture({ doc: {
    email_from: 'documents@siteline.com', email_body: 'Contact ap@vendor.test', vendor_code: 'VEND',
  }, threadRows: [{ direction: 'out', to_json: JSON.stringify(['history@vendor.test']) }] });
  const resolution = await f.service.getReplyRecipient('doc-1');
  assert.deepEqual(resolution.candidates, [
    { email: 'history@vendor.test', source: 'thread_history' },
    { email: 'ap@vendor.test', source: 'body' },
  ]);
  assert.deepEqual(await f.service.sendReply('doc-1', actor, { body: 'Please confirm', recipient: 'history@vendor.test' }, token), {
    ok: true, sentTo: 'history@vendor.test',
  });
  assert.ok(f.events.includes('contact-touched'));
});


test('manual recipient outside the candidate list is accepted when valid and unblocked', async () => {
  const f = fixture({ doc: {
    email_from: 'documents@siteline.com', email_body: 'Contact ap@vendor.test', vendor_code: 'VEND',
  } });
  assert.deepEqual(await f.service.sendReply('doc-1', actor, { body: 'Manual send', recipient: ' Erik@Partner.EXAMPLE ' }, token), {
    ok: true, sentTo: 'erik@partner.example',
  });
});

test('manual recipient pointing at an automated or platform mailbox is rejected', async () => {
  const f = fixture({ doc: {
    email_from: 'documents@siteline.com', email_body: 'Contact ap@vendor.test', vendor_code: 'VEND',
  } });
  await assert.rejects(
    () => f.service.sendReply('doc-1', actor, { body: 'Nope', recipient: 'documents@siteline.com' }, token),
    (err) => err.code === 'EMAIL_RECIPIENT_BLOCKED'
  );
  await assert.rejects(
    () => f.service.sendReply('doc-1', actor, { body: 'Nope', recipient: 'noreply@somevendor.example' }, token),
    (err) => err.code === 'EMAIL_RECIPIENT_BLOCKED'
  );
  await assert.rejects(
    () => f.service.sendReply('doc-1', actor, { body: 'Nope', recipient: 'invoices@northwindcg.example' }, token),
    (err) => err.code === 'EMAIL_RECIPIENT_BLOCKED'
  );
  await assert.rejects(
    () => f.service.sendReply('doc-1', actor, { body: 'Nope', recipient: '' }, token),
    (err) => err.code === 'EMAIL_RECIPIENT_SELECTION_REQUIRED'
  );
});


test('eligible original sender ranks first, ahead of thread history', async () => {
  const f = fixture({ doc: {
    email_from: 'jane@unknownvendor.example', email_body: 'Contact ap@vendor.test', vendor_code: 'VEND',
  }, threadRows: [{ direction: 'out', to_json: JSON.stringify(['history@vendor.test']) }] });
  const resolution = await f.service.getReplyRecipient('doc-1');
  assert.deepEqual(resolution.candidates.map(c => c.email), [
    'jane@unknownvendor.example', 'history@vendor.test', 'ap@vendor.test',
  ]);
  assert.equal(resolution.candidates[0].source, 'sender');
});

// Role-based vendor AP mailboxes (invoices@, accounting@, ...) are legitimate
// recipients (a8c639fb), so a role-mailbox sender stays the default.
test('role-mailbox sender (invoices@vendor) stays eligible and ranks first', async () => {
  const f = fixture({ doc: {
    email_from: 'invoices@unknownvendor.example', email_body: 'Contact ap@vendor.test', vendor_code: 'VEND',
  }, threadRows: [{ direction: 'out', to_json: JSON.stringify(['history@vendor.test']) }] });
  const resolution = await f.service.getReplyRecipient('doc-1');
  assert.deepEqual(resolution.candidates.map(c => c.email), ['invoices@unknownvendor.example', 'history@vendor.test', 'ap@vendor.test']);
});

test('automated sender (noreply@vendor) is excluded so the next candidate becomes the default', async () => {
  const f = fixture({ doc: {
    email_from: 'noreply@unknownvendor.example', email_body: 'Contact ap@vendor.test', vendor_code: 'VEND',
  }, threadRows: [{ direction: 'out', to_json: JSON.stringify(['history@vendor.test']) }] });
  const resolution = await f.service.getReplyRecipient('doc-1');
  assert.deepEqual(resolution.candidates.map(c => c.email), ['history@vendor.test', 'ap@vendor.test']);
});
