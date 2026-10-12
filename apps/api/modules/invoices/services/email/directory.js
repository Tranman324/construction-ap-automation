'use strict';
const { z } = require('zod');
const { EmailError } = require('./errors');
const { graphCall } = require('./graphCall');
const email = z.string().email();
function validAddress(value) { return typeof value === 'string' && email.safeParse(value).success; }
// Same active internal employee boundary as routes/users.js, without its startup warmer.
async function directory(graph, config) {
  let next = '/users?$top=100&$select=id,displayName,mail,userPrincipalName,accountEnabled&$filter=accountEnabled eq true';
  const result = [];
  for (let page = 0; next && page < 100; page++) {
    const data = await graphCall(graph, next);
    for (const u of data.value || []) {
      const address = (u.mail || u.userPrincipalName || '').toLowerCase();
      if (u.accountEnabled === false || !validAddress(address) ||
          !config.internalDomains.includes(address.split('@')[1]) ||
          ['admin', 'info', 'invoices'].includes(address.split('@')[0]) ||
          address === config.mailbox.toLowerCase()) continue;
      result.push({ userId: u.id, name: u.displayName, email: address });
    }
    next = data['@odata.nextLink'];
    if (next && !next.startsWith('https://graph.microsoft.com/v1.0/users?')) {
      throw new EmailError(502, 'Directory lookup failed', 'EMAIL_DIRECTORY_FAILED');
    }
  }
  if (next) throw new EmailError(502, 'Directory too large', 'EMAIL_DIRECTORY_FAILED');
  return result;
}
async function defaults(doc, graph, config, loadJobPmMap) {
  const job = String(doc.job_match_number || '').trim();
  if (!job) return { defaultRecipients: [] };
  const pm = loadJobPmMap().jobPmMap[job];
  if (!pm) return { defaultRecipients: [] };
  const matches = (await directory(graph, config)).filter(u => u.name === pm);
  return { defaultRecipients: matches.length === 1 ? matches : [] };
}
module.exports = { directory, defaults, validAddress };
