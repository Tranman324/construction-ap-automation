'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const refresh = require(path.resolve(__dirname, '../../modules/invoices/scripts/refresh-routing-codes.js'));

test('routing refresh requires a matching live operator for every Spectrum header', () => {
  assert.match(refresh.HEADER_QUERY, /EXISTS\s*\(\s*SELECT 1\s*FROM PA_OPERATOR_FILE_MC o/s);
  assert.match(refresh.HEADER_QUERY, /LTRIM\(RTRIM\(o\.Operator_Id\)\) = LTRIM\(RTRIM\(h\.Routing_Code\)\)/);
});

test('routing refresh excludes manual JT and operator-less codes from both catalog and PM mappings while retaining D', () => {
  const { routingCodes, pmToRouting } = refresh.buildRoutingCatalog(
    [
      { code: 'JF', description: 'Active operator' },
      { code: 'JT', description: 'Manual exclusion' },
    ],
    [
      { code: 'JF', sequence: '1', operator: 'jf', limit: 10 },
      { code: 'JT', sequence: '1', operator: 'jt', limit: 10 },
    ],
    [
      { pm_code: 'CB' },
      { pm_code: 'DWE' },
      { pm_code: 'JA' },
      { pm_code: 'WG' },
      { pm_code: 'JT' },
      { pm_code: 'JF' },
    ],
  );

  // The SQL predicate prevents CB/DWE/JA/WG from arriving as headers. This
  // unit proof locks the script's second line of defense and its output map.
  assert.deepEqual(routingCodes.map((entry) => entry.code), ['JF', 'D']);
  assert.deepEqual(pmToRouting, { JF: 'JF' });
  assert.equal(routingCodes.some((entry) => entry.code === 'JT'), false);
  assert.equal('JT' in pmToRouting, false);
  assert.equal('DWE' in pmToRouting, false);
  assert.equal('JA' in pmToRouting, false);
  assert.equal('WG' in pmToRouting, false);
});
