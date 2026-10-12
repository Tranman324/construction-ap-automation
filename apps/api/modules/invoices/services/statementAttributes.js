'use strict';

const ATTRIBUTE_KEYS = ['statementPeriod', 'balance'];
const SOURCE_ORDER = ['manual', 'extracted', 'computed'];

function parseObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sourceValue(value) {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'value')) return value.value;
  return value;
}

function normalizeBalance(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildExtractedStatementAttributes(extracted = {}, existing = null) {
  const attributes = parseObject(existing);
  const extractedValues = {
    statementPeriod: typeof extracted.statementPeriod === 'string' && extracted.statementPeriod.trim()
      ? extracted.statementPeriod.trim()
      : null,
    balance: normalizeBalance(extracted.balance),
  };
  return {
    ...attributes,
    extracted: extractedValues,
  };
}

function mergeReextractedStatementAttributes(existing, extracted) {
  return buildExtractedStatementAttributes(extracted, existing);
}

function applyManualStatementAttributePatch(existing, patch, actor = {}, setAt = new Date().toISOString()) {
  const attributes = parseObject(existing);
  const { manual: _previousManual, ...withoutManual } = attributes;
  const manual = { ...parseObject(attributes.manual) };

  for (const key of ATTRIBUTE_KEYS) {
    if (!Object.hasOwn(patch, key)) continue;
    if (patch[key] === null) {
      delete manual[key];
    } else {
      manual[key] = {
        value: patch[key],
        setBy: actor.name || actor.userId || 'system',
        setAt,
      };
    }
  }

  return {
    ...withoutManual,
    ...(Object.keys(manual).length ? { manual } : {}),
  };
}

function resolveStatementAttributes(value) {
  const attributes = parseObject(value);
  const resolved = {};
  for (const key of ATTRIBUTE_KEYS) {
    for (const source of SOURCE_ORDER) {
      const candidate = sourceValue(attributes[source]?.[key]);
      if (candidate != null) {
        resolved[key] = { value: key === 'balance' ? normalizeBalance(candidate) : candidate, source };
        if (resolved[key].value == null) continue;
        break;
      }
    }
    if (!resolved[key]) resolved[key] = { value: null, source: null };
  }
  return resolved;
}

module.exports = {
  buildExtractedStatementAttributes,
  applyManualStatementAttributePatch,
  mergeReextractedStatementAttributes,
  resolveStatementAttributes,
};
