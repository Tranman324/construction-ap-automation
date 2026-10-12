'use strict';

/**
 * Single-client database access for one-off scripts and standalone daemons.
 *
 * Why: the shared API pool (`lib/db.js`, `Pool({ max: 20 })`) is meant for the
 * long-lived API process. When a one-off script `require`s it, the script opens
 * its own up-to-20-connection pool; a script that fails to exit (the 2026-07-15
 * incident: a stray 24h-old `node -e`) then holds connections from the
 * session-mode pooler indefinitely. Scripts should instead use a SINGLE
 * `pg.Client` with guaranteed teardown.
 *
 * Two shapes:
 *  - `withScriptClient(fn)` — connects one client, runs `fn(client)`, and
 *    ALWAYS disconnects in `finally`, even when `fn` throws. Preferred for new
 *    scripts.
 *  - `createScriptClient()` — a drop-in replacement for the shared pool in
 *    existing scripts: exposes the small subset of the pool surface scripts use
 *    (`query`, `connect`, `on`, `end`) backed by one lazily-connected client,
 *    and registers a `beforeExit` teardown so a script that finishes its work
 *    never leaks its single connection.
 *
 * This never constructs a `Pool`. Transaction-mode pooling (Supavisor) would
 * additionally isolate scripts at the infrastructure layer; that is an ops
 * decision and is not made here.
 */

const { Client } = require('pg');

/**
 * Build a single-client connection config that mirrors lib/db.js's selection
 * (Supabase managed TLS when SUPABASE_DB_URL is set, else local Postgres env).
 */
function buildClientConfig(overrides = {}) {
  if (process.env.SUPABASE_DB_URL) {
    return {
      connectionString: process.env.SUPABASE_DB_URL,
      // SECURITY: intentional — Supabase managed TLS (same compensating control
      // as lib/db.js). Not certificate-validation closure; an environment check.
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      keepAlive: true,
      ...overrides,
    };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'toolbox',
    user: process.env.PGUSER || 'toolbox',
    password: process.env.PGPASSWORD,
    port: parseInt(process.env.PGPORT || '5432', 10),
    ...overrides,
  };
}

/**
 * Connect a single client, run `fn(client)`, and guarantee disconnect in a
 * `finally` — even when `fn` throws or rejects. Returns `fn`'s result.
 *
 * `ClientImpl` is injectable for unit tests.
 */
async function withScriptClient(fn, { config, ClientImpl = Client } = {}) {
  const client = new ClientImpl(config || buildClientConfig());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Drop-in single-client stand-in for the shared pool in existing scripts.
 * Lazily connects one client on first use and tears it down on `beforeExit`.
 *
 * `ClientImpl` is injectable for unit tests.
 */
function createScriptClient({ config, ClientImpl = Client } = {}) {
  const client = new ClientImpl(config || buildClientConfig());
  let connecting = null;
  let ended = false;

  async function ensureConnected() {
    if (!connecting) connecting = client.connect();
    await connecting;
    return client;
  }

  async function end() {
    if (ended) return;
    ended = true;
    if (connecting) {
      try { await connecting; } catch { /* connect failed; nothing to close */ }
    }
    await client.end();
  }

  const teardown = () => { end().catch(() => {}); };
  process.once('beforeExit', teardown);

  return {
    async query(...args) {
      await ensureConnected();
      return client.query(...args);
    },
    // Pool.connect() compatibility: hand back the single client with a no-op
    // release (the one client is reused for the process lifetime and closed at
    // teardown). Suitable for the sequential transaction use in these scripts.
    async connect() {
      await ensureConnected();
      return {
        query: (...args) => client.query(...args),
        release: () => {},
      };
    },
    on(...args) {
      return client.on(...args);
    },
    async end() {
      process.removeListener('beforeExit', teardown);
      return end();
    },
    // Escape hatch for the rare script that needs the raw client.
    get client() {
      return client;
    },
  };
}

module.exports = { buildClientConfig, withScriptClient, createScriptClient };
