'use strict';
const { EmailError } = require('./errors');
// Bounds authentication AND transport; AbortSignal alone does not bound token acquisition.
async function graphCall(graph, path, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      graph(path, { ...options, signal: controller.signal,
        headers: { ...options.headers, Prefer: 'IdType="ImmutableId"' } }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(); reject(new EmailError(502, 'Email transport timeout', 'EMAIL_TRANSPORT_TIMEOUT'));
        }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
module.exports = { graphCall };
