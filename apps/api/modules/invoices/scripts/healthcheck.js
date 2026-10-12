#!/usr/bin/env node
/**
 * Invoice Pipeline Health Check
 * Calls the /api/health endpoint and exits with:
 *   0 — healthy (server up, Supabase connected)
 *   1 — unhealthy (server down or Supabase offline)
 *
 * Intended to be wired into HEARTBEAT.md for periodic monitoring.
 * Usage: node scripts/healthcheck.js
 */

const http = require('http');

// Use 127.0.0.1 instead of localhost to force IPv4. Avoids flakiness when
// localhost resolves to ::1 but the server binds IPv6 wildcard (::).
const HEALTH_URL = 'http://127.0.0.1:3456/api/health';
// The /api/health endpoint does a live Spectrum MSSQL round-trip that can
// take 2-4 seconds against the remote Spectrum server. 10s gives plenty of
// headroom without silently hiding a real outage.
const TIMEOUT_MS = 10000;

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ ok: true, data });
        } catch {
          resolve({ ok: false, error: 'Invalid JSON response', body });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Request timed out' });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

async function main() {
  const result = await checkHealth();

  if (!result.ok) {
    console.error(`[invoice-healthcheck] FAIL — server unreachable: ${result.error}`);
    process.exit(1);
  }

  const { data } = result;

  if (!data.supabase) {
    console.error(`[invoice-healthcheck] FAIL — Supabase is down. Status: ${JSON.stringify(data)}`);
    process.exit(1);
  }

  console.log(`[invoice-healthcheck] OK — uptime=${data.uptime}s, pending=${data.pendingCount}, supabase=${data.supabase}, spectrumSql=${data.spectrumSql}`);
  process.exit(0);
}

main();
