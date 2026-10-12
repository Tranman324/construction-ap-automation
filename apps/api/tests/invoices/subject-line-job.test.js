'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const {
  extractJobFromSubject,
} = require('../../modules/invoices/services/matcher');

// --- Standard job patterns ---

test('extracts standard job 26-450 from subject', () => {
  const result = extractJobFromSubject('26-450');
  assert.equal(result.jobNumber, '26-450');
  assert.equal(result.subcontractNumber, null);
});

test('extracts job from subject with surrounding text', () => {
  const result = extractJobFromSubject('Invoice for 26-438 - Phase 2 work');
  assert.equal(result.jobNumber, '26-438');
});

// --- NCG-prefixed patterns ---

test('extracts NCG26-438.07 → job 26-438, sub 26-438.07', () => {
  const result = extractJobFromSubject('Emailing: NCG26-438.07 -CONT- SPEC OFFICE 500EX');
  assert.equal(result.jobNumber, '26-438');
  assert.equal(result.subcontractNumber, '26-438.07');
});

test('extracts NCG25-554 without sub', () => {
  const result = extractJobFromSubject('NCG25-554 Invoice Attached');
  assert.equal(result.jobNumber, '25-554');
  assert.equal(result.subcontractNumber, null);
});

test('NCG prefix is case-insensitive', () => {
  const result = extractJobFromSubject('ncg26-401.03 billing');
  assert.equal(result.jobNumber, '26-401');
  assert.equal(result.subcontractNumber, '26-401.03');
});

// --- SVC jobs ---

test('extracts 25-SVC403 from subject', () => {
  const result = extractJobFromSubject('25-SVC403 - Tile Trim Day 2 Items');
  assert.equal(result.jobNumber, '25-SVC403');
  assert.equal(result.subcontractNumber, null);
});

test('extracts SVC job case-insensitively', () => {
  const result = extractJobFromSubject('26-svc401 work order');
  assert.equal(result.jobNumber, '26-SVC401');
});

// --- Subcontract patterns ---

test('extracts subcontract 26-438.07 from subject', () => {
  const result = extractJobFromSubject('PO 26-438.07 billing');
  assert.equal(result.jobNumber, '26-438');
  assert.equal(result.subcontractNumber, '26-438.07');
});

// --- No match ---

test('returns null for subject without job patterns', () => {
  const result = extractJobFromSubject('Monthly statement from ABC Contractor');
  assert.equal(result, null);
});

test('returns null for null/empty subject', () => {
  assert.equal(extractJobFromSubject(null), null);
  assert.equal(extractJobFromSubject(''), null);
});

// --- Priority: NCG prefix takes precedence over plain ---

test('NCG-prefixed match takes priority over later plain match', () => {
  // "NCG26-438.07 -CONT- 25-500" → should match NCG pattern first
  const result = extractJobFromSubject('NCG26-438.07 -CONT- 25-500');
  assert.equal(result.jobNumber, '26-438');
  assert.equal(result.subcontractNumber, '26-438.07');
});

// --- Priority: subject-line should rank below extracted-verified and feedback-cache ---
// (This is tested indirectly by the code structure in resolveJobNumber — the
// subject-line check runs AFTER job-feedback-cache but BEFORE extracted job number.)

test('SVC has priority over standard job when both present', () => {
  // SVC regex is checked before standard
  const result = extractJobFromSubject('26-SVC401 ref 26-450');
  assert.equal(result.jobNumber, '26-SVC401');
});

// --- Compact SVC ---

test('extracts compact SVC 5SVC40310 → 25-SVC403', () => {
  const result = extractJobFromSubject('5SVC40310 - Tile Trim Day 2 Items');
  assert.equal(result.jobNumber, '25-SVC403');
  assert.equal(result.subcontractNumber, null);
});

test('extracts compact SVC 6SVC40100 → 26-SVC401', () => {
  const result = extractJobFromSubject('6SVC40100 work order');
  assert.equal(result.jobNumber, '26-SVC401');
});
