'use strict';

/**
 * Plain-English messages for failed Spectrum COI uploads.
 *
 * The Spectrum automation library throws developer text (file paths, env var
 * names, HTML, JSON-RPC payloads). That text belongs in logs and the audit
 * trail, never in front of users. `friendlySpectrumUploadError` maps a raw
 * failure to a short sentence that says what to do next.
 *
 * Messages this service writes for users carry an explicit `userMessage`
 * property (see `userFacingError`). Those pass through unchanged; nothing is
 * recognized by sniffing its wording.
 */

const MESSAGES = Object.freeze({
  signIn: 'Toolbox could not sign in to Spectrum. Ask an admin to check the Spectrum connection, then retry.',
  recordLocked: "Someone has this vendor's tracking record open in Spectrum. Close it there, then retry.",
  invalidExpiration: 'The expiration date on this COI is not valid. Fix it, then retry.',
  fileMissing: 'The COI file is missing from Toolbox. Re-upload the document, then retry.',
  network: 'Spectrum did not respond. Retry in a few minutes.',
  vendorNavigation: 'Spectrum could not open this vendor. Check the vendor code, then retry.',
  generic: 'Spectrum upload failed. Retry; if it fails again, ask an admin to check the Toolbox logs.',
});

// Checked in order; the first match wins. Specific failures come before the
// broad network and sign-in buckets so, for example, a locked record is never
// reported as a connection problem.
const RULES = [
  { message: MESSAGES.recordLocked, pattern: /record locked|locked by another session/i },
  { message: MESSAGES.invalidExpiration, pattern: /invalid expiration date/i },
  { message: MESSAGES.fileMissing, pattern: /^file not found\b/i },
  { message: MESSAGES.vendorNavigation, pattern: /vendor navigation error|vendor load on doc tracking error/i },
  {
    message: MESSAGES.network,
    pattern: /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|net::ERR_|timed? ?out|timeout|PROIV WebSocket (?:send failed|closed)/i,
  },
  {
    message: MESSAGES.signIn,
    pattern: /credentials not found|unexpected url after login|JSESSIONID|insufficient security level|session not open|session is closed|no session guid|could not extract serialnumber|PROIV request failed \((?:405|410)\)/i,
  },
];

/**
 * Build an Error whose message is already safe to show users.
 * Use it for failures this service authors itself.
 *
 * @param {string} message plain-English, user-facing text
 * @returns {Error & { userMessage: string }}
 */
function userFacingError(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

/**
 * Map a Spectrum upload failure to a user-facing sentence.
 *
 * @param {unknown} errOrMessage an Error (preferred) or a raw message string
 * @returns {string}
 */
function friendlySpectrumUploadError(errOrMessage) {
  if (errOrMessage && typeof errOrMessage === 'object') {
    const { userMessage } = /** @type {{ userMessage?: unknown }} */ (errOrMessage);
    if (typeof userMessage === 'string' && userMessage.trim()) return userMessage.trim();
  }

  const raw = typeof errOrMessage === 'string'
    ? errOrMessage
    : (errOrMessage && typeof errOrMessage === 'object' && typeof errOrMessage.message === 'string'
      ? errOrMessage.message
      : String(errOrMessage ?? ''));

  const rule = RULES.find((r) => r.pattern.test(raw));
  return rule ? rule.message : MESSAGES.generic;
}

module.exports = {
  friendlySpectrumUploadError,
  userFacingError,
  SPECTRUM_UPLOAD_ERROR_MESSAGES: MESSAGES,
};
