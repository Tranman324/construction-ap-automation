'use strict';

// Statuses that represent in-flight document processing and must not be
// changed by user-driven state or edit actions.
const TRANSIENT_STATUSES = new Set(['split-processing', 'submitting']);
const DISCARD_PROTECTED_STATUSES = new Set([...TRANSIENT_STATUSES, 'submitted']);

module.exports = {
  DISCARD_PROTECTED_STATUSES,
  TRANSIENT_STATUSES,
};
