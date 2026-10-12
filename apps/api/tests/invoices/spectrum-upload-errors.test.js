'use strict';

// Spectrum upload failures must reach users as plain English. Raw library
// text (paths, env var names, HTML, JSON-RPC payloads) stays in logs only.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  friendlySpectrumUploadError,
  userFacingError,
  SPECTRUM_UPLOAD_ERROR_MESSAGES: M,
} = require('../../modules/invoices/services/spectrumUploadErrors');

const TECHNICAL = /\/root\/|\/home\/|\/tmp\/|\.env\b|SPECTRUM_|JSON-RPC|PROIV|HTML|<[a-z!/]|\{"|Error:|\bat \S+ \(|\u2014/i;

function assertSafe(message) {
  assert.equal(typeof message, 'string');
  assert.ok(message.length > 0);
  assert.doesNotMatch(message, TECHNICAL, `leaks technical text: ${message}`);
}

const CASES = [
  // Sign-in, session, and security level
  ['Credentials not found. Set SPECTRUM_USER/SPECTRUM_PASS env vars or create /etc/toolbox/spectrum.env', M.signIn],
  ['Unexpected URL after login: https://login.microsoftonline.com/common/oauth2', M.signIn],
  ['JSESSIONID cookie not found after login.', M.signIn],
  ['Insufficient security level (1). Need at least 2 for uploads.', M.signIn],
  ['Session not open. Call openSession() first.', M.signIn],
  ['Session is closed.', M.signIn],
  ['Could not extract serialNumber from session page. HTML: <html><body>oops</body></html>', M.signIn],
  ['No session GUID in URL: https://x/y. HTML: <div>', M.signIn],
  ['PROIV request failed (405): stale', M.signIn],
  // Record lock
  ['Record locked by another session (row 3)', M.recordLocked],
  // Expiration date
  ['Invalid expiration date: 2027-13-45', M.invalidExpiration],
  // Missing file
  ['File not found: /srv/toolbox/data/coi/abc.pdf', M.fileMissing],
  // Network and timeouts
  ['connect ECONNREFUSED 10.0.0.5:443', M.network],
  ['connect ETIMEDOUT 10.0.0.5:443', M.network],
  ['getaddrinfo ENOTFOUND spectrum.example.com', M.network],
  ['fetch failed', M.network],
  ['PROIV WebSocket response timeout (60s)', M.network],
  ['PROIV WebSocket send failed: socket closed', M.network],
  ['page.goto: Timeout 60000ms exceeded.', M.network],
  // Vendor navigation
  ['Vendor navigation error: Vendor XYZ01 not on file', M.vendorNavigation],
  ['Vendor load on doc tracking error: bad code', M.vendorNavigation],
  // Everything else
  ['Upload failed (500): <html>Internal Server Error</html>', M.generic],
  ['JSON-RPC error in openWorkspace: {"code":-32000,"message":"boom"}', M.generic],
  ['Failed to parse PROIV response: Unexpected token. Converted (first 500): <x>', M.generic],
  ['Doc tracking navigation error: bad screen', M.generic],
  ['New dialog error: nope', M.generic],
  ['Tracking type error: nope', M.generic],
  ['Save error: nope', M.generic],
  ['Save-close error: nope', M.generic],
  ['Dialog did not close after save — save NOT committed', M.generic],
  ['Could not extract containerUID from workspace response.', M.generic],
];

for (const [raw, expected] of CASES) {
  test(`maps "${raw.slice(0, 60)}" to a plain-English message`, () => {
    const fromString = friendlySpectrumUploadError(raw);
    const fromError = friendlySpectrumUploadError(new Error(raw));
    assert.equal(fromString, expected);
    assert.equal(fromError, expected);
    assertSafe(fromError);
  });
}

test('credentials error never leaks the path or env var names', () => {
  const raw = 'Credentials not found. Set SPECTRUM_USER/SPECTRUM_PASS env vars or create /etc/toolbox/spectrum.env';
  const out = friendlySpectrumUploadError(new Error(raw));
  assert.equal(out, M.signIn);
  assert.ok(!out.includes('/root/'), 'path must not appear');
  assert.ok(!out.includes('SPECTRUM_'), 'env var name must not appear');
  assert.ok(!out.includes('.env'), 'env file must not appear');
});

test('a service-authored userMessage passes through unchanged', () => {
  const msg = 'Spectrum did not confirm the COI tracking item, so the PDF was not attached. '
    + 'Nothing was saved in Spectrum. Retry the upload.';
  assert.equal(friendlySpectrumUploadError(userFacingError(msg)), msg);
});

test('the same wording without the explicit marker is not trusted blindly', () => {
  // Passthrough is by marker, not string sniffing. An unmarked error with a
  // "friendly looking" message still gets the generic bucket.
  assert.equal(friendlySpectrumUploadError(new Error('Please retry soon.')), M.generic);
});

test('unknown errors fall back to the generic message', () => {
  assert.equal(friendlySpectrumUploadError(new Error('something odd at /home/x/y.js:12')), M.generic);
  assert.equal(friendlySpectrumUploadError(''), M.generic);
  assert.equal(friendlySpectrumUploadError(undefined), M.generic);
  assert.equal(friendlySpectrumUploadError(null), M.generic);
  assert.equal(friendlySpectrumUploadError({}), M.generic);
});

test('every friendly message is safe, has no em dash, and says what to do next', () => {
  for (const message of Object.values(M)) {
    assertSafe(message);
    assert.ok(!message.includes('\u2014'), `em dash in: ${message}`);
    assert.match(message, /\b(retry|re-upload|fix|check|close|ask)\b/i, `no next step in: ${message}`);
  }
});
