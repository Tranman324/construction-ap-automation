'use strict';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function toInteger(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Bound list reads before they reach an external query. Invalid input falls
 * back to the safe default, while valid values are clamped deterministically.
 */
function getPagination(query = {}) {
  const requestedLimit = toInteger(query.limit);
  const requestedOffset = toInteger(query.offset);

  return {
    limit: requestedLimit === null ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, requestedLimit)),
    offset: requestedOffset === null ? 0 : Math.max(0, requestedOffset),
  };
}

module.exports = { DEFAULT_LIMIT, MAX_LIMIT, getPagination };
