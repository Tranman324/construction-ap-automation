'use strict';

// BE-B (§3.7): M365 photo proxy — sized copies, deliberate cache headers,
// 404 fallback, and a no-disk-writes guarantee.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

process.env.MS_TENANT_ID ||= 'test-tenant';
process.env.MS_CLIENT_ID ||= 'test-client';
process.env.MS_CLIENT_SECRET ||= 'test-secret';

// Stub MSAL before the router builds its client (shared require cache).
const msal = require('@azure/msal-node');
msal.ConfidentialClientApplication = class {
  async acquireTokenByClientCredential() {
    return { accessToken: 'test-token' };
  }
};

// Intercept only Graph calls; everything else (our own test server) uses the
// real fetch. Installed before requiring the router so the startup cache-warm
// is captured too.
const realFetch = global.fetch;
const graphCalls = [];
let graphPhotoResponse = null; // set per test

global.fetch = async (url, opts) => {
  const target = String(url);
  if (!target.startsWith('https://graph.microsoft.com/')) {
    return realFetch(url, opts);
  }
  graphCalls.push(target);
  if (target.includes('/photo')) {
    if (!graphPhotoResponse) throw new Error('unexpected Graph photo call');
    return graphPhotoResponse();
  }
  // users list (startup cache warm)
  return new Response(JSON.stringify({ value: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const usersRouter = require('../../modules/invoices/routes/users');
const { buildPhotoFetchPlan, PHOTO_CACHE_CONTROL } = usersRouter;

const USER_ID = '3f2b8c1d-1111-2222-3333-444455556666';

function startServer() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { role: 'admin', permissions: ['accounting.invoices.view_details'] };
    req.log = { error() {}, warn() {}, info() {} };
    next();
  });
  app.use('/api/users', usersRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('buildPhotoFetchPlan: no size → full-size photo, sized → Graph thumbnail, bad size rejected', () => {
  assert.deepEqual(buildPhotoFetchPlan('abc', undefined), {
    graphPath: '/users/abc/photo/$value',
    cacheKey: 'abc|full',
  });
  assert.deepEqual(buildPhotoFetchPlan('abc', '96x96'), {
    graphPath: '/users/abc/photos/96x96/$value',
    cacheKey: 'abc|96x96',
  });
  // Distinct cache keys per size — a sized copy must never shadow full-size.
  assert.notEqual(
    buildPhotoFetchPlan('abc', '48x48').cacheKey,
    buildPhotoFetchPlan('abc', '96x96').cacheKey,
  );
  for (const bad of ['13x13', '96X96', '96x96 ', 'full', '<script>']) {
    assert.deepEqual(buildPhotoFetchPlan('abc', bad), { error: 'invalid-size' });
  }
  // Ids are URL-encoded into the Graph path.
  assert.equal(
    buildPhotoFetchPlan('a/b', '96x96').graphPath,
    '/users/a%2Fb/photos/96x96/$value',
  );
});

test('GET /photo?size=96x96 serves the sized Graph copy with private short-TTL cache headers', async () => {
  const server = await startServer();
  try {
    const bytes = Buffer.from('fake-jpeg-bytes');
    graphPhotoResponse = () => new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });

    const res = await realFetch(
      `http://127.0.0.1:${server.address().port}/api/users/${USER_ID}/photo?size=96x96`,
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('cache-control'), PHOTO_CACHE_CONTROL);
    assert.equal(PHOTO_CACHE_CONTROL, 'private, max-age=300');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
    assert.ok(
      graphCalls.some((u) => u.endsWith(`/users/${USER_ID}/photos/96x96/$value`)),
      `expected a sized Graph call, saw: ${graphCalls.join(', ')}`,
    );
  } finally {
    server.close();
  }
});

test('sized cache entry is scoped: full-size request still goes to Graph', async () => {
  const server = await startServer();
  try {
    graphPhotoResponse = () => new Response(Buffer.from('full-bytes'), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
    const before = graphCalls.length;

    const res = await realFetch(
      `http://127.0.0.1:${server.address().port}/api/users/${USER_ID}/photo`,
    );

    assert.equal(res.status, 200);
    const newCalls = graphCalls.slice(before);
    assert.ok(
      newCalls.some((u) => u.endsWith(`/users/${USER_ID}/photo/$value`)),
      `expected a full-size Graph call, saw: ${newCalls.join(', ')}`,
    );
  } finally {
    server.close();
  }
});

test('Graph 404 (no photo) → 404 so the client falls back to initials', async () => {
  const server = await startServer();
  try {
    graphPhotoResponse = () => new Response('not found', { status: 404 });
    const otherId = '9a8b7c6d-1111-2222-3333-444455556666';

    const res = await realFetch(
      `http://127.0.0.1:${server.address().port}/api/users/${otherId}/photo?size=96x96`,
    );

    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('invalid size → 400 without any Graph fetch', async () => {
  const server = await startServer();
  try {
    graphPhotoResponse = () => { throw new Error('must not be called'); };
    const before = graphCalls.length;

    const res = await realFetch(
      `http://127.0.0.1:${server.address().port}/api/users/${USER_ID}/photo?size=13x13`,
    );

    assert.equal(res.status, 400);
    assert.equal(graphCalls.length, before);
  } finally {
    server.close();
  }
});

test('photo proxy performs no disk writes (source guard)', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'modules', 'invoices', 'routes', 'users.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /writeFile|createWriteStream|appendFile|mkdir/);
});
