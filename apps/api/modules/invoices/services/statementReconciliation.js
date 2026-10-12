'use strict';

function parseStatementLines(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isStatementLineClear(line) {
  return line?.status === 'matched'
    || line?.status === 'in_toolbox_not_spectrum'
    || (Boolean(line?.resolvedAt)
      && ['accept_line', 'use_ap_amount'].includes(line?.resolutionType));
}

function getStatementReconcileState(row, { canReconcile: callerCanReconcile = false } = {}) {
  if (row?.classification !== 'statement') return null;

  const statementLines = parseStatementLines(row.statement_lines)
    .map((line) => ({ ...line, clear: isStatementLineClear(line) }));
  const unresolvedLineIds = statementLines.length === 0
    ? ['statement-lines-empty']
    : statementLines
      .filter((line) => !line.clear)
      .map((line, index) => String(line.id || `line-${index + 1}`));
  const canReconcile = (Boolean(row.reconciled) && Boolean(row.filed))
    || unresolvedLineIds.length === 0;

  return {
    statementLines,
    unresolvedLineIds,
    blockers: unresolvedLineIds.map((lineId) => ({
      code: 'STATEMENT_LINE_UNRESOLVED',
      lineId,
      message: lineId === 'statement-lines-empty'
        ? 'Statement has no lines to reconcile'
        : `Statement line "${lineId}" is unresolved`,
    })),
    counts: {
      total: statementLines.length,
      clear: statementLines.length - unresolvedLineIds.length,
      unresolved: unresolvedLineIds.length,
    },
    canReconcile,
    permittedActions: canReconcile
      && callerCanReconcile
      && (!row.reconciled || !row.filed)
      ? ['reconcile']
      : [],
  };
}

module.exports = {
  getStatementReconcileState,
  isStatementLineClear,
  parseStatementLines,
};
