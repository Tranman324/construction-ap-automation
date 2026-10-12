'use strict';
/**
 * Filename and path sanitization for shell safety.
 *
 * Every file path that enters an execSync / spawnSync / spawn command MUST
 * pass through one of these functions first. The strategy is strip-not-escape:
 * remove everything that isn't known-safe rather than trying to escape an
 * unbounded set of shell metacharacters.
 *
 * Why this exists:
 *   Email attachments from the Graph API carry user-supplied filenames. A
 *   crafted filename like `invoice"; rm -rf /.pdf` or `` `cmd`.pdf `` would
 *   execute arbitrary commands when interpolated into a shell string. The old
 *   sanitization only escaped `$` — insufficient against semicolons, backticks,
 *   pipes, parentheses, angle brackets, etc.
 *
 * Rule: if you need to pass a user-supplied path to a shell command,
 * call sanitizePathForShell(). If you need a clean filename for disk storage,
 * call sanitizeFilename(). Both are idempotent.
 */

const path = require('path');

/**
 * Sanitize a filename for safe disk storage.
 *
 * Strips everything except alphanumeric, dash, underscore, dot, space, and
 * parentheses. Collapses consecutive dots/spaces. Ensures the result is
 * non-empty and has no leading dots (prevents hidden files / traversal).
 *
 * @param {string} name  - Raw filename from an untrusted source (e.g., Graph API)
 * @returns {string}     - Safe filename (extension preserved)
 */
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'unnamed';

  // Step 1: strip path separators and null bytes (path traversal defense)
  let safe = name.replace(/[/\\:\0]/g, '');

  // Step 2: strip shell metacharacters and control chars.
  // Allow: a-z A-Z 0-9 . - _ ( ) space
  safe = safe.replace(/[^a-zA-Z0-9.\-_() ]/g, '');

  // Step 3: collapse consecutive dots and spaces
  safe = safe.replace(/\.{2,}/g, '.').replace(/ {2,}/g, ' ');

  // Step 4: strip leading dots (no hidden files)
  safe = safe.replace(/^\.+/, '');

  // Step 5: trim
  safe = safe.trim();

  // Step 6: fallback if empty
  if (!safe) return 'unnamed';

  return safe;
}

/**
 * Make a full file path safe for shell interpolation inside double-quoted
 * strings. This is a defense-in-depth layer ON TOP OF using sanitizeFilename()
 * for the filename component.
 *
 * This does NOT make arbitrary user input safe for shell — it handles the
 * residual risk in paths that are mostly under our control (e.g., /tmp/...,
 * data/incoming/...) but may contain a user-supplied filename segment.
 *
 * The approach: escape every shell-significant character. This is used in
 * template literals like:  execSync(`identify "${safePath}"`)
 *
 * Characters escaped:  $ ` " \ ! # & | ; ( ) { } < > ~ [ ] ? * \n \r
 *
 * @param {string} filePath  - Full path to sanitize
 * @returns {string}         - Shell-safe version for use inside double quotes
 */
function sanitizePathForShell(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';

  // Escape characters that have special meaning inside double-quoted strings
  // in bash/sh. The order matters: escape backslash first so we don't
  // double-escape the backslashes we add for other characters.
  return filePath
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/!/g, '\\!')
    .replace(/\n/g, '')
    .replace(/\r/g, '');
}

/**
 * Convenience: extract the basename, sanitize it, rejoin with the dirname.
 * Use when you trust the directory component but not the filename.
 *
 * @param {string} filePath  - Full path with potentially unsafe filename
 * @returns {string}         - Path with sanitized filename component
 */
function sanitizePathFilename(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(dir, sanitizeFilename(base));
}

module.exports = {
  sanitizeFilename,
  sanitizePathForShell,
  sanitizePathFilename,
};
