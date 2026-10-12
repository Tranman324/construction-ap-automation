'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BILLING_PLATFORM_DOMAINS,
  extractVendorEmails,
  isBlockedRecipient,
  resolveRecipient,
  validateRecipientOverride,
} = require('../../modules/invoices/services/waiverRecipientParsing');

test('trusted senders resolve direct without confirmation', () => {
  assert.deepEqual(resolveRecipient({
    emailFrom: 'ap@vendor.test',
    emailBody: '<p>Contact accounts@vendor.test</p>',
    senderTrusted: true,
  }), {
    recipientType: 'direct',
    directEmail: 'ap@vendor.test',
    candidates: [],
    cachedVendorEmail: null,
    emailFrom: 'ap@vendor.test',
    reason: 'Direct vendor email',
  });
});

test('untrusted external senders require confirmation with sender as first candidate', () => {
  // Trust-model change 2026-07-15: unknown senders (e.g. a new billing
  // platform like Skynova before it was blocklisted) no longer skip the
  // dialog. The sender is offered as the first candidate.
  const resolution = resolveRecipient({
    emailFrom: 'support@newplatform.test',
    emailBody: '<p>Invoice from Spot On Plumbing (vendor@aol.test)</p>',
  });

  assert.equal(resolution.recipientType, 'parsed');
  assert.deepEqual(resolution.candidates, [
    { email: 'support@newplatform.test', source: 'sender' },
    { email: 'vendor@aol.test', source: 'body' },
  ]);
  assert.equal(resolution.reason, 'Unrecognized sender — not yet linked to this vendor');
});

test('blocked senders are never offered as candidates even when trusted flag is set', () => {
  // Poisoned-mapping guard: a platform domain wrongly learned as a vendor
  // domain must not produce a direct send. resolveRecipient treats blocked
  // senders as blocked regardless of senderTrusted.
  const resolution = resolveRecipient({
    emailFrom: 'documents@siteline.com',
    emailBody: '<p>ap@realvendor.test</p>',
    senderTrusted: true,
  });

  assert.equal(resolution.recipientType, 'parsed');
  assert.deepEqual(resolution.candidates, [
    { email: 'ap@realvendor.test', source: 'body' },
  ]);
  assert.equal(resolution.reason, 'Billing platform (Siteline)');
});

test('internal forwards prioritize the forwarded From address', () => {
  const candidates = extractVendorEmails(
    'From: Vendor AP &lt;ap@vendor.test&gt;<br>Reply to backup@vendor.test',
    'mreyes@northwindcg.example'
  );

  assert.deepEqual(candidates, [
    { email: 'ap@vendor.test', source: 'forwarded_header' },
    { email: 'backup@vendor.test', source: 'body' },
  ]);
});

test('billing-platform addresses are filtered while all vendor emails remain selectable', () => {
  const resolution = resolveRecipient({
    emailFrom: 'quickbooks@notification.intuit.com',
    emailBody: '<p>accounting@larkinteriors.example</p><p>robin@larkinteriors.example</p><p>help@intuit.com</p>',
  });

  assert.equal(resolution.recipientType, 'parsed');
  assert.deepEqual(resolution.candidates, [
    { email: 'robin@larkinteriors.example', source: 'body' },
    { email: 'accounting@larkinteriors.example', source: 'body' },
  ], 'personal address ranks first; generic role mailbox stays selectable but last');
});

test('cached vendor contact is included and a Zoho message without contacts requires manual entry', () => {
  const cached = resolveRecipient({
    emailFrom: 'message-service@sender.zohobooks.com',
    emailBody: '<p>No vendor contact here.</p>',
    cachedVendorEmail: 'ap@vendor.test',
  });
  assert.equal(cached.recipientType, 'parsed');
  assert.deepEqual(cached.candidates, [{ email: 'ap@vendor.test', source: 'vendor_record' }]);
  assert.equal(cached.cachedVendorEmail, 'ap@vendor.test');

  const manual = resolveRecipient({
    emailFrom: 'message-service@sender.zohobooks.com',
    emailBody: '<p>No vendor contact here.</p>',
  });
  assert.equal(manual.recipientType, 'manual');
  assert.deepEqual(manual.candidates, []);
});

test('skynova is a labeled billing platform (learned from live misfire 2026-07-15)', () => {
  const resolution = resolveRecipient({
    emailFrom: 'support@skynova.com',
    emailBody: '<p>Best regards, Spot On Plumbing (spoton.billing@vendor.test)</p>',
  });
  assert.equal(isBlockedRecipient('support@skynova.com'), true);
  assert.equal(resolution.recipientType, 'parsed');
  assert.equal(resolution.reason, 'Billing platform (Skynova)');
  assert.deepEqual(resolution.candidates, [
    { email: 'spoton.billing@vendor.test', source: 'body' },
  ]);
});

test('recipient overrides reject internal, platform, and malformed addresses', () => {
  assert.equal(isBlockedRecipient('pm@northwindcg.example'), false, 'internal domain now allowed');
  assert.equal(isBlockedRecipient('quickbooks@notification.intuit.com'), true);
  assert.throws(() => validateRecipientOverride('not-an-email'), /valid vendor email/);
  assert.equal(validateRecipientOverride('pm@northwindcg.example'), 'pm@northwindcg.example', 'internal addresses are valid reply targets');
  assert.throws(() => validateRecipientOverride('documents@siteline.com'), /cannot be sent/);
  assert.equal(validateRecipientOverride('AP@Vendor.Test'), 'ap@vendor.test');
});

test('all discovered billing platforms are blocked and return friendly labels', () => {
  assert.equal(BILLING_PLATFORM_DOMAINS.size, 13);
  const platforms = [
    ['quickbooks@notification.intuit.com', 'Billing platform (QuickBooks)'],
    ['documents@siteline.com', 'Billing platform (Siteline)'],
    ['message-service@sender.zohobooks.com', 'Billing platform (Zoho Books)'],
    ['no-reply@versapay.com', 'Billing platform (Versapay)'],
    ['no-reply@amazon.com', 'Billing platform (Amazon)'],
    ['no-reply@emails.trimble.com', 'Billing platform (Trimble)'],
    ['sync@sync.termsync.com', 'Billing platform (TermSync)'],
    ['notices@servicetrade.com', 'Billing platform (ServiceTrade)'],
  ];

  for (const [emailFrom, reason] of platforms) {
    assert.equal(isBlockedRecipient(emailFrom), true);
    assert.equal(resolveRecipient({ emailFrom, emailBody: '' }).reason, reason);
  }
  assert.equal(isBlockedRecipient('Pat@DEMOVENDOR.EXAMPLE'), false);
});
