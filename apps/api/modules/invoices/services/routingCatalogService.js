'use strict';

const AP_DEFAULT_ROUTING_CODE = Object.freeze({
  code: 'D',
  description: 'AP Default Routing',
});

function normalizedCode(routingCode) {
  return String(
    routingCode?.code ?? routingCode?.Code ?? routingCode?.routing_code ?? ''
  ).trim().toUpperCase();
}

/**
 * The AP default is a product-owned catalog entry rather than an upstream
 * Spectrum row. Normalize every upstream representation to one canonical row
 * so consumers can always select the fallback routing code.
 */
function ensureApDefaultRoutingCode(routingCodes) {
  return [
    ...routingCodes.filter((routingCode) => normalizedCode(routingCode) !== 'D'),
    { ...AP_DEFAULT_ROUTING_CODE },
  ];
}

module.exports = {
  AP_DEFAULT_ROUTING_CODE,
  ensureApDefaultRoutingCode,
};
